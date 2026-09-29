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
 * Phase 9: per-recipient rate budget. Sibling to dedupe window. Dedupe catches "same template
 * within 5 min"; this catches "many distinct templates within 1 hour". A victim whose intake
 * flow generates multiple distinct notifications (intake.submitted, contact.verified,
 * intake.correction_requested, intake.approved, ...) could be SMS-spammed even with dedupe in
 * place if the templates are different. The rate budget caps the total to MAX_PER_HOUR per
 * recipient and routes the rejected notification to RATE_LIMITED status with last_error so
 * ops sees what happened.
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
  key: string
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
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', 'CA')",
    [
      intakeId,
      patientId,
      seal(
        { emailConsent: true, smsConsent: false, normalized: { email: 'patient@example.test', phone: null } },
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

function hashFor(channel: 'SMS' | 'EMAIL', recipient: string, key: string) {
  return recipientHash(channel, recipient, key)
}

async function seedPriorSends(
  db: Awaited<ReturnType<typeof testDatabase>>,
  intakeId: string,
  recipientHash: string,
  count: number,
  ageMinutes: number
) {
  // Build a single multi-row INSERT — PGlite miscounts placeholders for repeated INSERTs in a
  // single connection; use literal values only and a fresh statement text per call.
  const eventLiterals: string[] = []
  const notifLiterals: string[] = []
  const ageIso = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString()
  for (let i = 0; i < count; i++) {
    const eId = randomUUID()
    const nId = randomUUID()
    const dedupe = randomUUID()
    eventLiterals.push(`('${eId}', 'template-${i}-${randomUUID()}', '${intakeId}', '${dedupe}', 'PROCESSED')`)
    notifLiterals.push(`('${nId}', '${eId}', '${intakeId}', 'EMAIL', 'SENT', 1, 'stub-prior-${i}-${randomUUID()}', '${recipientHash}', '${ageIso}', '${ageIso}')`)
  }
  await db.query(
    `INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ${eventLiterals.join(', ')}`
  )
  await db.query(
    `INSERT INTO notifications(id, event_id, intake_id, channel, status, attempts, provider_receipt, last_recipient_hash, created_at, updated_at) VALUES ${notifLiterals.join(', ')}`
  )
}

test('a recipient that has received MAX_PER_HOUR sends is rate-limited for further sends', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!)
  const recipientHash = hashFor('EMAIL', 'patient@example.test', config.encryptionKey!)
  // Seed 5 prior ACCEPTED sends to this recipient, 6 minutes ago (outside dedupe window of 5 min,
  // inside rate window of 1 hour). The cycle will then queue a new event and try to send.
  await seedPriorSends(db, intakeId, recipientHash, 5, 6)
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [randomUUID(), intakeId, randomUUID()]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  const allNotifs = (await db.query("SELECT id, channel, status, last_recipient_hash FROM notifications ORDER BY created_at")).rows
  console.log('TEST 1 NOTIFS:', JSON.stringify(allNotifs, null, 2))
  assert.equal(calls.length, 0, 'rate-limited send must NOT invoke provider.send')
  const limited = (
    await db.query("SELECT status, last_error FROM notifications WHERE last_recipient_hash=$1 AND status='RATE_LIMITED'", [recipientHash])
  ).rows[0]
  assert.ok(limited, 'notification must be in RATE_LIMITED status')
  assert.match(String(limited.last_error), /RECIPIENT_RATE_LIMITED/, 'last_error must cite the rate limit code')
})

test('a recipient with fewer than MAX_PER_HOUR sends is allowed through', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!)
  const recipientHash = hashFor('EMAIL', 'patient@example.test', config.encryptionKey!)
  await seedPriorSends(db, intakeId, recipientHash, 2, 6)
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [randomUUID(), intakeId, randomUUID()]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 1, 'expected provider.send called once (within budget)')
})

test('rate budget is per-recipient: 5 sends to alice do not block bob', async (t) => {
  const { db, config } = await setupDb(t)
  const { intakeId } = await seedStaffAndIntake(db, config.encryptionKey!)
  const aliceHash = hashFor('EMAIL', 'alice@example.test', config.encryptionKey!)
  await seedPriorSends(db, intakeId, aliceHash, 5, 6)
  // New event should still send to bob — bob has 0 prior sends this hour.
  await db.query(
    "INSERT INTO outbox_events(id, event_type, resource_id, deduplication_key, status) VALUES ($1, 'intake.submitted', $2, $3, 'QUEUED')",
    [randomUUID(), intakeId, randomUUID()]
  )
  const calls: { to: string; text: string }[] = []
  await runDeliveryCycle(db, config.encryptionKey!, config.origin, stubProvider(calls))
  assert.equal(calls.length, 1, 'bob should still send; per-recipient budget')
})