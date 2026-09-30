import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, open, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

// CodeRabbit flagged that the cumulative query window, expires_at, and
// stored period_days all use input.periodDays (the doctor-supplied
// value), not cap.period_days (the regulator-configured value). A
// doctor submitting {amountOz: 3, periodDays: 1} against a state whose
// cap is 8 oz / 30 days can dodge the cumulative check by making the
// rolling window 1 day — the prior 6 oz prescription signed 5 days ago
// is OUTSIDE a 1-day lookback and therefore invisible to the cumulative
// SUM, allowing a 3 oz prescription that puts the patient at 9 oz in
// the rolling window the regulator actually intended to be 8 oz.
//
// Fix: select cap.period_days alongside max_value, then use it for the
// cumulative window, expires_at, and the stored prescription row. The
// doctor-supplied value is no longer authoritative.

async function setupApp(t: test.TestContext, opts?: { capPeriodDays?: number; priorAmountOz?: number; priorDaysAgo?: number }) {
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
  async function actor(role: Role) {
    const id = randomUUID(),
      token = randomToken(),
      csrf = randomToken()
    await db.query('INSERT INTO identities(id, issuer, subject, role) VALUES ($1, $2, $3, $4)', [
      id,
      'https://identity.test',
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
        cookie: `__Host-mmjgreen-session=${token}`,
        origin: config.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrf
      }
    }
  }
  const doctor = await actor('DOCTOR')
  const staff = await actor('STAFF')
  const patientId = randomUUID()
  const intakeId = randomUUID()
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role) VALUES ($1, 'https://identity.test', $2, 'PATIENT')",
    [patientId, patientId]
  )
  await db.query(
    "INSERT INTO questionnaires(version, definition) VALUES ('2026-09-initial', '{}'::jsonb) ON CONFLICT (version) DO NOTHING"
  )
  await db.query(
    "INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code) VALUES ($1, $2, '2026-09-initial', 'encrypted', 'VERIFIED', 'CA')",
    [intakeId, patientId]
  )
  // Doctor needs a CONFIRMED appointment for scopedIntake to authorize the
  // prescription request.
  const now = new Date()
  const availabilityId = randomUUID()
  await db.query(
    "INSERT INTO availability(id, doctor_id, starts_at, ends_at, timezone, buffer_minutes) VALUES ($1, $2, $3, $4, 'UTC', 5)",
    [
      availabilityId,
      doctor.id,
      new Date(now.getTime() - 24 * 3600 * 1000).toISOString(),
      new Date(now.getTime() + 48 * 3600 * 1000).toISOString()
    ]
  )
  await db.query(
    `INSERT INTO appointments(id, intake_id, patient_id, doctor_id, availability_id, starts_at, ends_at, reserved_until, timezone, mode, created_by, request_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'VIDEO', $9, $10)`,
    [
      randomUUID(),
      intakeId,
      patientId,
      doctor.id,
      availabilityId,
      new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      doctor.id,
      randomUUID()
    ]
  )
  // Seed the regulator-configured cap. period_days=30 is the rolling window
  // the regulator intended.
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps(jurisdiction_code, metric, max_value, period_days, effective_from)
     VALUES ('CA', 'OZ_PER_30D', $1, $2, current_date)
     ON CONFLICT (jurisdiction_code, metric, effective_from) DO UPDATE SET max_value=$1, period_days=$2`,
    [8, opts?.capPeriodDays ?? 30]
  )
  // Seed a prior prescription that, inside the regulator's 30-day window,
  // already consumes 6 of the 8 oz allowance.
  await db.query(
    `INSERT INTO prescriptions(id, intake_id, doctor_id, jurisdiction_code, amount_oz, metric, period_days, encrypted_payload, signed_at, expires_at)
     VALUES ($1, $2, $3, 'CA', $4, 'OZ_PER_30D', $5, 'prior-encrypted', now() - ($6 * interval '1 day'), now() + interval '60 days')`,
    [randomUUID(), intakeId, doctor.id, opts?.priorAmountOz ?? 6, opts?.capPeriodDays ?? 30, opts?.priorDaysAgo ?? 5]
  )
  return { app, db, config, doctor, staff, patientId, intakeId }
}

test('cumulative window uses cap.period_days, not input.periodDays — a 1-day client attempt cannot bypass a 30-day cap', async (t) => {
  const { app, doctor, intakeId } = await setupApp(t, {
    capPeriodDays: 30,
    priorAmountOz: 6,
    priorDaysAgo: 5
  })
  // Doctor tries to bypass the 30-day cumulative cap by sending periodDays=1.
  // Without the fix, the SUM uses 1 day (prior 6 oz is OUTSIDE the 1-day
  // window), so the new prescription is allowed even though it pushes the
  // patient to 9 oz in the regulator's actual 30-day window.
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: doctor.headers,
    payload: {
      amountOz: 3,
      metric: 'OZ_PER_30D',
      periodDays: 1
    }
  })
  assert.equal(
    response.statusCode,
    422,
    `expected 422 PRESCRIPTION_CUMULATIVE_EXCEEDED, got ${response.statusCode} — body: ${response.body}`
  )
  const body = response.json()
  assert.equal(body.error?.code, 'PRESCRIPTION_CUMULATIVE_EXCEEDED')
})

test('stored and encrypted period data use cap.period_days, not input.periodDays', async (t) => {
  const { app, db, config, doctor, intakeId } = await setupApp(t, {
    capPeriodDays: 30,
    priorAmountOz: 0.5,
    priorDaysAgo: 0
  })
  // Issue a prescription that passes the cumulative check. expires_at must
  // be cap.period_days (30) from now, not input.periodDays (1).
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/intakes/${intakeId}/prescription`,
    headers: doctor.headers,
    payload: {
      amountOz: 1,
      metric: 'OZ_PER_30D',
      periodDays: 1
    }
  })
  assert.equal(response.statusCode, 200, `body: ${response.body}`)
  const body = response.json() as { id: string; expiresAt: string }
  // Read back the stored prescription row.
  const row = (
    await db.query(
      'SELECT period_days, expires_at, encrypted_payload FROM prescriptions WHERE id=$1',
      [body.id]
    )
  ).rows[0]
  assert.equal(
    row.period_days,
    30,
    `expected stored period_days=30 (from cap), got ${row.period_days} — input.periodDays=1 leaked into the row`
  )
  const expiresAt = new Date(row.expires_at).getTime()
  const now = Date.now()
  const daysUntilExpiry = (expiresAt - now) / 86400000
  // 30 days from now ± a small tolerance for test execution time.
  assert.ok(
    daysUntilExpiry > 29 && daysUntilExpiry <= 30,
    `expected expires_at ~30 days from cap.period_days, got ${daysUntilExpiry.toFixed(2)} days`
  )
  const encrypted = open<{ periodDays: number }>(
    row.encrypted_payload,
    config.encryptionKey!,
    `prescription:${body.id}`
  )
  assert.equal(encrypted.periodDays, 30, 'encrypted payload must use the authoritative cap period')
})
