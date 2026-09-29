import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { recipientHash, runDeliveryCycle } from '../src/delivery.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

// CodeRabbit flagged two issues at the rate-limit branch:
//   1. The worker SELECT (delivery.ts:231) only picks statuses
//      ('QUEUED','BLOCKED','UNAVAILABLE','RETRY') — RATE_LIMITED rows are
//      never re-selected after their available_at expires. The cycle
//      marks them RATE_LIMITED with available_at = now + 1 hour, then
//      forgets they exist. The recipient's budget eventually clears but
//      the notification stays stranded forever.
//   2. The RATE_LIMITED UPDATE builds the last_error string via SQL
//      concatenation: `'...' + String(rate.sentInLastHour) + '...'`,
//      which OpenGrep / ast-grep flag for SQL injection. The current
//      value is a typed Number so it is not exploitable today, but the
//      pattern is the wrong default — any future code path that sources
//      sentInLastHour from user input would be vulnerable.
// Fix: add RATE_LIMITED to the worker SELECT, and parameterize last_error.

const stubProvider = (calls: { to: string; text: string }[]): DeliveryProvider => ({
  available: () => true,
  send: async (m) => {
    calls.push({ to: m.to, text: m.text })
    return { outcome: 'ACCEPTED', receipt: `stub-${randomUUID().slice(0, 8)}` }
  }
})

async function setupDb(t: test.TestContext) {
  const config = {
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64')
  }
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  return { db, config }
}

async function seedPatientAndContact(db: Awaited<ReturnType<typeof testDatabase>>, key: string) {
  const staffId = randomUUID()
  const patientId = randomUUID()
  const intakeId = randomUUID()
  const verificationId = randomUUID()
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, 'STAFF', true)",
    [staffId, staffId]
  )
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, 'PATIENT', true)",
    [patientId, patientId]
  )
  await db.query(
    "INSERT INTO questionnaires(version, definition) VALUES ('2026-09-initial', '{}'::jsonb) ON CONFLICT (version) DO NOTHING"
  )
  await db.query(
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', 'CA')",
    [
      intakeId,
      patientId,
      seal(
        {
          emailConsent: true,
          smsConsent: false,
          normalized: { email: 'patient@example.test', phone: null }
        },
        key,
        `intake:${intakeId}`
      )
    ]
  )
  await db.query(
    "INSERT INTO contact_verifications(id, intake_id, channel, encrypted_destination, verified_by) VALUES ($1, $2, 'EMAIL', $3, $4)",
    [verificationId, intakeId, seal('patient@example.test', key, `contact:${verificationId}`), staffId]
  )
  return { staffId, patientId, intakeId }
}

test('a RATE_LIMITED notification whose available_at has expired is re-selected by the worker', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // Seed a RATE_LIMITED notification with available_at in the past. The
  // budget it was deferred from has long cleared (no prior SENT exists), so
  // when the cycle re-evaluates it, the budget is empty and the notification
  // proceeds to a real send.
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, last_recipient_hash, last_error, created_at, updated_at, available_at)
     VALUES ($1, $2, $3, 'EMAIL', 'RATE_LIMITED', 1, $4, 'RECIPIENT_RATE_LIMITED sentInLastHour=5', now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '1 second')`,
    [priorNotifId, priorEventId, intakeId, hash]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(
    calls.length,
    1,
    `provider.send called ${calls.length} times; expected 1 — the RATE_LIMITED row must be picked up and sent once its available_at expires and the budget has cleared`
  )
  const row = (
    await db.query("SELECT status, available_at, last_error FROM notifications WHERE id=$1", [priorNotifId])
  ).rows[0]
  assert.equal(row.status, 'SENT', 'previously rate-limited notification must transition to SENT')
  assert.equal(row.last_error, null, 'successful delivery must clear the stale rate-limit error')
})

test('a RATE_LIMITED notification that is STILL over budget is re-rate-limited with a parameterized last_error', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // Fill the budget so the rate-limited notification is re-deferred.
  for (let i = 0; i < 5; i++) {
    const eId = randomUUID()
    const nId = randomUUID()
    await db.query(
      "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
      [eId, intakeId, randomUUID()]
    )
    await db.query(
      `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, last_recipient_hash, created_at, updated_at)
       VALUES ($1, $2, $3, 'EMAIL', 'SENT', 1, $4, now() - interval '30 minutes', now() - interval '30 minutes')`,
      [nId, eId, intakeId, hash]
    )
  }
  // Now seed the RATE_LIMITED notification whose available_at has expired.
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, last_recipient_hash, last_error, created_at, updated_at, available_at)
     VALUES ($1, $2, $3, 'EMAIL', 'RATE_LIMITED', 1, $4, 'RECIPIENT_RATE_LIMITED sentInLastHour=5', now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '1 second')`,
    [priorNotifId, priorEventId, intakeId, hash]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(calls.length, 0, 'no send should happen while budget is still full')
  const row = (
    await db.query(
      "SELECT status, last_error, available_at FROM notifications WHERE id=$1",
      [priorNotifId]
    )
  ).rows[0]
  assert.equal(row.status, 'RATE_LIMITED', 'still rate-limited, must remain in RATE_LIMITED')
  assert.match(
    String(row.last_error),
    /^RECIPIENT_RATE_LIMITED sentInLastHour=\d+$/,
    'last_error must follow the documented format produced by the parameterized UPDATE'
  )
})
