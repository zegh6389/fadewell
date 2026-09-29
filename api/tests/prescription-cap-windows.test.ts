import assert from 'node:assert/strict'
import test from 'node:test'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

test('prescription cap windows reject overlap and preserve adjacent open-ended rules', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps
       (jurisdiction_code, metric, max_value, effective_from, effective_to)
     VALUES ('CA', 'SUPPLY_DAYS', 30, DATE '2026-01-01', DATE '2026-06-01')`
  )
  await assert.rejects(
    db.query(
      `INSERT INTO jurisdiction_prescription_caps
         (jurisdiction_code, metric, max_value, effective_from)
       VALUES ('CA', 'SUPPLY_DAYS', 45, DATE '2026-05-01')`
    ),
    /conflict|exclusion|overlap/i
  )
  await db.query(
    `INSERT INTO jurisdiction_prescription_caps
       (jurisdiction_code, metric, max_value, effective_from)
     VALUES ('CA', 'SUPPLY_DAYS', 45, DATE '2026-06-01')`
  )
})
