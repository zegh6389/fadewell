import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { recipientHash, runDeliveryCycle } from '../src/delivery.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

// CodeRabbit flagged two race conditions in the delivery cycle:
//   1. The checkRecipientDedupe / checkRecipientRateLimit calls observe
//      notification history WITHOUT a recipient-scoped lock. Two concurrent
//      worker cycles for the same recipient can both observe the same
//      history, both pass the budget check, and both call provider.send().
//   2. A SENDING row reserved by another worker must hold capacity without
//      being reported as a confirmed delivery, or two workers can claim the
//      same final hourly slot.
// The fix is two parts: a recipient-scoped advisory lock at the top of
// tx2 (serializes concurrent workers for the same recipient), and a query
// change that tracks SENDING reservations separately from SENT deliveries.
// The reaper at the head of tx2 transitions SENDING rows whose
// lease has expired to UNCERTAIN, so stuck reservations never block the
// budget permanently.

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

async function seedPriorSentNotification(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHashHex: string,
  updatedAtExpression: string
) {
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, provider_receipt, last_recipient_hash, created_at, updated_at)
     VALUES ($1, $2, $3, 'EMAIL', 'SENT', 1, 'stub-prior-receipt', $4, ${updatedAtExpression}, ${updatedAtExpression})`,
    [priorNotifId, priorEventId, intakeId, recipientHashHex]
  )
  return { priorEventId, priorNotifId }
}

// Seed a notification that another worker has reserved but not yet completed
// (tx2 committed, provider.send() in flight). lease_until is in the future so
// the reaper at the head of tx2 does not clean it up.
async function seedInFlightSendingNotification(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHashHex: string
) {
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, lease_id, lease_until, last_recipient_hash, created_at, updated_at)
     VALUES ($1, $2, $3, 'EMAIL', 'SENDING', 1, $4, now() + interval '5 minutes', $5, now() - interval '2 minutes', now() - interval '10 seconds')`,
    [priorNotifId, priorEventId, intakeId, randomUUID(), recipientHashHex]
  )
  return { priorEventId, priorNotifId }
}

async function seedUncertainNotification(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHashHex: string,
  updatedAtExpression: string
) {
  const priorEventId = randomUUID()
  const priorNotifId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'PROCESSED')",
    [priorEventId, intakeId, randomUUID()]
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, last_recipient_hash, created_at, updated_at)
     VALUES ($1, $2, $3, 'EMAIL', 'UNCERTAIN', 1, $4, ${updatedAtExpression}, ${updatedAtExpression})`,
    [priorNotifId, priorEventId, intakeId, recipientHashHex]
  )
  return { priorEventId, priorNotifId }
}

async function seedNewOutboxEvent(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  eventType = 'intake.submitted'
) {
  const eventId = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, $2, $3, $4, 'QUEUED')",
    [eventId, eventType, intakeId, randomUUID()]
  )
  return { eventId }
}

test('rate limit reserves capacity for an in-flight SENDING row so a sixth send cannot start', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // 4 prior SENT sends for the same recipient (under MAX_PER_HOUR=5).
  // 1 in-flight SENDING notification whose lease has not expired (another
  // worker is mid-send right now). Total active reservations = 5.
  for (let i = 0; i < 4; i++) {
    await seedPriorSentNotification(db, intakeId, hash, "now() - interval '30 minutes'")
  }
  await seedInFlightSendingNotification(db, intakeId, hash)
  await seedNewOutboxEvent(db, intakeId)
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  assert.equal(calls.length, 0, 'sixth send must NOT invoke provider.send when 5 are already in flight or sent')
  const limited = (
    await db.query(
      "SELECT status, last_error FROM notifications WHERE last_recipient_hash=$1 AND status='RATE_LIMITED'",
      [hash]
    )
  ).rows[0]
  assert.ok(limited, 'notification must be marked RATE_LIMITED — the in-flight SENDING row reserves capacity')
  assert.equal(
    limited.last_error,
    'RECIPIENT_RATE_LIMITED sentInLastHour=4',
    'the in-flight reservation must not be reported as a confirmed delivery'
  )
})

test('a recent UNCERTAIN outcome defers the same event type instead of sending again', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  await seedUncertainNotification(db, intakeId, hash, "now() - interval '2 minutes'")
  const { eventId } = await seedNewOutboxEvent(db, intakeId, 'intake.submitted')
  const calls: { to: string; text: string }[] = []

  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))

  assert.equal(calls.length, 0)
  const deferred = (
    await db.query('SELECT status,last_error,available_at FROM notifications WHERE event_id=$1', [eventId])
  ).rows[0]
  assert.equal(deferred.status, 'RETRY')
  assert.equal(deferred.last_error, 'RECIPIENT_UNCERTAIN')
  assert.ok(new Date(deferred.available_at).getTime() > Date.now())
})

test('a recent UNCERTAIN outcome reserves hourly recipient capacity', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  for (let i = 0; i < 4; i++)
    await seedPriorSentNotification(db, intakeId, hash, "now() - interval '30 minutes'")
  await seedUncertainNotification(db, intakeId, hash, "now() - interval '30 minutes'")
  await seedNewOutboxEvent(db, intakeId, 'intake.verified')
  const calls: { to: string; text: string }[] = []

  await runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))

  assert.equal(calls.length, 0)
  const limited = (
    await db.query(
      "SELECT last_error FROM notifications WHERE last_recipient_hash=$1 AND status='RATE_LIMITED'",
      [hash]
    )
  ).rows[0]
  assert.equal(limited.last_error, 'RECIPIENT_RATE_LIMITED sentInLastHour=4')
})

test('concurrent cycles for the same recipient are serialized by a recipient-scoped advisory lock', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId: intakeA } = await seedPatientAndContact(db, config.encryptionKey)
  const { intakeId: intakeB } = await seedPatientAndContact(db, config.encryptionKey)
  const hash = recipientHash('EMAIL', 'patient@example.test', config.encryptionKey)
  // Two independent patients resolve to the same recipient. Seed only four
  // confirmed sends, leaving exactly one hourly slot, then queue one event per
  // intake and race the worker cycles for that final slot.
  for (let i = 0; i < 4; i++) {
    await seedPriorSentNotification(db, intakeA, hash, "now() - interval '30 minutes'")
  }
  await seedNewOutboxEvent(db, intakeA, 'intake.submitted')
  await seedNewOutboxEvent(db, intakeB, 'intake.verified')
  const calls: { to: string; text: string }[] = []
  await Promise.all([
    runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls)),
    runDeliveryCycle(db, config.encryptionKey, config.origin, stubProvider(calls))
  ])
  assert.equal(
    calls.length,
    1,
    `provider.send called ${calls.length} times under concurrent cycles; exactly one cycle must claim the final recipient-budget slot`
  )
  const rateLimitedCount = (
    await db.query(
      "SELECT count(*)::int AS n FROM notifications WHERE last_recipient_hash=$1 AND status='RATE_LIMITED'",
      [hash]
    )
  ).rows[0].n
  assert.equal(
    rateLimitedCount,
    1,
    `exactly one notification must be RATE_LIMITED, got ${rateLimitedCount}`
  )
})
