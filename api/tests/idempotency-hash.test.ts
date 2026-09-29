import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

/**
 * Phase 6: idempotency-collision replay hardening. The Phase 4 idempotency layer replays the
 * stored response whenever the same key is presented again, regardless of body. An attacker
 * who can guess or precompute a victim's UUID key could overwrite the victim's in-flight
 * intake with attacker-controlled PHI by sending the same key with a different body; today
 * the server replays the FIRST response, which is wrong on multiple axes:
 *   - it silently ignores the attacker's intent to overwrite
 *   - it returns a response that doesn't match what the attacker sent
 *   - it gives the victim no signal that anything is wrong
 *
 * The fix: hash the request body and store it alongside the cached response. On replay, if
 * the hash differs, return 409 IDEMPOTENCY_KEY_MISMATCH so the caller knows their key is
 * already in use with a different payload (and they should use a new key to retry).
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
        cookie: `__Host-fadewell-session=${token}`,
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

test('PUT /api/v1/intake returns 409 IDEMPOTENCY_KEY_MISMATCH when the same key is replayed with a different body', async (t) => {
  const { app, db, patient } = await setupApp(t)
  const key = randomUUID()
  // First call: legitimate save.
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    payload: body()
  })
  assert.equal(first.statusCode, 200, first.body)
  // Second call: same key, different body (e.g., attacker trying to overwrite the victim's
  // intake). Must NOT silently replay; must signal a mismatch.
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': key },
    payload: body({ firstName: 'Attacker' })
  })
  assert.equal(second.statusCode, 409, second.body)
  assert.equal(second.json().error?.code, 'IDEMPOTENCY_KEY_MISMATCH')
  // Exactly one revision row: the attacker's body must not have driven a second save.
  const revisions = (await db.query('SELECT * FROM intake_revisions')).rows
  assert.equal(revisions.length, 1, `expected 1 revision, got ${revisions.length}`)
  // Exactly one cache row (no duplicate from the mismatch attempt).
  const cache = (await db.query('SELECT * FROM idempotency_keys')).rows
  assert.equal(cache.length, 1, `expected 1 cache row, got ${cache.length}`)
})

test('a legitimate retry with a new key after a mismatch still succeeds', async (t) => {
  const { app, patient } = await setupApp(t)
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': randomUUID() },
    payload: body()
  })
  assert.equal(first.statusCode, 200, first.body)
  // New key for the legitimate second save (e.g., user corrected a typo and resubmits).
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: { ...patient.headers, 'idempotency-key': randomUUID() },
    payload: body({ version: first.json().version, firstName: 'Corrected' })
  })
  assert.equal(second.statusCode, 200, second.body)
  assert.notEqual(second.json().version, first.json().version, 'new key must drive a fresh save')
})
