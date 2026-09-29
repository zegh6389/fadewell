import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { testDatabase } from './database.ts'
import { migrate } from '../src/migrate.ts'
import { seal } from '../src/security.ts'
import type { Database } from '../src/db.ts'

test('providers fail closed and retry only definitive temporary rejections', async () => {
  const { createDeliveryProvider, deliveryFailure } = await import('../src/providers.ts')
  assert.equal(createDeliveryProvider({}).available('EMAIL'), false)
  assert.equal(createDeliveryProvider({}).available('SMS'), false)
  assert.equal(deliveryFailure({ status: 429 }), 'RETRY')
  assert.equal(deliveryFailure({ responseCode: 450 }), 'RETRY')
  assert.equal(deliveryFailure({ responseCode: 550 }), 'FAILED')
  assert.equal(deliveryFailure({ status: 401 }), 'FAILED')
  assert.equal(deliveryFailure({ status: 500 }), 'UNCERTAIN')
  assert.equal(deliveryFailure(new Error('Untrusted network diagnostic')), 'UNCERTAIN')
})

test('notification worker distinguishes consent, verification, delivery, retry and ambiguous acceptance', async (t) => {
  const { runDeliveryCycle: deliver } = await import('../src/delivery.ts')
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const grants = await readFile(new URL('../deploy/worker-grants.sql', import.meta.url), 'utf8')
  await db.query(grants)
  await db.query(grants) // Provisioning must be safe to repeat.
  for (const table of ['identities', 'intakes', 'appointments', 'contact_verifications',
    'outbox_events', 'notifications', 'notification_attempts', 'audit_events'])
    await db.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
  const worker: Database = {
    ...db,
    transaction: (run) => db.transaction(async (sql) => {
      await sql.query('SET LOCAL ROLE mca_worker')
      return run(sql)
    })
  }
  const runDeliveryCycle: typeof deliver = (_db, ...args) => deliver(worker, ...args)
  await assert.rejects(worker.transaction((sql) => sql.query('UPDATE identities SET enabled=false')))
  for (const statement of [
    'UPDATE identities SET id=gen_random_uuid()',
    'UPDATE identities SET created_at=now()',
    'UPDATE intakes SET updated_at=now()',
    'UPDATE appointments SET updated_at=now()',
    'UPDATE contact_verifications SET created_at=now()'
  ]) await assert.rejects(worker.transaction((sql) => sql.query(statement)))
  await assert.rejects(worker.transaction((sql) => sql.query('DELETE FROM audit_events')))
  const key = randomBytes(32).toString('base64')
  const patientId = randomUUID(),
    staffId = randomUUID(),
    intakeId = randomUUID()
  for (const [id, role] of [
    [patientId, 'PATIENT'],
    [staffId, 'STAFF']
  ])
    await db.query('INSERT INTO identities(id,issuer,subject,role) VALUES ($1,$2,$3,$4)', [
      id,
      'https://delivery.test',
      id,
      role
    ])
  const data = {
    firstName: 'Synthetic',
    lastName: 'Patient',
    email: 'synthetic@example.test',
    phone: '+12025550138',
    reason: 'private medical reason',
    answers: {},
    mode: 'VIDEO',
    emailConsent: true,
    smsConsent: false,
    normalized: { email: 'synthetic@example.test', phone: '+12025550138' }
  }
  const retryData = {
    ...data,
    normalized: { email: 'synthetic-retry@example.test', phone: '+12025550138' }
  }
  await db.query(
    "INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,state,state_code) VALUES ($1,$2,'2026-09-initial',$3,'REVIEW_PENDING','CA')",
    [intakeId, patientId, seal(data, key, `intake:${intakeId}`)]
  )
  const queue = async () =>
    db.query(
      'INSERT INTO outbox_events(event_type,resource_id,deduplication_key) VALUES ($1,$2,$3)',
      ['intake.submitted', intakeId, randomUUID()]
    )
  const sent: unknown[] = []
  let outcome = 'ACCEPTED'
  const provider = {
    available: () => true,
    send: async (message: unknown) => {
      sent.push(message)
      return { outcome, receipt: outcome === 'ACCEPTED' ? 'synthetic-receipt' : null }
    }
  }
  await queue()
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(sent.length, 0, 'unverified destination must never be contacted')
  assert.equal(
    (await db.query('SELECT status FROM notifications WHERE intake_id=$1', [intakeId])).rows[0]
      .status,
    'BLOCKED'
  )
  const verificationId = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id,intake_id,channel,encrypted_destination,verified_by) VALUES ($1,$2,'EMAIL',$3,$4)",
    [
      verificationId,
      intakeId,
      seal(data.normalized.email, key, `contact:${verificationId}`),
      staffId
    ]
  )
  await db.query('UPDATE notifications SET available_at=now() WHERE intake_id=$1', [intakeId])
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(sent.length, 1)
  assert.equal(JSON.stringify(sent).includes('private medical reason'), false)
  assert.equal(
    (await db.query('SELECT status FROM notifications WHERE intake_id=$1', [intakeId])).rows[0]
      .status,
    'SENT'
  )
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(sent.length, 1, 'completed notification must not be sent again')

  outcome = 'RETRY'
  // Phase 8 (OC2): a second outbox event to the same recipient within the dedupe window is
  // skipped. To exercise the RETRY path, swap the contact_verification destination to a fresh
  // email so the dedupe check does not match the prior SENT. Revoke the active one first to
  // satisfy the contact_one_active constraint.
  await db.query(
    "UPDATE contact_verifications SET revoked_at=now() WHERE intake_id=$1 AND channel='EMAIL' AND revoked_at IS NULL",
    [intakeId]
  )
  const verificationId2 = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id,intake_id,channel,encrypted_destination,verified_by) VALUES ($1,$2,'EMAIL',$3,$4)",
    [verificationId2, intakeId, seal('synthetic-retry@example.test', key, `contact:${verificationId2}`), staffId]
  )
  await db.query("UPDATE intakes SET encrypted_payload=$1 WHERE id=$2", [
    seal(retryData, key, `intake:${intakeId}`),
    intakeId
  ])
  await queue()
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM notifications WHERE intake_id=$1 AND status='RETRY'",
        [intakeId]
      )
    ).rows[0].n,
    1
  )
  outcome = 'UNCERTAIN'
  await db.query(
    "UPDATE notifications SET available_at=now() WHERE intake_id=$1 AND status='RETRY'",
    [intakeId]
  )
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  const attempts = sent.length
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(sent.length, attempts, 'ambiguous acceptance needs reconciliation, not blind replay')
  await assert.rejects(db.query('DELETE FROM notification_attempts'))

  await queue()
  await db.query('UPDATE intakes SET encrypted_payload=$1 WHERE id=$2', [
    seal({ ...retryData, emailConsent: false }, key, `intake:${intakeId}`),
    intakeId
  ])
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(sent.length, attempts, 'withdrawn consent must suppress delivery')

  await db.query('UPDATE intakes SET encrypted_payload=$1 WHERE id=$2', [
    seal(retryData, key, `intake:${intakeId}`),
    intakeId
  ])
  // Phase 8 (OC2) follow-up: replace the active verification while keeping it aligned with the
  // current retry destination. Otherwise the unavailable check below would BLOCK on destination
  // mismatch (BLOCKED takes precedence over UNAVAILABLE).
  await db.query(
    "UPDATE contact_verifications SET revoked_at=now() WHERE intake_id=$1 AND channel='EMAIL' AND revoked_at IS NULL",
    [intakeId]
  )
  const verificationId3 = randomUUID()
  await db.query(
    "INSERT INTO contact_verifications(id,intake_id,channel,encrypted_destination,verified_by) VALUES ($1,$2,'EMAIL',$3,$4)",
    [verificationId3, intakeId, seal('synthetic-retry@example.test', key, `contact:${verificationId3}`), staffId]
  )
  // Also clear last_recipient_hash so the dedupe window doesn't suppress the unavailable test.
  await db.query("UPDATE notifications SET last_recipient_hash='' WHERE intake_id=$1", [intakeId])
  await queue()
  await runDeliveryCycle(db, key, 'https://care.example.test', {
    ...provider,
    available: () => false
  })
  assert.equal(sent.length, attempts)
  const unavailable = (
    await db.query("SELECT id FROM notifications WHERE intake_id=$1 AND status='UNAVAILABLE'", [
      intakeId
    ])
  ).rows[0]
  assert.ok(unavailable)
  await db.query('UPDATE intakes SET encrypted_payload=$1 WHERE id=$2', [
    seal({ ...retryData, emailConsent: false }, key, `intake:${intakeId}`),
    intakeId
  ])
  await db.query('UPDATE notifications SET available_at=now() WHERE id=$1', [unavailable.id])
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(
    (await db.query('SELECT status FROM notifications WHERE id=$1', [unavailable.id])).rows[0]
      .status,
    'SKIPPED'
  )
  assert.equal(sent.length, attempts, 'consent is rechecked for already-planned jobs')

  await db.query('UPDATE intakes SET encrypted_payload=$1 WHERE id=$2', [
    seal(retryData, key, `intake:${intakeId}`),
    intakeId
  ])
  await queue()
  await runDeliveryCycle(db, key, 'https://care.example.test', {
    ...provider,
    available: () => false
  })
  const crashed = (
    await db.query("SELECT id FROM notifications WHERE intake_id=$1 AND status='UNAVAILABLE'", [
      intakeId
    ])
  ).rows[0]
  await db.query(
    "UPDATE notifications SET status='SENDING',attempts=1,lease_id=$1,lease_until=now()-interval '1 minute' WHERE id=$2",
    [randomUUID(), crashed.id]
  )
  await db.query(
    "INSERT INTO notification_attempts(notification_id,attempt,outcome) VALUES ($1,1,'STARTED')",
    [crashed.id]
  )
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(
    (await db.query('SELECT status FROM notifications WHERE id=$1', [crashed.id])).rows[0].status,
    'UNCERTAIN'
  )
  assert.equal(sent.length, attempts, 'expired leases must not cause duplicate sends')

  outcome = 'RETRY'
  await queue()
  for (let index = 0; index < 5; index += 1) {
    await db.query(
      "UPDATE notifications SET available_at=now() WHERE intake_id=$1 AND status='RETRY'",
      [intakeId]
    )
    await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM notifications WHERE intake_id=$1 AND status='DLQ' AND attempts=5",
        [intakeId]
      )
    ).rows[0].n,
    1
  )
  assert.equal(sent.length, attempts + 5)

  await db.query("UPDATE intakes SET encrypted_payload='invalid-ciphertext' WHERE id=$1", [
    intakeId
  ])
  await queue()
  await runDeliveryCycle(db, key, 'https://care.example.test', provider)
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM outbox_events WHERE resource_id=$1 AND status='FAILED'",
        [intakeId]
      )
    ).rows[0].n,
    1
  )
  assert.equal(sent.length, attempts + 5, 'a corrupt record must not be sent')
})
