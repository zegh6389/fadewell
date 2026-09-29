import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, randomToken, seal } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

/**
 * Phase 7 (R4): per-state prescription caps enforcement engine. Each US state has different
 * limits on how much product a certified patient may be dispensed (e.g., OK caps at 3 oz per
 * 30 days, PA caps at 30 grams THC per 30 days). Auditors ask the platform to refuse
 * prescriptions that would exceed the active cap and to log the failing rule; the legacy stack
 * relied on doctors memorising caps, which drifts.
 *
 * The engine lives at POST /api/v1/intakes/:id/prescription (DOCTOR). It loads the patient's
 * jurisdiction from the intake, queries the active caps for that jurisdiction, and rejects
 * prescriptions that exceed any cap with 422 PRESCRIPTION_CAP_EXCEEDED, citing the failing rule.
 */

async function setupApp(t: test.TestContext) {
  const config = {
    ...loadConfig({}),
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64'),
    intakeEnabled: true
  }
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
      await db.query('INSERT INTO identities(id, issuer, subject, role) VALUES ($1, $2, $3, $4)', [
        id,
        'https://identity.test',
        id,
        role
      ])
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
        cookie: `__Host-fadewell-session=${token}`,
        origin: config.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrf
      }
    }
  }
  return { app, db, config, actor }
}

async function seedVerifiedIntake(
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
  // Doctor needs a CONFIRMED appointment for scopedIntake to let them in.
  const now = new Date()
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  const reservedUntil = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const availabilityId = randomUUID()
  await db.query(
    "INSERT INTO availability(id, doctor_id, starts_at, ends_at, timezone, buffer_minutes) VALUES ($1, $2, $3, $4, 'UTC', 5)",
    [availabilityId, doctorId, new Date(now.getTime() - 24 * 3600 * 1000).toISOString(), new Date(now.getTime() + 48 * 3600 * 1000).toISOString()]
  )
  await db.query(
    `INSERT INTO appointments(id, intake_id, patient_id, doctor_id, availability_id, starts_at, ends_at, reserved_until, timezone, mode, created_by, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'VIDEO', $9, $10)`,
    [randomUUID(), intakeId, patientId, doctorId, availabilityId, startsAt, endsAt, reservedUntil, doctorId, randomUUID()]
  )
  return { patientId, intakeId, doctorId }
}

function prescriptionPayload(overrides: Record<string, unknown> = {}) {
  return {
    amountOz: 2,
    refillsRemaining: 0,
    ...overrides
  }
}

test('POST /api/v1/intakes/:id/prescription rejects an amount that exceeds the active jurisdiction cap', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // OK caps at 3 oz per 30 days. Request 4 oz.
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps(jurisdiction_code, metric, max_value, period_days, effective_from)
     VALUES ('OK', 'OZ_PER_30D', 3, 30, current_date)`
  )
  const { intakeId, doctorId } = await seedVerifiedIntake(db, config.encryptionKey!, 'OK')
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: prescriptionPayload({ amountOz: 4 })
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'PRESCRIPTION_CAP_EXCEEDED')
  assert.match(response.json().error?.message || '', /OZ_PER_30D/, 'error must cite the failing cap')
})

test('POST /api/v1/intakes/:id/prescription accepts an amount within the active cap', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps(jurisdiction_code, metric, max_value, period_days, effective_from)
     VALUES ('CA', 'OZ_PER_30D', 8, 30, current_date)`
  )
  const { intakeId, doctorId } = await seedVerifiedIntake(db, config.encryptionKey!, 'CA')
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: prescriptionPayload({ amountOz: 2 })
  })
  assert.equal(response.statusCode, 200, response.body)
})

test('POST /api/v1/intakes/:id/prescription includes a cap active through today', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps
       (jurisdiction_code, metric, max_value, period_days, effective_from, effective_to)
     VALUES ('CA', 'OZ_PER_30D', 8, 30, current_date - 1, current_date + 1)`
  )
  const { intakeId, doctorId } = await seedVerifiedIntake(db, config.encryptionKey!, 'CA')
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: doctor.headers,
    payload: prescriptionPayload({ amountOz: 2 })
  })
  assert.equal(response.statusCode, 200, response.body)
})

test('POST /api/v1/intakes/:id/prescription excludes a cap at its effective_to boundary', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps
       (jurisdiction_code, metric, max_value, period_days, effective_from, effective_to)
     VALUES ('CA', 'OZ_PER_30D', 8, 30, current_date - 1, current_date)`
  )
  const { intakeId, doctorId } = await seedVerifiedIntake(db, config.encryptionKey!, 'CA')
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: doctor.headers,
    payload: prescriptionPayload({ amountOz: 2 })
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'PRESCRIPTION_NO_CAP_DEFINED')
})

test('POST /api/v1/intakes/:id/prescription fails closed when no caps are defined for the jurisdiction', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // No caps seeded for AS — fail closed rather than issue an uncapped prescription.
  const { intakeId, doctorId } = await seedVerifiedIntake(db, config.encryptionKey!, 'AS')
  const doctor = await actor('DOCTOR', doctorId)
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...doctor.headers },
    payload: prescriptionPayload({ amountOz: 1 })
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'PRESCRIPTION_NO_CAP_DEFINED')
})

test('POST /api/v1/intakes/:id/prescription requires DOCTOR role', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps(jurisdiction_code, metric, max_value, period_days, effective_from)
     VALUES ('CA', 'OZ_PER_30D', 8, 30, current_date)`
  )
  const { intakeId } = await seedVerifiedIntake(db, config.encryptionKey!, 'CA')
  const patient = await actor('PATIENT')
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: { ...patient.headers },
    payload: prescriptionPayload()
  })
  assert.equal(response.statusCode, 403, response.body)
})
