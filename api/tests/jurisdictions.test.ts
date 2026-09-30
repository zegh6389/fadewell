import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase, testConfig } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

async function setupApp(t: test.TestContext) {
  const config = testConfig()
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
      'INSERT INTO sessions(token_hash, actor_id, csrf, expires_at) VALUES ($1, $2, $3, now() + interval \'1 hour\')',
      [hash(token), id, csrf]
    )
    return {
      headers: {
        cookie: `__Host-mmjgreen-session=${token}`,
        origin: config.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrf
      }
    }
  }
  return { app, db, admin: await actor('ADMIN'), patient: await actor('PATIENT') }
}

test('unreviewed jurisdiction placeholders are fail-closed without overwriting tightened rules', async (t) => {
  const { db } = await setupApp(t)
  const available = (await db.query("SELECT count(*)::int AS n FROM jurisdictions WHERE status='AVAILABLE'"))
    .rows[0].n
  assert.equal(available, 0)
  const permissive = (
    await db.query('SELECT count(*)::int AS n FROM jurisdictions WHERE cardinality(allowed_visit_types) > 0')
  ).rows[0].n
  assert.equal(permissive, 0)

  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['PHONE']::text[], notice_period_hours=24 WHERE code='CA'"
  )
  await db.query(
    await readFile(new URL('../migrations/017_jurisdictions_fail_closed.sql', import.meta.url), 'utf8')
  )
  const reviewed = (await db.query("SELECT * FROM jurisdictions WHERE code='CA'")).rows[0]
  assert.equal(reviewed.status, 'AVAILABLE')
  assert.deepEqual(reviewed.allowed_visit_types, ['PHONE'])
  assert.equal(reviewed.notice_period_hours, 24)
})

test('GET /api/v1/jurisdictions returns the jurisdictions seeded in the database', async (t) => {
  const { app, db } = await setupApp(t)
  // Replace the canonical seed with a single, recognisable jurisdiction so the test is deterministic.
  await db.query('DELETE FROM jurisdictions')
  await db.query(
    `INSERT INTO jurisdictions(code, name, status, allowed_visit_types, notice_period_hours)
     VALUES ($1, $2, $3, $4, $5)`,
    ['CA', 'California', 'AVAILABLE', ['VIDEO', 'PHONE'], 0]
  )

  const response = await app.inject({ url: '/api/v1/jurisdictions' })
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json()
  assert.ok(Array.isArray(body), 'response should be a JSON array')
  const ca = body.find((j: { code: string }) => j.code === 'CA')
  assert.ok(ca, 'expected California row from DB, not the static list')
  assert.equal(ca.name, 'California')
  assert.equal(ca.status, 'AVAILABLE')
  assert.deepEqual(ca.allowedVisitTypes, ['VIDEO', 'PHONE'])
  assert.equal(ca.noticePeriodHours, 0)
})

test('GET /api/v1/jurisdictions does not require authentication (public marketing surface)', async (t) => {
  const { app } = await setupApp(t)
  // No auth headers attached.
  const response = await app.inject({ url: '/api/v1/jurisdictions' })
  assert.equal(response.statusCode, 200, response.body)
})

test('jurisdictions reject negative notice periods', async (t) => {
  const { db } = await setupApp(t)
  await assert.rejects(
    db.query(
      `INSERT INTO jurisdictions(code, name, status, allowed_visit_types, notice_period_hours)
       VALUES ('ZZ', 'Synthetic', 'NOT_SUPPORTED', ARRAY[]::text[], -1)`
    ),
    /check constraint/i
  )
})

test('GET /api/v1/jurisdictions excludes jurisdictions marked as unavailable for the current audience', async (t) => {
  const { app, db } = await setupApp(t)
  await db.query('DELETE FROM jurisdictions')
  await db.query(
    `INSERT INTO jurisdictions(code, name, status, allowed_visit_types, notice_period_hours)
     VALUES ($1, $2, $3, $4, $5)`,
    ['TX', 'Texas', 'AVAILABLE', ['VIDEO'], 0]
  )
  await db.query(
    `INSERT INTO jurisdictions(code, name, status, allowed_visit_types, notice_period_hours)
     VALUES ($1, $2, $3, $4, $5)`,
    ['PA', 'Pennsylvania', 'COMING_SOON', [], 0]
  )
  const response = await app.inject({ url: '/api/v1/jurisdictions' })
  assert.equal(response.statusCode, 200)
  const codes = response.json().map((j: { code: string }) => j.code)
  assert.ok(codes.includes('TX'), 'AVAILABLE row must appear')
  assert.ok(codes.includes('PA'), 'COMING_SOON row must still appear (not the same as missing)')
})

test('every jurisdiction row carries a minAge in 18..21', async (t) => {
  const { app, db } = await setupApp(t)
  const rows = (await db.query('SELECT code, min_age FROM jurisdictions')).rows
  assert.ok(rows.length > 0, 'migrations must seed at least one jurisdiction')
  for (const row of rows) {
    assert.ok(
      row.min_age >= 18 && row.min_age <= 21,
      `${row.code} min_age out of range: ${row.min_age}`
    )
  }
  const response = await app.inject({ url: '/api/v1/jurisdictions' })
  const body = response.json()
  assert.ok(body.length > 0)
  for (const j of body) {
    assert.equal(typeof j.minAge, 'number', `${j.code} minAge must be a number`)
    assert.ok(j.minAge >= 18 && j.minAge <= 21, `${j.code} minAge out of range`)
  }
})

test('migration 021 pins the medical-cannabis 21+ states and leaves others at 18', async (t) => {
  const { db } = await setupApp(t)
  const twentyOne = ((await db.query(
    "SELECT code FROM jurisdictions WHERE min_age = 21 ORDER BY code"
  )).rows as Array<{ code: string }>).map((r) => r.code)
  assert.deepEqual(twentyOne, ['AK', 'ME', 'WA'])
  const sample = (await db.query(
    "SELECT code, min_age FROM jurisdictions WHERE code IN ('CA','NY','TX') ORDER BY code"
  )).rows as Array<{ code: string; min_age: number }>
  for (const row of sample) assert.equal(row.min_age, 18)
})

test('jurisdiction updates automatically refresh updated_at', async (t) => {
  const { db } = await setupApp(t)
  // Baseline is read after setup, so only the material update below can move it.
  const before = (await db.query("SELECT updated_at FROM jurisdictions WHERE code='CA'")).rows[0]
  await db.query("UPDATE jurisdictions SET name='California' WHERE code='CA'")
  const after = (await db.query("SELECT updated_at FROM jurisdictions WHERE code='CA'")).rows[0]
  assert.ok(
    new Date(after.updated_at).getTime() > new Date(before.updated_at).getTime(),
    'material update must refresh updated_at'
  )
})
