import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

const customVersion = `2030-jurisdiction-${randomUUID().slice(0, 8)}`
const customQuestionnaire = {
  version: customVersion,
  title: 'Custom evaluation',
  questions: [
    { id: 'primary_symptom', label: 'Primary symptom?', required: true },
    { id: 'duration', label: 'How long?', required: true }
  ]
}

// Jurisdiction codes inserted by the immutable seed. Tests explicitly activate AL and CA;
// production remains fail-closed until review-approved rules ship separately.
//   AS  = NOT_SUPPORTED
//   OK  = COMING_SOON, VIDEO only
//   AL  = AVAILABLE,   VIDEO only
//   CA  = AVAILABLE,   VIDEO + PHONE
//   ZZ  = never seeded — exercises the unknown-code branch
const JURISDICTIONS = {
  NOT_SUPPORTED: 'AS',
  COMING_SOON: 'OK',
  AVAILABLE_VIDEO_ONLY: 'AL',
  AVAILABLE_VIDEO_AND_PHONE: 'CA',
  UNKNOWN: 'ZZ'
}

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
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='AL'"
  )
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'"
  )
  await db.query('INSERT INTO questionnaires(version, definition) VALUES ($1, $2)', [
    customVersion,
    JSON.stringify(customQuestionnaire)
  ])
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
  const patient = await actor('PATIENT')
  return { app, db, patient, customVersion }
}

function payload(state: string, mode: string) {
  const answers: Record<string, string> = {
    primary_symptom: 'insomnia',
    duration: '6 weeks',
    age_verified: 'Yes'
  }
  return {
    version: 0,
    firstName: 'Synthetic',
    lastName: 'Patient',
    email: 'synthetic@example.test',
    phone: '+12025550138',
    reason: 'Review',
    state,
    mode,
    smsConsent: false,
    emailConsent: false,
    answers
  }
}

test('PUT /api/v1/intake rejects a state marked NOT_SUPPORTED with 422 JURISDICTION_NOT_SUPPORTED', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.NOT_SUPPORTED, 'VIDEO')
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'JURISDICTION_NOT_SUPPORTED')
})

test('PUT /api/v1/intake rejects a state marked COMING_SOON with 422 JURISDICTION_COMING_SOON', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.COMING_SOON, 'VIDEO')
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'JURISDICTION_COMING_SOON')
})

test('PUT /api/v1/intake rejects a mode that is not in the jurisdiction allowed_visit_types', async (t) => {
  const { app, patient } = await setupApp(t)
  // AL is AVAILABLE but VIDEO-only; PHONE must be rejected as VISIT_TYPE_NOT_ALLOWED.
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.AVAILABLE_VIDEO_ONLY, 'PHONE')
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'VISIT_TYPE_NOT_ALLOWED')
})

test('PUT /api/v1/intake accepts an AVAILABLE jurisdiction when the mode is allowed', async (t) => {
  const { app, patient } = await setupApp(t)
  // CA is AVAILABLE with both VIDEO and PHONE; PHONE is permitted here.
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, 'PHONE')
  })
  assert.equal(response.statusCode, 200, response.body)
})

test('PUT /api/v1/intake rejects an unknown state code with 422 JURISDICTION_UNKNOWN', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.UNKNOWN, 'VIDEO')
  })
  assert.equal(response.statusCode, 422, response.body)
  assert.equal(response.json().error?.code, 'JURISDICTION_UNKNOWN')
})

test('PUT /api/v1/intake returns MISSING_STATE with dedicated copy when state is absent', async (t) => {
  const { app, patient } = await setupApp(t)
  const { state, ...rest } = payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, 'PHONE')
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: rest
  })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().error?.code, 'MISSING_STATE')
  assert.match(response.json().error?.message || '', /State or territory/i)
})

test('PUT /api/v1/intake returns MISSING_STATE when state is empty', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload('', 'PHONE')
  })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().error?.code, 'MISSING_STATE')
})

test('PUT /api/v1/intake returns MISSING_MODE when mode is empty', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, '')
  })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().error?.code, 'MISSING_MODE')
})

test('PUT /api/v1/intake distinguishes invalid state and mode values from missing fields', async (t) => {
  const { app, patient } = await setupApp(t)
  for (const [field, value, code] of [
    ['state', 'California', 'INVALID_STATE'],
    ['mode', 'CHAT', 'INVALID_MODE']
  ] as const) {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/intake',
      headers: patient.headers,
      payload: { ...payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, 'PHONE'), [field]: value }
    })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().error?.code, code)
  }
})

test('PUT /api/v1/intake records age review when age_verified is omitted', async (t) => {
  const { app, patient } = await setupApp(t)
  const request = payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, 'PHONE')
  const { age_verified: _ageVerified, ...answers } = request.answers
  request.answers = answers
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: request
  })
  assert.equal(response.statusCode, 200, response.body)
  const current = await app.inject({ url: '/api/v1/intake', headers: patient.headers })
  assert.ok(current.json().intake.issues.includes('AGE_VERIFICATION_REQUIRED'), current.body)
})

test('PUT /api/v1/intake replays a stored response before mutable jurisdiction validation', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const headers = { ...patient.headers, 'idempotency-key': randomUUID() }
  const request = payload(JURISDICTIONS.AVAILABLE_VIDEO_AND_PHONE, 'VIDEO')
  const first = await app.inject({ method: 'PUT', url: '/api/v1/intake', headers, payload: request })
  assert.equal(first.statusCode, 200, first.body)
  await db.query("UPDATE jurisdictions SET status='NOT_SUPPORTED' WHERE code=$1", [request.state])
  const replay = await app.inject({ method: 'PUT', url: '/api/v1/intake', headers, payload: request })
  assert.equal(replay.statusCode, 200, replay.body)
  assert.deepEqual(replay.json(), first.json())
})
