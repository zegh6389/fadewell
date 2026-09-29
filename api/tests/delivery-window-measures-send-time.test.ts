import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { recipientHash, runDeliveryCycle } from '../src/delivery.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

// CodeRabbit flagged both `checkRecipientDedupe` and `checkRecipientRateLimit`
// for measuring the dedupe/rate window from `created_at` (queue time). That is
// wrong: a notification that takes longer than the window to deliver has its
// `created_at` already outside the window at the moment its `status` finally
// becomes `SENT`. The dedupe query then fails to see the prior send, and the
// delivery cycle re-sends to the same recipient — a duplicate the dedupe
// window was supposed to prevent. The fix is to measure from the successful
// delivery timestamp (notifications.updated_at is touched on every SENT
// transition; for any SENT row it equals "time of last successful delivery").

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
  const verificationId = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id, intake_id, channel, encrypted_destination, verified_by) VALUES ($1, $2, 'EMAIL', $3, $4)",
    [verificationId, intakeId, seal('patient@example.test', key, `contact:${verificationId}`), staffId]
  )
  return { staffId, patientId, intakeId }
}

async function seedPriorNotificationAt(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHashHex: string,
  createdAtExpression: string,
  updatedAtExpression: string,
) {
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, provider_receipt, last_recipient_hash, created_at, updated_at)
     VALUES ($1, $2, $3, 'EMAIL', 'SENT', 1, 'stub-prior-receipt', $4, ${createdAtExpression}, ${updatedAtExpression})`,
    [priorNotifId, priorEventId, intakeId, recipientHashHex]
  )
  await db.query(
    `INSERT INTO notification_attempts(notification_id, attempt, outcome, provider_receipt, recipient_hash)
     VALUES ($1, 1, 'ACCEPTED', 'stub-prior-receipt', $2)`,
    [priorNotifId, recipientHashHex]
  )
  return { priorEventId, priorNotifId }
}

async function seedNewOutboxEvent(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string
) {
  const eventId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [eventId, intakeId, randomUUID()]
  )
  return { eventId }
}

test('dedupe fires when the prior send was queued outside the window but successfully sent within it', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // The prior was queued 30 minutes ago (outside the 5min dedupe window)
  // but the row's updated_at — the timestamp of its last SENT transition —
  // is 10 seconds ago, well inside the window. Dedupe must fire.
  await seedPriorNotificationAt(
    db,
    intakeId,
    hash,
    "now() - interval '30 minutes'",
    "now() - interval '10 seconds'"
  )
  await seedNewOutboxEvent(db, intakeId)
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(
    calls.length,
    0,
    `provider.send called ${calls.length} times; expected 0 — dedupe must measure from updated_at (the send time), not created_at (the queue time)`
  )
})

test('rate-limit fires when 5 prior sends were each queued long ago but all delivered within the last hour', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // Seed 5 prior SENT notifications whose created_at is 2 hours ago (well
  // outside the 1-hour rate window) but whose updated_at is 30 minutes ago
  // (well inside it). Rate-limit must count them; otherwise a retry-storm
  // with multi-minute delivery latency could bypass the hourly budget.
  for (let i = 0; i < 5; i++) {
    await seedPriorNotificationAt(
      db,
      intakeId,
      hash,
      "now() - interval '2 hours'",
      "now() - interval '30 minutes'"
    )
  }
  await seedNewOutboxEvent(db, intakeId)
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(calls.length, 0, 'rate-limited send must NOT invoke provider.send')
  const limited = (
    await db.query(
      "SELECT status, last_error FROM notifications WHERE last_recipient_hash=$1 AND status='RATE_LIMITED'",
      [hash]
    )
  ).rows[0]
  assert.ok(limited, 'notification must be in RATE_LIMITED status')
  assert.match(
    String(limited.last_error),
    /RECIPIENT_RATE_LIMITED/,
    'last_error must cite the rate limit code'
  )
})
