import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.ts'
import { connectDatabase, requireDb } from './db.ts'
import type { Database } from './db.ts'
import { questionnaire } from './domain.ts'
import { safeErrorCode } from './security.ts'

// ponytail: tracks the migration being applied so the CLI failure log can name
// it. Names and SQLSTATE codes only; never bodies, payloads, or stacks.
export let currentMigration = 'startup'

const migrationPattern = /^\d+_.+\.sql$/
const checksumTransitions: Record<string, Record<string, string>> = {
  // Approved revisions move index creation into deferred work or document the now-owned cleanup
  // process. Accept only the exact checksums already observed in deployed environments.
  '013_recipient_hash.sql': {
    '48f77a309356b092a422d2a82f6ccdf24badea4a33bb8d24e4aa875d27fb6b83':
      '35b7642b614bba9141452e30eb7808e3dc632fd4e25294e4eb2bd3990b097bfa',
    '8fc2499d7d080e6a2c1bf28252a63b7b105363e848dbd936928bf1f7fc5f2230':
      '35b7642b614bba9141452e30eb7808e3dc632fd4e25294e4eb2bd3990b097bfa'
  },
  '007_intake_state_code.sql': {
    'd7e90a74d5b76e1831db1c5e1748dff64f5cb4ad217ea3fcdd7581b3b109d48c':
      '5436c74e74aebf98f631a63c68f52a0f2399c2002c96b18bdb370aba0371a4e7'
  },
  '008_idempotency_keys.sql': {
    '92e1062e1c37b6cdfc3df7251536f0c38839a1e468f4cdbcc997a2fc37da4283':
      '09e46fec49d5adafb9ac2e4557cbec81dc6085cf88f54443dc3ea4130291d2cf'
  }
}
export async function migrationNames() {
  const folder = new URL('../migrations/', import.meta.url)
  return (await readdir(folder)).filter((n) => migrationPattern.test(n)).sort()
}

// Sentinel that separates the in-transaction statements of a migration file
// from statements that must run OUTSIDE any transaction block (typically
// CREATE INDEX CONCURRENTLY, which Postgres refuses to run inside a
// transaction). The line must match exactly `-- @concurrent` (with optional
// trailing whitespace). Everything BEFORE the sentinel runs inside the
// migration's transaction; everything AFTER runs via `db.query(...)` after
// the transaction commits. This split is what lets a migration add a column
// inside the transaction (so the schema_migrations row records it) and then
// build the index that references the new column without a write-blocking
// table scan during the build.
export const CONCURRENT_SENTINEL = /^-- @concurrent\s*$/m
export function splitMigration(source: string): { inTx: string; outOfTx: string } {
  const [inTx, outOfTx = ''] = source.split(CONCURRENT_SENTINEL)
  return { inTx, outOfTx }
}

