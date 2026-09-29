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
 * Phase 11 (OC3): when a POST /appointments collides with an existing CONFIRMED appointment
 * in the same doctor + tstzrange window, the EXCLUDE USING gist constraint fires. Without a
 * typed Fault, Fastify converts the raw PG error into a 500 with no error.code, so staff
 * can't distinguish "slot just got booked by someone else" from "DB went away". Convert to
 * a structured 409 APPOINTMENT_SLOT_TAKEN so the front-end can show the patient "this time
 * was just taken, please pick another".
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
  await db.query("UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='CA'")
  const logs: Record<string, unknown>[] = []
  const app = await buildApp(config, db, () => logs.push)
  t.after(() => app.close())
  async function actor(role: Role) {
    const id = randomUUID(),
      token = randomToken(),
      csrf = randomToken()
    await db.query("INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, $3, true)", [
      id,
      id,
      role
    ])
    await db.query(
      "INSERT INTO sessions(token_hash, actor_id, csrf, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
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

test('POST /api/v1/appointments returns 409 APPOINTMENT_SLOT_TAKEN when the slot is already booked', async (t) => {
  const { app, db, config, actor } = await setupApp(t)
  // Doctor + two patients
  const doctorId = randomUUID()
  const patientA = randomUUID()
  const patientB = randomUUID()
  const intakeA = randomUUID()
  const intakeB = randomUUID()
  for (const id of [doctorId, patientA, patientB]) {
    await db.query(
      "INSERT INTO identities(id, issuer, subject, role, enabled) VALUES ($1, 'test', $2, $3, true)",
      [id, id, id === doctorId ? 'DOCTOR' : 'PATIENT']
    )
  }
  // Both intakes VERIFIED so scopedIntake in the prescription/notes routes would pass; this test
  // exercises only the appointments route.
  for (const [intakeId, patientId] of [[intakeA, patientA], [intakeB, patientB]] as const) {
    await db.query(
      "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', $3, 'VERIFIED', 'CA')",
       [intakeId, patientId, seal({ mode: 'VIDEO' }, config.encryptionKey!, `intake:${intakeId}`)]
    )
  }
  // Doctor window covering 2pm–6pm UTC tomorrow
  const startsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  const endsAt = new Date(Date.now() + 30 * 3600 * 1000).toISOString()
  const slotId = randomUUID()
  await db.query(
    "INSERT INTO availability(id, doctor_id, starts_at, ends_at, timezone, buffer_minutes) VALUES ($1, $2, $3, $4, 'UTC', 5)",
    [slotId, doctorId, startsAt, endsAt]
  )
  // Patient A already has a CONFIRMED appointment inside this window
  const firstStart = new Date(Date.now() + 25 * 3600 * 1000).toISOString()
  const firstEnd = new Date(Date.now() + 25.5 * 3600 * 1000).toISOString()
  await db.query(
    "INSERT INTO appointments(id, intake_id, patient_id, doctor_id, availability_id, starts_at, ends_at, reserved_until, timezone, mode, created_by, request_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'VIDEO', $9, $10)",
    [randomUUID(), intakeA, patientA, doctorId, slotId, firstStart, firstEnd, firstEnd, doctorId, randomUUID()]
  )
  // Patient B attempts to book an overlapping time — EXCLUDE constraint fires.
  const staff = await actor('STAFF')
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/appointments',
    headers: { ...staff.headers },
    payload: {
      intakeId: intakeB,
      availabilityId: slotId,
      startsAt: firstStart,
      durationMinutes: 15,
      mode: 'VIDEO',
      requestKey: randomUUID()
    }
  })
  assert.equal(response.statusCode, 409, response.body)
  assert.equal(response.json().error?.code, 'APPOINTMENT_SLOT_TAKEN')
})
