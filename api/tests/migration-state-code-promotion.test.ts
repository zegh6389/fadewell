import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { migrate, migrationNames } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

const promotionUrl = new URL('../deploy/promote-intake-state-code.sql', import.meta.url)

test('the state-code promotion is executable deployment SQL while the applied no-op migration is retained', async () => {
  assert.equal(
    (await migrationNames()).some((name) => name === '015_intake_state_code_promote.sql'),
    true
  )
  const source = await readFile(promotionUrl, 'utf8')
  const addCheck = source.indexOf('ADD CONSTRAINT intakes_state_code_not_null')
  const validateCheck = source.indexOf('VALIDATE CONSTRAINT intakes_state_code_not_null')
  const setNotNull = source.indexOf('ALTER COLUMN state_code SET NOT NULL')
  const dropCheck = source.indexOf('DROP CONSTRAINT intakes_state_code_not_null')
  assert.ok(addCheck >= 0)
  assert.ok(validateCheck > addCheck)
  assert.ok(setNotNull > validateCheck)
  assert.ok(dropCheck > setNotNull)
  assert.match(source, /ALTER TABLE intakes VALIDATE CONSTRAINT intakes_state_code_fkey/)
  assert.match(source, /ALTER TABLE intakes ALTER COLUMN state_code SET NOT NULL/)
})

test('the promotion validates the foreign key and makes state_code required once backfill is complete', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(await readFile(promotionUrl, 'utf8'))
  const column = (
    await db.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='intakes' AND column_name='state_code'`
    )
  ).rows[0]
  const constraint = (
    await db.query(
      `SELECT convalidated FROM pg_constraint
       WHERE conname='intakes_state_code_fkey'`
    )
  ).rows[0]
  assert.equal(column.is_nullable, 'NO')
  assert.equal(constraint.convalidated, true)
})