export function splitDeferredStatements(source: string): string[] {
  return source
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

const recipientDedupeIndex = /\nCREATE INDEX notifications_dedupe ON notifications\(channel, last_recipient_hash, created_at\)\n  WHERE last_recipient_hash <> '';\s*$/
export function firstDeploymentSource(name: string, source: string): string {
  if (name !== '013_recipient_hash.sql') return source
  // ponytail: the file is already split at the sentinel; only legacy blocking
  // content needs stripping.
  if (source.includes('CREATE INDEX CONCURRENTLY')) return source
  const withoutBlockingIndex = source.replace(recipientDedupeIndex, '\n')
  if (withoutBlockingIndex === source)
    throw new Error('MIGRATION_013_FIRST_DEPLOYMENT_SPLIT_FAILED')
  return withoutBlockingIndex
}

export async function migrate(db: Database) {
  // ponytail: module-scoped phase must reset per invocation so a setup failure
  // never logs the previous run's migration.
  currentMigration = 'startup'
  const folder = new URL('../migrations/', import.meta.url)
  await db.withConnection(async (connection) => {
    // ponytail: transaction-mode poolers reject session-level advisory locks
    // with 42501. Release phases run one-off, so continue unlocked rather than
    // failing every deploy; do not run two migrates concurrently.
    let locked = true
    try {
      await connection.query('SELECT pg_advisory_lock(62431892)')
    } catch (error) {
      if ((error as { code?: string })?.code !== '42501') throw error
      locked = false
      console.log(JSON.stringify({ event: 'migration.lock_unavailable' }))
    }
    try {
      await connection.transaction(async (sql) => {
        await sql.query(
          'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'
        )
        await sql.query(
          'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS deferred_completed_at timestamptz'
        )
        for (const name of await migrationNames()) {
          currentMigration = name
          const source = await readFile(new URL(name, folder), 'utf8')
          const checksum = createHash('sha256').update(source).digest('hex')
          const { inTx, outOfTx } = splitMigration(firstDeploymentSource(name, source))
          const existing = (
            await sql.query(
              'SELECT checksum, deferred_completed_at FROM schema_migrations WHERE name=$1',
              [name]
            )
          ).rows[0] as { checksum: string; deferred_completed_at: Date | null } | undefined
          if (existing) {
            if (existing.checksum !== checksum) {
              const approved = checksumTransitions[name]?.[existing.checksum]
              if (approved !== checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH')
              await sql.query(
                `INSERT INTO audit_events(actor_role, action, resource_type, request_id)
                 VALUES ('SYSTEM','MIGRATION_CHECKSUM_TRANSITION',$1,gen_random_uuid())`,
                [name]
              )
              await sql.query(
                `UPDATE schema_migrations
                 SET checksum=$1,
                     deferred_completed_at=CASE WHEN $4 THEN NULL ELSE now() END
                 WHERE name=$2 AND checksum=$3`,
                [checksum, name, existing.checksum, Boolean(outOfTx.trim())]
              )
            } else if (!outOfTx.trim() && !existing.deferred_completed_at) {
              await sql.query(
                'UPDATE schema_migrations SET deferred_completed_at=now() WHERE name=$1 AND checksum=$2',
                [name, checksum]
              )
            }
            continue
          }
          if (inTx.trim()) await sql.query(inTx)
          await sql.query(
            `INSERT INTO schema_migrations(name, checksum, deferred_completed_at)
             VALUES ($1,$2,CASE WHEN $3 THEN NULL ELSE now() END)`,
            [name, checksum, Boolean(outOfTx.trim())]
          )
        }
        currentMigration = 'questionnaire-seed'
        await sql.query(
          'INSERT INTO questionnaires(version, definition) VALUES ($1,$2) ON CONFLICT (version) DO NOTHING',
          [questionnaire.version, JSON.stringify(questionnaire)]
        )
      })
      // Concurrent index operations must remain outside a transaction, but
      // use the same session so the migration lock stays held until their
      // completion timestamps have been persisted.
      currentMigration = 'deferred-discovery'
      for (const name of await migrationNames()) {
        currentMigration = `${name}#deferred`
        const source = await readFile(new URL(name, folder), 'utf8')
        const checksum = createHash('sha256').update(source).digest('hex')
        const recorded = (
          await connection.query(
            'SELECT checksum, deferred_completed_at FROM schema_migrations WHERE name=$1',
            [name]
          )
        ).rows[0] as { checksum: string; deferred_completed_at: Date | null } | undefined
        if (!recorded || recorded.checksum !== checksum) continue
        const { outOfTx } = splitMigration(source)
        if (!outOfTx.trim() || recorded.deferred_completed_at) continue
        for (const statement of splitDeferredStatements(outOfTx))
          await connection.query(`${statement};`)
        await connection.query(
          'UPDATE schema_migrations SET deferred_completed_at=now() WHERE name=$1 AND checksum=$2',
          [name, checksum]
        )
      }
    } finally {
      // ponytail: report the phase that failed, not the cleanup. Keep
      // 'cleanup' only if the unlock itself rejects.
      const failedPhase = currentMigration
      currentMigration = 'cleanup'
      if (locked) await connection.query('SELECT pg_advisory_unlock(62431892)')
      currentMigration = failedPhase
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let db: Database | undefined
  try {
    db = requireDb(connectDatabase(loadConfig()))
    await migrate(db)
    console.log(JSON.stringify({ event: 'migration.complete' }))
  } catch (err) {
    // ponytail: messages here name schema objects and hosts, never patient
    // data; truncated for log hygiene. Needed because codes alone mislead.
    const detail = String((err as Error)?.message || '').slice(0, 300)
    console.error(
      JSON.stringify({ event: 'migration.failed', migration: currentMigration, code: safeErrorCode(err), detail })
    )
    process.exitCode = 1
  } finally {
    await db?.close()
  }
}
