import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { Database, DatabaseConnection } from '../src/db.ts'
import { firstDeploymentSource, migrate, splitDeferredStatements, splitMigration } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

// CodeRabbit flagged the index created by migration 013 for a production-grade concern: CREATE INDEX
// on a populated `notifications` table takes a SHARE lock that blocks every
// concurrent INSERT/UPDATE — including the delivery worker's attempt writes.
// On a busy Telnyx flow this can stall the pipeline for the duration of the
// index build. The fix is CREATE INDEX CONCURRENTLY, which Postgres requires
// to run OUTSIDE a transaction block. The migration runner therefore has to
// support a non-transactional step within a migration file.

// Helper: read migration 013 off disk so the assertion
// is on the FILE the operator will deploy, not on a parsed intermediate form.
async function readMigration013() {
  return readFile(
    new URL('../migrations/013_recipient_hash.sql', import.meta.url),
    'utf8'
  )
}

test('migration 013 declares the notifications_dedupe index as CREATE INDEX CONCURRENTLY', async () => {
  const source = await readMigration013()
  assert.match(
    source,
    /CREATE INDEX CONCURRENTLY(?:\s+IF NOT EXISTS)?\s+notifications_dedupe/,
    'notifications_dedupe must be built CONCURRENTLY so production deploys do not block writes on `notifications` during the index build (IF NOT EXISTS is permitted for idempotent re-runs)'
  )
})

test('migration 013 marks the concurrent block with the -- @concurrent sentinel', async () => {
  const source = await readMigration013()
  assert.match(
    source,
    /^-- @concurrent\s*$/m,
    'migration 013 must split the CONCURRENTLY statement behind a -- @concurrent sentinel'
  )
})

test('splitMigration separates a migration file at the -- @concurrent sentinel', () => {
  const source = [
    '-- header comment',
    "ALTER TABLE foo ADD COLUMN bar text;",
    '-- @concurrent',
    'CREATE INDEX CONCURRENTLY foo_bar_idx ON foo(bar);'
  ].join('\n')

  const { inTx, outOfTx } = splitMigration(source)
  assert.match(inTx, /ALTER TABLE foo ADD COLUMN bar text/)
  assert.doesNotMatch(inTx, /CONCURRENTLY/)
  assert.match(outOfTx, /CREATE INDEX CONCURRENTLY foo_bar_idx/)
  assert.doesNotMatch(outOfTx, /ALTER TABLE foo ADD COLUMN bar/)
})

test('splitMigration treats a file without the sentinel as wholly transactional', () => {
  const source = [
    'CREATE TABLE x (id int);',
    'CREATE INDEX x_id_idx ON x(id);'
  ].join('\n')
  const { inTx, outOfTx } = splitMigration(source)
  assert.equal(inTx, source)
  assert.equal(outOfTx, '')
})

test('fresh migration 013 applies its columns without the blocking index build', async () => {
  const legacyBlocking = [
    "ALTER TABLE notification_attempts ADD COLUMN recipient_hash text NOT NULL DEFAULT '';",
    "ALTER TABLE notifications ADD COLUMN last_recipient_hash text NOT NULL DEFAULT '';",
    'CREATE INDEX notifications_dedupe ON notifications(channel, last_recipient_hash, created_at)',
    "  WHERE last_recipient_hash <> '';",
    ''
  ].join('\n')
  const firstDeployment = firstDeploymentSource('013_recipient_hash.sql', legacyBlocking)
  assert.match(firstDeployment, /ALTER TABLE notification_attempts ADD COLUMN recipient_hash/)
  assert.match(firstDeployment, /ALTER TABLE notifications ADD COLUMN last_recipient_hash/)
  assert.doesNotMatch(firstDeployment, /CREATE INDEX notifications_dedupe/)
  assert.equal(firstDeploymentSource('unrelated.sql', legacyBlocking), legacyBlocking)
  const current = await readFile(
    new URL('../migrations/013_recipient_hash.sql', import.meta.url),
    'utf8'
  )
  assert.equal(
    firstDeploymentSource('013_recipient_hash.sql', current),
    current,
    'already-split 013 must pass through untouched'
  )
})

test('splitDeferredStatements keeps concurrent operations out of an implicit multi-statement transaction', () => {
  assert.deepEqual(
    splitDeferredStatements(
      'DROP INDEX CONCURRENTLY IF EXISTS example_idx;\nCREATE INDEX CONCURRENTLY example_idx ON example(id);'
    ),
    [
      'DROP INDEX CONCURRENTLY IF EXISTS example_idx',
      'CREATE INDEX CONCURRENTLY example_idx ON example(id)'
    ]
  )
})

