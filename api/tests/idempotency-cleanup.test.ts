import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { Database } from '../src/db.ts'
import { runIdempotencyCleanup } from '../src/idempotency-cleanup.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

test('worker cleanup deletes only idempotency records older than 24 hours and audits completion', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(await readFile(new URL('../deploy/worker-grants.sql', import.meta.url), 'utf8'))
  const actor = (
    await db.query(
      "INSERT INTO identities(issuer,subject,role) VALUES ('synthetic',$1,'PATIENT') RETURNING id",
      [randomUUID()]
    )
  ).rows[0]
  for (const [key, age] of [['expired', '25 hours'], ['current', '23 hours']])
    await db.query(
      `INSERT INTO idempotency_keys(scope,actor_id,key,status_code,response,created_at)
       VALUES ('intake:put',$1,$2,200,'{}',now()-($3::text)::interval)`,
      [actor.id, key, age]
    )

  const worker: Database = {
    ...db,
    transaction: (run) => db.transaction(async (sql) => {
      await sql.query('SET LOCAL ROLE mca_worker')
      return run(sql)
    })
  }
  assert.equal(await runIdempotencyCleanup(worker), 1)
  assert.deepEqual(
    (await db.query('SELECT key FROM idempotency_keys ORDER BY key')).rows.map((row) => row.key),
    ['current']
  )
  const audit = (
    await db.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE action='IDEMPOTENCY_CLEANUP_COMPLETED'"
    )
  ).rows[0]
  assert.equal(audit.n, 1)
})
