import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase, testConfig } from './database.ts'
import { hash, randomToken, seal } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

/**
 * Phase 10 — cumulative prescription tracking. Phase 7 single-prescription check passes two
 * 2oz prescriptions against a 3oz cap (each individually fine). Real regulators want the
 * server to SUM recent prescriptions for the same patient and refuse if the cumulative would
 * exceed the cap. This closes that gap.
 */

async function setupApp(t: test.TestContext) {
  const config = testConfig()
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const logs: Record<string, unknown>[] = []
  const app = await buildApp(config, db, () => logs.push)
  t.after(() => app.close())
  async function actor(role: Role, fixedId?: string) {
    const id = fixedId ?? randomUUID()
    const token = randomToken(),
      csrf = randomToken()
    if (!fixedId) {
      await db.query(
        "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, $3, true)",
        [id, id, role]
      )
    }
    await db.query(
      'INSERT INTO sessions(token_hash, actor_id, csrf, expires_at) VALUES ($1, $2, $3, now() + interval \'1 hour\')',
      [hash(token), id, csrf]
    )
    return {
      id,
      token,
      csrf,
      headers: {
        cookie: `__Host-mmjgreen-session=${token}`,
        origin: config.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrf
      }
    }
  }
  return { app, db, config, actor }
}

async function seedVerifiedIntakeWithAppointment(
  db: Awaited<ReturnType<typeof testDatabase>>,
  key: string,
  state: string
) {
  const patientId = randomUUID()
  const doctorId = randomUUID()
  const intakeId = randomUUID()
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, 'PATIENT', true)",
    [patientId, patientId]
  )
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, 'DOCTOR', true)",
    [doctorId, doctorId]
  )
  await db.query(
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', $4)",
    [intakeId, patientId, seal({ state }, key, `intake:${intakeId}`), state]
  )
  const now = new Date()
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  const reservedUntil = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const availabilityId = randomUUID()
  await db.query(
    "INSERT INTO availability(id, doctor_id, starts_at, ends_at, timezone, buffer_minutes) VALUES ($1, $2, $3, $4, 'UTC', 5)",
    [
      availabilityId,
      doctorId,
      new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
      new Date(now.getTime() + 48 * 3600 * 1000).toISOString()
    ]
  )
  await db.query(
    `INSERT INTO appointments(id, intake_id, patient_id, doctor_id, availability_id, starts_at, ends_at, reserved_until, timezone, mode, created_by, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'VIDEO', $9, $10)`,
    [randomUUID(), intakeId, patientId, doctorId, availabilityId, startsAt, endsAt, reservedUntil, doctorId, randomUUID()]
  )
  return { patientId, intakeId, doctorId }
}

async function seedPriorPrescription(
  db: Awaited<ReturnType<typeof testDatabase>>,
  patientId: string,
  doctorId: string,
  state: string,
  amountOz: number,
  signedAt: Date,
  cap = 3,
  periodDays = 30,
  encryptionKey = ''
) {
  const intakeId = randomUUID()
  const sealedPayload = encryptionKey
    ? seal({}, encryptionKey, `intake:${intakeId}`)
    : 'plain-payload'
  await db.query(
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'COMPLETED', $4)",
    [intakeId, patientId, sealedPayload, state]
  )
  await db.query(
    "INSERT INTO jurisdiction_prescription_caps(jurisdiction_code, metric, max_value, period_days, effective_from) VALUES ($1, 'OZ_PER_30D', $2, $3, current_date) ON CONFLICT (jurisdiction_code, metric, effective_from) DO UPDATE SET max_value=$2",
    [state, cap, periodDays]
  )
  const prescriptionId = randomUUID()
  await db.query(
    `INSERT INTO prescriptions(id, intake_id, doctor_id, jurisdiction_code, amount_oz, metric, period_days, encrypted_payload, signed_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'OZ_PER_30D', $6, 'prior-encrypted', $7, now() + interval '60 days')`,
    [prescriptionId, intakeId, doctorId, state, amountOz, periodDays, signedAt.toISOString()]
  )
}

test('POST prescription rejects when the cumulative amount across prescriptions for the same patient exceeds the cap', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // Cap OK = 3 oz per 30 days. Seed prior 2oz prescription 10 days ago. New prescription for 2oz
  // would total 4oz across the period — over the cap.
  const { patientId, intakeId, doctorId } = await seedVerifiedIntakeWithAppointment(db, config.encryptionKey!, 'OK')
  await seedPriorPrescription(
    db,
    patientId,
    doctorId,
    'OK',
    2,
    new Date(Date.now() - 10 * 24 * 3600 * 1000),
    3,
    30,
    config.encryptionKey!
  )
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: { amountOz: 2 }
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'PRESCRIPTION_CUMULATIVE_EXCEEDED')
  assert.match(response.json().error?.message || '', /running|total|cumulative/i, 'error must cite the running total context')
})

test('POST prescription accepts when cumulative stays under the cap', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // Prior 1oz + new 1oz = 2oz cumulative against 3oz cap → ok.
  const { patientId, intakeId, doctorId } = await seedVerifiedIntakeWithAppointment(db, config.encryptionKey!, 'OK')
  await seedPriorPrescription(
    db,
    patientId,
    doctorId,
    'OK',
    1,
    new Date(Date.now() - 5 * 24 * 3600 * 1000),
    3,
    30,
    config.encryptionKey!
  )
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: { amountOz: 1 }
  })
  assert.equal(response.statusCode, 200, response.body)
})

test('POST prescription accepts when the prior prescription is outside the cap window', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // Prior 3oz 60 days ago, outside the 30-day window. New 3oz should be allowed.
  const { patientId, intakeId, doctorId } = await seedVerifiedIntakeWithAppointment(db, config.encryptionKey!, 'OK')
  await seedPriorPrescription(
    db,
    patientId,
    doctorId,
    'OK',
    3,
    new Date(Date.now() - 60 * 24 * 3600 * 1000),
    3,
    30,
    config.encryptionKey!
  )
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: { amountOz: 3 }
  })
  assert.equal(response.statusCode, 200, response.body)
})
