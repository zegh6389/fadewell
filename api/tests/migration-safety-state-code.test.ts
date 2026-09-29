import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { migrate } from '../src/migrate.ts'
import type { Database } from '../src/db.ts'
import { testDatabase } from './database.ts'

// CodeRabbit review flagged 007_intake_state_code.sql for two production risks:
//   1. ADD COLUMN ... NOT NULL (no DEFAULT) fails when the table is non-empty.
//      Production deploys that import legacy rows before this migration runs
//      would reject the column add.
//   2. The REFERENCES clause without NOT VALID acquires a SHARE ROW EXCLUSIVE
//      lock on BOTH tables while it validates every existing row. On a large
//      intakes table this blocks writes for the duration of the scan.
// The fix is the canonical Postgres "phased migration" pattern: nullable add,
// NOT VALID FK, then a later migration backfills + VALIDATE CONSTRAINT + SET NOT
// NULL. These tests pin the contract so future migrations follow the same shape.

test('migration 007 leaves intakes.state_code nullable to support phased legacy backfill', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const column = (
    await db.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'intakes' AND column_name = 'state_code'`
    )
  ).rows[0]
  assert.ok(column, 'intakes.state_code column must exist after migration 007')
  assert.equal(
    column.is_nullable,
    'YES',
    'intakes.state_code must be nullable so legacy rows can land before backfill'
  )
})

test('migration 007 adds the state_code foreign key as NOT VALID to avoid a write-blocking scan', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const constraints = (
    await db.query(
      `SELECT conname, convalidated
         FROM pg_constraint
        WHERE conrelid = 'intakes'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) ILIKE '%state_code%'`
    )
  ).rows as { conname: string; convalidated: boolean }[]
  assert.ok(
    constraints.length >= 1,
    'migration 007 must add at least one FK constraint referencing state_code'
  )
  for (const row of constraints) {
    assert.equal(
      row.convalidated,
      false,
      `${row.conname} must be declared NOT VALID so production deploys do not block writes during the validation scan`
    )
  }
})

async function seedPatient(db: import('../src/db.ts').Database) {
  await db.query(
    "INSERT INTO questionnaires(version, definition) VALUES ('test-q', '{}'::jsonb) ON CONFLICT (version) DO NOTHING"
  )
  const patientId = randomUUID()
  await db.query(
    "INSERT INTO identities(id, issuer, subject, role) VALUES ($1, $2, $3, $4)",
    [patientId, 'https://identity.test', patientId, 'PATIENT']
  )
  return patientId
}

test('intakes.state_code accepts NULL rows during the legacy backfill window', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const patientId = await seedPatient(db)
  // Simulate a legacy row in the backfill window: no state_code yet.
  await db.query(
    `INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code)
     VALUES ($1, $2, 'test-q', 'encrypted', 'DRAFT', NULL)`,
    [randomUUID(), patientId]
  )
  const open = (
    await db.query(`SELECT state_code FROM intakes WHERE patient_id = $1`, [patientId])
  ).rows as { state_code: string | null }[]
  assert.equal(open.length, 1)
  assert.equal(open[0].state_code, null)
})

test('intakes.state_code FK still rejects jurisdictions that have no row, even when declared NOT VALID', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const patientId = await seedPatient(db)
  // 'ZZ' is not seeded into jurisdictions (verified by jurisdictions.test.ts).
  await assert.rejects(
    db.query(
      `INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code)
       VALUES ($1, $2, 'test-q', 'encrypted', 'DRAFT', 'ZZ')`,
      [randomUUID(), patientId]
    ),
    /violates foreign key constraint/i,
    'NOT VALID FKs must still reject new inserts whose state_code has no jurisdiction row'
  )
})

test('intakes.state_code accepts a value whose jurisdiction IS seeded, confirming the FK target', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const patientId = await seedPatient(db)
  await db.query(
    `INSERT INTO intakes(id, patient_id, questionnaire_version, encrypted_payload, state, state_code)
     VALUES ($1, $2, 'test-q', 'encrypted', 'DRAFT', 'CA')`,
    [randomUUID(), patientId]
  )
  const rows = (await db.query(`SELECT state_code FROM intakes WHERE patient_id = $1`, [patientId]))
    .rows as { state_code: string }[]
  assert.equal(rows.length, 1)
  assert.equal(rows[0].state_code, 'CA')
})
