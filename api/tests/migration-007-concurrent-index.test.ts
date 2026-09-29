import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

async function readMigration007() {
  return readFile(
    new URL('../migrations/007_intake_state_code.sql', import.meta.url),
    'utf8'
  )
}

async function readCorrectiveMigration() {
  return readFile(
    new URL('../migrations/019_rebuild_indexes_concurrently.sql', import.meta.url),
    'utf8'
  )
}

test('migration 007 has the approved concurrent-index checksum', async () => {
  const checksum = createHash('sha256').update(await readMigration007()).digest('hex')
  assert.equal(checksum, '5436c74e74aebf98f631a63c68f52a0f2399c2002c96b18bdb370aba0371a4e7')
})

test('migration 007 defers CREATE INDEX CONCURRENTLY behind the sentinel', async () => {
  const source = await readMigration007()
  assert.match(source, /^-- @concurrent\s*$/m)
  assert.match(source, /CREATE INDEX CONCURRENTLY(?:\s+IF NOT EXISTS)?\s+intakes_state_code/)
})

test('the corrective migration declares the intakes_state_code index as CREATE INDEX CONCURRENTLY', async () => {
  const source = await readCorrectiveMigration()
  assert.match(
    source,
    /CREATE INDEX CONCURRENTLY(?:\s+IF NOT EXISTS)?\s+intakes_state_code/,
    'intakes_state_code must be built CONCURRENTLY so production deploys do not block writes on `intakes` during the index build (IF NOT EXISTS is permitted for idempotent re-runs)'
  )
})

test('the corrective migration marks the concurrent block with the -- @concurrent sentinel', async () => {
  const source = await readCorrectiveMigration()
  assert.match(
    source,
    /^-- @concurrent\s*$/m,
    'migration 007 must split the CONCURRENTLY statement behind a -- @concurrent sentinel so the migration runner executes it after the surrounding ALTER TABLE has committed'
  )
})

test('the corrective migration removes a possibly invalid prior index before rebuilding it', async () => {
  const source = await readCorrectiveMigration()
  const drop = source.indexOf('DROP INDEX CONCURRENTLY IF EXISTS intakes_state_code')
  const create = source.indexOf('CREATE INDEX CONCURRENTLY IF NOT EXISTS intakes_state_code')
  assert.ok(drop >= 0, 'migration 007 must remove an index left invalid by a failed concurrent build')
  assert.ok(create > drop, 'the invalid-index cleanup must run before CREATE INDEX CONCURRENTLY')
})

test('migrate() applies the corrective migration and leaves the intakes_state_code index queryable', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const rows = (
    await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='intakes' AND indexname='intakes_state_code'`
    )
  ).rows as { indexdef: string }[]
  assert.equal(rows.length, 1, 'intakes_state_code index must exist after migrate()')
  assert.match(
    rows[0].indexdef,
    /\(state_code\)/,
    'intakes_state_code index columns must match (state_code)'
  )
  const migration = (
    await db.query(
      "SELECT deferred_completed_at FROM schema_migrations WHERE name='019_rebuild_indexes_concurrently.sql'"
    )
  ).rows[0]
  assert.ok(migration.deferred_completed_at, 'corrective index completion must be persisted after success')
})

test('migrate() audits the approved migration 007 checksum transition', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const historical = 'd7e90a74d5b76e1831db1c5e1748dff64f5cb4ad217ea3fcdd7581b3b109d48c'
  await db.query(
    "UPDATE schema_migrations SET checksum=$1, deferred_completed_at=NULL WHERE name='007_intake_state_code.sql'",
    [historical]
  )
  await migrate(db)
  const migration = (
    await db.query("SELECT checksum, deferred_completed_at FROM schema_migrations WHERE name='007_intake_state_code.sql'")
  ).rows[0]
  assert.equal(migration.checksum, '5436c74e74aebf98f631a63c68f52a0f2399c2002c96b18bdb370aba0371a4e7')
  assert.ok(migration.deferred_completed_at)
})
