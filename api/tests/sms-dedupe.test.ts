import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { recipientHash, runDeliveryCycle } from '../src/delivery.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

/**
 * Phase 8 (OC2): per-recipient SMS dedupe window. Without this, a stuck retry loop or a stale
 * outbox row can send the same template to the same recipient twice within seconds. Patients
 * call this "spamming" and it burns the Telnyx rate budget. The fix: before invoking the
 * provider, check notifications for any accepted send of the same template to the same
 * (channel, recipient_hash) within the last 5 minutes and record a DEDUPLICATED outcome + a
 * `dedupe:skip:<previous-receipt-id>` receipt so the audit trail still shows the decision.
 */

const stubProvider = (calls: { to: string; text: string }[]): DeliveryProvider => ({
  available: () => true,
  send: async (m) => {
    calls.push({ to: m.to, text: m.text })
    return { outcome: 'ACCEPTED', receipt: `stub-${randomUUID().slice(0, 8)}` }
  }
})

async function setupDb(t: test.TestContext) {
  const config = {
    ...loadConfig({}),
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64')
  }
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  return { db, config }
}

async function seedStaffAndIntake(
  db: Awaited<ReturnType<typeof testDatabase>>,
  key: string,
  state: string
) {
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
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', $4)",
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
      ),
      state
    ]
  )
  const verificationId = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id, intake_id, channel, encrypted_destination, verified_by) VALUES ($1, $2, 'EMAIL', $3, $4)",
    [verificationId, intakeId, seal('patient@example.test', key, `contact:${verificationId}`), staffId]
  )
  return { staffId, patientId, intakeId }
}

async function seedNewOutboxEvent(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  eventType = 'intake.submitted'
) {
  const eventId = randomUUID()
  const dedupeKey = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, $2, $3, $4, 'QUEUED')",
    [eventId, eventType, intakeId, dedupeKey]
  )
  return { eventId }
}

async function seedPriorAcceptedNotification(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHash: string,
  backdated: boolean
) {
  // Seed a prior outbox event + a prior notification. The prior event has status='PROCESSED'
  // so the cycle won't pick it up again. The new event in the test is separate and unprocessed.
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  const createdAt = backdated ? "now() - interval '10 minutes'" : "now() - interval '1 minute'"
  // updated_at mirrors created_at so the fixture represents the realistic
  // case "queue + immediate send" — both timestamps equal the same instant.
  // The runtime cycle then measures the dedupe/rate window from updated_at.
  await db.query(
    "INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, provider_receipt, last_recipient_hash, created_at, updated_at) VALUES ($1, $2, $3, 'EMAIL', 'SENT', 1, 'stub-prior-receipt', $4, " + createdAt + ", " + createdAt + ")",
    [priorNotifId, priorEventId, intakeId, recipientHash]
  )
  await db.query(
    `INSERT INTO notification_attempts(notification_id, attempt, outcome, provider_receipt, recipient_hash)
     VALUES ($1, 1, 'ACCEPTED', 'stub-prior-receipt', $2)`,
    [priorNotifId, recipientHash]
  )
  return { priorEventId, priorNotifId }
}

function hashFor(channel: 'SMS' | 'EMAIL', recipient: string, key: string) {
  return recipientHash(channel, recipient, key)
}

test('the cycle skips a send when the same channel+recipient was accepted within the dedupe window', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!, 'CA')
  await seedNewOutboxEvent(db, intakeId)
  await seedPriorAcceptedNotification(
    db,
    intakeId,
    hashFor('EMAIL', 'patient@example.test', config.encryptionKey!),
    false
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 0, `provider.send called ${calls.length} times; expected 0 (dedupe)`)
  const attempts = (
    await db.query(
      "SELECT * FROM notification_attempts WHERE recipient_hash=$1 ORDER BY created_at DESC",
      [hashFor('EMAIL', 'patient@example.test', config.encryptionKey!)]
    )
  ).rows
  assert.ok(
    attempts.length >= 2,
    `expected at least 2 attempts (prior + dedupe skip), got ${attempts.length}`
  )
  const lastAttempt = attempts[0]
  assert.match(String(lastAttempt.provider_receipt), /dedupe:skip/, 'receipt must cite dedupe')
})

test('the cycle sends a different template to the same recipient inside the dedupe window', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!, 'CA')
  await seedPriorAcceptedNotification(
    db,
    intakeId,
    hashFor('EMAIL', 'patient@example.test', config.encryptionKey!),
    false
  )
  await seedNewOutboxEvent(db, intakeId, 'intake.verified')
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 1, 'different event templates must not deduplicate each other')
})

test('the cycle sends through when the prior accept is older than the dedupe window', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!, 'CA')
  await seedNewOutboxEvent(db, intakeId)
  await seedPriorAcceptedNotification(
    db,
    intakeId,
    hashFor('EMAIL', 'patient@example.test', config.encryptionKey!),
    true
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 1, `expected provider.send called once (outside window), got ${calls.length}`)
})

test('the cycle sends through when the prior accept was for a different recipient', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!, 'CA')
  await seedNewOutboxEvent(db, intakeId)
  // Prior was for a *different* recipient (different phone); dedupe must not match.
  await seedPriorAcceptedNotification(
    db,
    intakeId,
    hashFor('EMAIL', 'someone-else@example.test', config.encryptionKey!),
    false
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 1, 'different recipient must not trigger dedupe')
})
