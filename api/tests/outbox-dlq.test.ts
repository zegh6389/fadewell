import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { runDeliveryCycle } from '../src/delivery.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { seal } from '../src/security.ts'
import type { DeliveryProvider } from '../src/delivery.ts'

/**
 * Outbox DLQ tests. MmjGreen's delivery worker already has lease + retry logic (claims with
 * FOR UPDATE SKIP LOCKED, lease_id + lease_until, exponential backoff, 5-attempt cap). The
 * remaining gap is distinguishing "permanently dead, needs human" (DLQ) from "will retry"
 * (FAILED was overloaded) and capturing the actual provider error on the row. These tests
 * pin those two pieces of behaviour.
 *
 * We pre-seed a notification at attempts=4 in RETRY status so a single runDeliveryCycle call
 * is enough to reach the cap — looping 5 times is testing the cycle, not the DLQ
 * transition. The intake ships with a staff-confirmed EMAIL contact verification so the cycle
 * actually attempts the send (otherwise it short-circuits to BLOCKED).
 */

const stubProvider = (outcome: string): DeliveryProvider => ({
  available: () => true,
  send: async () => ({ outcome, receipt: `stub-${outcome}-${randomUUID().slice(0, 8)}` })
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

async function seedPatientAndIntake(db: Awaited<ReturnType<typeof testDatabase>>, key: string) {
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
  // normalized.email lives on the encrypted payload so the delivery worker can compare it against
  // the staff-confirmed contact_verifications.encrypted_destination during the cycle.
  const normalizedEmail = 'patient@example.test'
  await db.query(
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', 'CA')",
    [
      intakeId,
      patientId,
      seal(
        { emailConsent: true, smsConsent: false, normalized: { email: normalizedEmail, phone: null } },
        key,
        `intake:${intakeId}`
      )
    ]
  )
  // Staff-confirmed EMAIL verification — destination must match normalized.email above.
  const verificationId = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id, intake_id, channel, encrypted_destination, verified_by) VALUES ($1, $2, 'EMAIL', $3, $4)",
    [verificationId, intakeId, seal(normalizedEmail, key, `contact:${verificationId}`), staffId]
  )
  return { patientId, intakeId }
}

async function seedEventAtCap(db: Awaited<ReturnType<typeof testDatabase>>, intakeId: string) {
  const eventId = randomUUID()
  const dedupeKey = randomUUID()
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [eventId, intakeId, dedupeKey]
  )
  // Pre-seed the notification at attempts=4 in RETRY. The cycle claims it, increments to the
  // fifth and final attempt, then decides whether to mark FAILED or DLQ.
  await db.query(
    "INSERT INTO notifications(event_id, intake_id, channel, status, attempts) VALUES ($1, $2, $3, $4, $5)",
    [eventId, intakeId, 'EMAIL', 'RETRY', 4]
  )
  return { eventId }
}

test('a notification transitions to DLQ (not FAILED) when attempts hit the cap and the provider returns RETRY', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndIntake(db, config.encryptionKey!)
  await seedEventAtCap(db, intakeId)
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider('RETRY'))
  const row = (await db.query("SELECT * FROM notifications WHERE intake_id=$1", [intakeId])).rows[0]
  assert.equal(row.status, 'DLQ', `expected DLQ, got ${row.status}`)
})

test('an uncertain outcome remains pending reconciliation at the attempt cap', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndIntake(db, config.encryptionKey!)
  await seedEventAtCap(db, intakeId)
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider('UNCERTAIN'))
  const row = (
    await db.query("SELECT id, status, attempts FROM notifications WHERE intake_id=$1", [intakeId])
  ).rows[0]
  assert.equal(row.status, 'UNCERTAIN')
  assert.equal(row.attempts, 5)
  const audit = (
    await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='DELIVERY_RECONCILIATION_REQUIRED' AND resource_id=$1",
      [row.id]
    )
  ).rows[0]
  assert.equal(audit.n, 1)
})

test('a DLQ row captures the provider outcome and attempt number in last_error', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndIntake(db, config.encryptionKey!)
  await seedEventAtCap(db, intakeId)
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider('RETRY'))
  const row = (await db.query("SELECT * FROM notifications WHERE intake_id=$1", [intakeId])).rows[0]
  assert.ok(row.last_error, 'last_error must be populated on DLQ transition')
  assert.match(String(row.last_error), /RETRY/, 'last_error should mention the provider outcome')
  assert.match(String(row.last_error), /attempt=5/, 'last_error should mention the attempt number')
})

test('a DLQ notification is never re-claimed by subsequent cycles', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndIntake(db, config.encryptionKey!)
  await seedEventAtCap(db, intakeId)
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider('RETRY'))
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider('ACCEPTED'))
  const row = (await db.query("SELECT * FROM notifications WHERE intake_id=$1", [intakeId])).rows[0]
  assert.equal(row.status, 'DLQ', 'DLQ notifications must not be re-claimed')
  assert.ok(row.attempts <= 5, `attempts grew past cap: ${row.attempts}`)
})

test('a legacy RETRY row already at the cap moves to DLQ without calling the provider', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedPatientAndIntake(db, config.encryptionKey!)
  await seedEventAtCap(db, intakeId)
  await db.query("UPDATE notifications SET attempts=5 WHERE intake_id=$1", [intakeId])
  let sends = 0
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, {
    available: () => true,
    send: async () => {
      sends += 1
      return { outcome: 'ACCEPTED', receipt: 'must-not-send' }
    }
  })
  const row = (await db.query("SELECT status, attempts FROM notifications WHERE intake_id=$1", [intakeId])).rows[0]
  assert.equal(row.status, 'DLQ')
  assert.equal(row.attempts, 5)
  assert.equal(sends, 0)
})
