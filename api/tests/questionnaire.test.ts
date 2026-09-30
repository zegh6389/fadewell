import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase, testConfig } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'
import { questionnaireSchema } from '../src/questionnaire.ts'

const customVersion = `2030-test-${randomUUID().slice(0, 8)}`
const customQuestionnaire = {
  version: customVersion,
  title: 'Custom evaluation',
  questions: [
    { id: 'primary_symptom', label: 'Primary symptom?', required: true },
    { id: 'duration', label: 'How long?', required: true },
    { id: 'previous_treatment', label: 'Previous treatment?', required: false }
  ]
}

test('questionnaire definitions reject duplicate question IDs', () => {
  const result = questionnaireSchema.safeParse({
    version: 'duplicate-test',
    title: 'Duplicate test',
    questions: [
      { id: 'same', label: 'First', required: true },
      { id: 'same', label: 'Second', required: false }
    ]
  })
  assert.equal(result.success, false)
  if (!result.success) assert.deepEqual(result.error.issues[0].path, ['questions', 1, 'id'])
})

async function setupApp(t: test.TestContext) {
  const config = testConfig()
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='CA'"
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
  const admin = await actor('ADMIN')
  const patient = await actor('PATIENT')
  return { app, db, admin, patient, customVersion, customQuestionnaire }
}

test('GET /api/v1/questionnaire?version=... returns the requested version from the database, not a hardcoded default', async (t) => {
  const { app, admin, customVersion } = await setupApp(t)
  const response = await app.inject({
    url: `/api/v1/questionnaire?version=${customVersion}`,
    headers: admin.headers
  })
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json()
  assert.equal(body.version, customVersion, 'expected endpoint to return DB-seeded version')
  assert.equal(body.title, customQuestionnaire.title)
  assert.deepEqual(
    body.questions.map((q: { id: string }) => q.id),
    customQuestionnaire.questions.map((q) => q.id)
  )
})

test('PUT /api/v1/intake accepts answers keyed by the DB questionnaire question IDs', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      version: 0,
      firstName: 'Synthetic',
      lastName: 'Patient',
      email: 'synthetic@example.test',
      phone: '+12025550138',
      state: 'CA',
      reason: 'Review',
      mode: 'VIDEO',
      smsConsent: false,
      emailConsent: false,
      answers: {
        primary_symptom: 'persistent insomnia',
        duration: '6 weeks',
        previous_treatment: 'melatonin 3mg'
      }
    }
  })
  assert.equal(response.statusCode, 200, response.body)
})

test('PUT /api/v1/intake rejects answer keys that are not part of the active questionnaire', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      version: 0,
      firstName: 'Synthetic',
      lastName: 'Patient',
      email: 'synthetic@example.test',
      phone: '+12025550138',
      state: 'CA',
      reason: 'Review',
      mode: 'VIDEO',
      smsConsent: false,
      emailConsent: false,
      answers: {
        primary_symptom: 'insomnia',
        duration: '6 weeks',
        unknown_field_from_old_version: 'should not pass'
      }
    }
  })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().error?.code, 'UNKNOWN_ANSWER_KEY')
})

test('PUT /api/v1/intake accepts the frontend age gate answer instead of 400ing on it', async (t) => {
  const { app, patient } = await setupApp(t)
  const base = {
    version: 0,
    firstName: 'Synthetic',
    lastName: 'Patient',
    email: 'synthetic@example.test',
    phone: '+12025550138',
    state: 'CA',
    reason: 'Review',
    mode: 'VIDEO',
    smsConsent: false,
    emailConsent: false
  }
  const yes = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      ...base,
      answers: { primary_symptom: 'insomnia', duration: '6 weeks', age_verified: 'Yes' }
    }
  })
  assert.equal(yes.statusCode, 200, yes.body)
  const no = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      ...base,
      version: yes.json().version,
      answers: { primary_symptom: 'insomnia', duration: '6 weeks', age_verified: 'No' }
    }
  })
  assert.equal(no.statusCode, 200, no.body)
  const current = await app.inject({ url: '/api/v1/intake', headers: patient.headers })
  assert.ok(current.json().intake.issues.includes('AGE_REQUIRES_REVIEW'), current.body)
})

test('PUT /api/v1/intake saves missing-required-answer as a review issue, not a 400', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      version: 0,
      firstName: 'Synthetic',
      lastName: 'Patient',
      email: 'synthetic@example.test',
      phone: '+12025550138',
      state: 'CA',
      reason: 'Review',
      mode: 'VIDEO',
      smsConsent: false,
      emailConsent: false,
      answers: {
        primary_symptom: 'insomnia'
        // duration is required by the custom questionnaire; intentionally omitted
      }
    }
  })
  assert.equal(response.statusCode, 200, response.body)
})
