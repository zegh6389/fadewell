import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import type { Role } from '../src/domain.ts'

const randomToken = () => randomBytes(32).toString('base64url')
const hash = (input: string) => createHash('sha256').update(input).digest('hex')

// CodeRabbit flagged .catch(undefined) on the version query parser: a malformed
// supplied version (empty string, type-mismatched value, over-100-char string)
// is silently coerced to undefined, and the endpoint then returns the latest
// questionnaire with HTTP 200. A client asking for version "X" but sending a
// typo gets back version "Y" — a silent data-integrity bug for clinical
// workflows that bind a patient intake to a specific questionnaire version.
// Remove .catch(undefined) so Zod rejects malformed input at the API boundary.

async function setupApp(t: test.TestContext) {
  const config = {
    ...loadConfig({}),
    encryptionKey: randomBytes(32).toString('base64'),
    origin: 'https://care.example.test'
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
        'x-csrf-token': csrf
      }
    }
  }
  const admin = await actor('ADMIN')
  return { app, db, admin }
}

test('GET /api/v1/questionnaire rejects an empty version query parameter with 4xx', async (t) => {
  const { app, admin } = await setupApp(t)
  const response = await app.inject({
    url: '/api/v1/questionnaire?version=',
    headers: admin.headers
  })
  assert.ok(
    response.statusCode >= 400 && response.statusCode < 500,
    `expected 4xx for empty version, got ${response.statusCode} — body: ${response.body}`
  )
})

test('GET /api/v1/questionnaire rejects an over-length version query parameter with 4xx', async (t) => {
  const { app, admin } = await setupApp(t)
  const tooLong = 'x'.repeat(101)
  const response = await app.inject({
    url: `/api/v1/questionnaire?version=${tooLong}`,
    headers: admin.headers
  })
  assert.ok(
    response.statusCode >= 400 && response.statusCode < 500,
    `expected 4xx for 101-char version, got ${response.statusCode} — body: ${response.body}`
  )
})

test('GET /api/v1/questionnaire rejects a non-string version query parameter (array) with 4xx', async (t) => {
  const { app, admin } = await setupApp(t)
  // ?version=a&version=b sends the same key twice, which the URL parser may
  // collapse into an array. Zod's string() schema must reject the resulting
  // non-string value before any DB query happens.
  const response = await app.inject({
    url: '/api/v1/questionnaire?version=a&version=b',
    headers: admin.headers
  })
  assert.ok(
    response.statusCode >= 400 && response.statusCode < 500,
    `expected 4xx for duplicated-array version, got ${response.statusCode} — body: ${response.body}`
  )
})

test('GET /api/v1/questionnaire without a version query parameter still returns the latest available', async (t) => {
  const { app, admin } = await setupApp(t)
  const response = await app.inject({
    url: '/api/v1/questionnaire',
    headers: admin.headers
  })
  assert.equal(response.statusCode, 200, `body: ${response.body}`)
  // Proves the "no version param" branch is still wired to
  // loadLatestQuestionnaire and was not broken by the .catch(undefined)
  // removal — only malformed inputs are rejected, omitted inputs are fine.
  const body = response.json()
  assert.ok(body.version, `expected a non-empty version in the response, got ${JSON.stringify(body)}`)
})

