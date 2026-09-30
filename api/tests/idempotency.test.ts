import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

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
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='CA'"
  )
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
  return { app, db, patient }
}

function body(overrides: Record<string, unknown> = {}) {
  return {
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
      goals: 'Discuss options',
      history: 'None',
      medications: 'None',
      allergies: 'None'
    },
    ...overrides
  }
}

test('PUT /api/v1/intake replays the same response when called twice with the same Idempotency-Key and the same body', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const key = randomUUID()
  const requestBody = body()
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    payload: requestBody
  })
  assert.equal(first.statusCode, 200, first.body)
  const firstBody = first.json()
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    // Same key, same body — server must replay the first response verbatim.
    payload: requestBody
  })
  assert.equal(second.statusCode, 200, second.body)
  assert.deepEqual(second.json(), firstBody, 'replay must return identical response')
  // Exactly one revision row; second call must not have created a second revision.
  const revisions = (await db.query('SELECT * FROM intake_revisions')).rows
  assert.equal(revisions.length, 1, `expected 1 revision, got ${revisions.length}`)
})

test('PUT /api/v1/intake creates a new revision when the Idempotency-Key differs', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': randomUUID() },
    payload: body()
  })
  assert.equal(first.statusCode, 200, first.body)
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': randomUUID() },
    payload: body({ version: first.json().version })
  })
  assert.equal(second.statusCode, 200, second.body)
  assert.notEqual(second.json().version, first.json().version, 'distinct keys must each drive a save')
  const revisions = (await db.query('SELECT * FROM intake_revisions')).rows
  assert.equal(revisions.length, 2, `expected 2 revisions, got ${revisions.length}`)
})

test('PUT /api/v1/intake without an Idempotency-Key still works (backward compatibility)', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: body()
  })
  assert.equal(response.statusCode, 200, response.body)
  const noKeyCache = (await db.query('SELECT * FROM idempotency_keys')).rows
  assert.equal(noKeyCache.length, 0, 'no key must not produce a cache row')
})

test('PUT /api/v1/intake rejects an Idempotency-Key longer than 255 characters', async (t) => {
  const { app, patient } = await setupApp(t)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': 'x'.repeat(256) },
    payload: body()
  })
  assert.equal(response.statusCode, 400, response.body)
  assert.equal(response.json().error?.code, 'INVALID_IDEMPOTENCY_KEY')
})

test('PUT /api/v1/intake replaces an expired Idempotency-Key instead of replaying it', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const key = randomUUID()
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    payload: body()
  })
  assert.equal(first.statusCode, 200, first.body)
  await db.query("UPDATE idempotency_keys SET created_at=now()-interval '25 hours' WHERE key=$1", [key])
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    payload: body({ version: first.json().version, firstName: 'After TTL' })
  })
  assert.equal(second.statusCode, 200, second.body)
  assert.notEqual(second.json().version, first.json().version)
  const cache = (await db.query('SELECT created_at FROM idempotency_keys WHERE key=$1', [key])).rows
  assert.equal(cache.length, 1)
  assert.ok(new Date(cache[0].created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000)
})