test('migrate() holds one session lock through deferred completion updates', async () => {
  const migrations = new Map<string, { checksum: string; completed: Date | null }>()
  let locked = false
  let inTransaction = false
  let connectionCalls = 0
  let deferredQueries = 0
  let completionUpdates = 0

  const connection: DatabaseConnection = {
    async query(text, values = []) {
      if (text.includes('pg_advisory_lock(')) {
        assert.equal(inTransaction, false, 'the session lock must be acquired before the transaction')
        locked = true
        return { rows: [] }
      }
      if (text.includes('pg_advisory_unlock(')) {
        assert.equal(inTransaction, false, 'the session lock must be released outside the transaction')
        assert.ok(
          [...migrations.values()].every((migration) => migration.completed),
          'all deferred migrations must be marked complete before unlocking'
        )
        locked = false
        return { rows: [] }
      }
      assert.equal(locked, true, 'all migration work must run while the session lock is held')
      if (text.startsWith('SELECT checksum, deferred_completed_at')) {
        const recorded = migrations.get(values[0] as string)
        return {
          rows: recorded
            ? [{ checksum: recorded.checksum, deferred_completed_at: recorded.completed }]
            : []
        }
      }
      if (text.includes('INSERT INTO schema_migrations')) {
        migrations.set(values[0] as string, {
          checksum: values[1] as string,
          completed: values[2] ? null : new Date()
        })
      }
      if (/^(?:DROP|CREATE)\s+INDEX\s+CONCURRENTLY/m.test(text)) {
        assert.equal(inTransaction, false, 'concurrent index statements cannot run in a transaction')
        deferredQueries += 1
      }
      if (text.startsWith('UPDATE schema_migrations SET deferred_completed_at')) {
        assert.equal(inTransaction, false, 'completion updates must run after the migration transaction')
        migrations.get(values[0] as string)!.completed = new Date()
        completionUpdates += 1
      }
      return { rows: [] }
    },
    async transaction(run) {
      assert.equal(locked, true)
      assert.equal(inTransaction, false)
      inTransaction = true
      try {
        return await run(connection)
      } finally {
        inTransaction = false
      }
    }
  }
  const db: Database = {
    query: async () => assert.fail('migrate() must not query through the unpinned pool'),
    transaction: async () => assert.fail('migrate() must use the pinned connection transaction'),
    async withConnection(run) {
      connectionCalls += 1
      return run(connection)
    },
    close: async () => {}
  }

  await migrate(db)

  assert.equal(connectionCalls, 1)
  assert.equal(locked, false)
  assert.ok(deferredQueries > 0, 'the fixture migrations must exercise deferred statements')
  assert.ok(completionUpdates > 0, 'the fixture migrations must persist deferred completion')
})

test('migrate() applies the corrective migration and leaves the notifications_dedupe index queryable', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const rows = (
    await db.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='notifications' AND indexname='notifications_dedupe'`
    )
  ).rows as { indexdef: string }[]
  assert.equal(rows.length, 1, 'notifications_dedupe index must exist after migrate()')
  assert.match(
    rows[0].indexdef,
    /\(channel, last_recipient_hash, updated_at\)/,
    'notifications_dedupe index columns must match (channel, last_recipient_hash, updated_at)'
  )
  assert.match(
    rows[0].indexdef,
    /WHERE \(last_recipient_hash <> ''::text\)/,
    'notifications_dedupe must remain a partial index excluding empty hashes'
  )
})

test('migrate() audits the approved migration 013 concurrent-index checksum transitions', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  for (const historical of [
    '48f77a309356b092a422d2a82f6ccdf24badea4a33bb8d24e4aa875d27fb6b83',
    '8fc2499d7d080e6a2c1bf28252a63b7b105363e848dbd936928bf1f7fc5f2230'
  ]) {
    await db.query(
      "UPDATE schema_migrations SET checksum=$1, deferred_completed_at=now() WHERE name='013_recipient_hash.sql'",
      [historical]
    )
    await migrate(db)
    const migration = (
      await db.query(
        "SELECT checksum, deferred_completed_at FROM schema_migrations WHERE name='013_recipient_hash.sql'"
      )
    ).rows[0]
    assert.equal(migration.checksum, '35b7642b614bba9141452e30eb7808e3dc632fd4e25294e4eb2bd3990b097bfa')
    assert.ok(migration.deferred_completed_at)
  }
  const audit = (
    await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='MIGRATION_CHECKSUM_TRANSITION' AND resource_type='013_recipient_hash.sql'"
    )
  ).rows[0]
  assert.equal(audit.n, 2)
})
