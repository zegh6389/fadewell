import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { recipientHash, runDeliveryCycle } from '../src/delivery.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

// A dedupe decision keeps the recipient hash for operational correlation,
// but uses DEDUPLICATED rather than SENT because no provider call occurred.

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

test('a dedupe-skipped row is distinct from SENT and persists last_recipient_hash', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // Seed a prior real send (A) inside the 5min dedupe window so the new
  // notification (B) will be dedupe-skipped.
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, provider_receipt, last_recipient_hash, created_at, updated_at)
     VALUES ($1, $2, $3, 'EMAIL', 'SENT', 1, 'stub-prior-receipt', $4, now() - interval '1 minute', now() - interval '1 minute')`,
    [priorNotifId, priorEventId, intakeId, hash]
  )
  // Queue a new event so the cycle has work to do.
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [randomUUID(), intakeId, randomUUID()]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(calls.length, 0, 'expected the new notification to be dedupe-skipped (no provider.send call)')
  // The skipped row retains the recipient hash for audit/search but must not
  // be classified as a confirmed provider delivery.
  const synthRow = (
    await db.query(
      `SELECT id, last_recipient_hash, status, provider_receipt, attempts
       FROM notifications
       WHERE intake_id=$1 AND status='DEDUPLICATED' AND provider_receipt LIKE 'dedupe:skip:%'`,
      [intakeId]
    )
  ).rows[0]
  assert.ok(synthRow, 'expected a DEDUPLICATED row from the dedupe skip')
  assert.equal(
    synthRow.last_recipient_hash,
    hash,
    'dedupe-skipped row must persist last_recipient_hash so future dedupe queries see it'
  )
  assert.equal(synthRow.attempts, 1)
  const attempt = (
    await db.query(
      "SELECT attempt FROM notification_attempts WHERE notification_id=$1 AND outcome='DEDUPLICATED'",
      [synthRow.id]
    )
  ).rows[0]
  assert.equal(attempt.attempt, synthRow.attempts)
})
