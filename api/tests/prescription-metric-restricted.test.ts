import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { prescriptionInput } from '../src/domain.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'

// CodeRabbit flagged that prescriptionMetric allows GRAMS_THC_PER_30D,
// PERCENT_THC, and SUPPLY_DAYS, but the routes code (and the DB column
// `amount_oz` itself) treats every metric's amount as ounces. A doctor
// submitting `{amountOz: 5, metric: 'GRAMS_THC_PER_30D'}` would store 5 in
// a column named amount_oz and have it compared against the GRAMS cap —
// the cap check itself passes, but the row's column and its metric disagree,
// producing records that are unit-ambiguous when staff queries later try
// to roll up dispensed quantities by metric.
//
// Until metric-specific units are wired end-to-end (column-per-unit or
// explicit unit-conversion in the routes), the schema must reject every
// metric except OZ_PER_30D. The DB CHECK constraint still accepts the four
// values for forward compatibility, but the API boundary now refuses to
// let a non-OZ request through.

test('prescriptionInput accepts OZ_PER_30D explicitly', () => {
  const result = prescriptionInput.safeParse({
    amountOz: 1.5,
    metric: 'OZ_PER_30D'
  })
  assert.equal(result.success, true)
})

test('prescriptionInput defaults the metric to OZ_PER_30D when the field is omitted', () => {
  const result = prescriptionInput.safeParse({ amountOz: 1.5 })
  assert.equal(result.success, true)
  if (result.success) {
    assert.equal(result.data.metric, 'OZ_PER_30D')
  }
})

test('prescriptionInput rejects GRAMS_THC_PER_30D — only OZ_PER_30D is currently supported', () => {
  const result = prescriptionInput.safeParse({
    amountOz: 5,
    metric: 'GRAMS_THC_PER_30D'
  })
  assert.equal(result.success, false)
  if (!result.success) {
    const metricIssue = result.error.issues.find((i) => i.path.includes('metric'))
    assert.ok(metricIssue, 'must surface the rejection as a metric validation issue')
    // Zod v4 emits "invalid_value" for enum-rejected literals; the type
    // union in the installed version omits it so the cast is required.
    assert.equal(
      metricIssue?.code as string,
      'invalid_value',
      `expected Zod v4 enum-rejection code 'invalid_value', got ${metricIssue?.code}`
    )
  }
})

test('prescriptionInput rejects PERCENT_THC — only OZ_PER_30D is currently supported', () => {
  const result = prescriptionInput.safeParse({
    amountOz: 5,
    metric: 'PERCENT_THC'
  })
  assert.equal(result.success, false)
  if (!result.success) {
    const metricIssue = result.error.issues.find((i) => i.path.includes('metric'))
    assert.ok(metricIssue, 'must surface the rejection as a metric validation issue')
    assert.equal(
      metricIssue?.code as string,
      'invalid_value',
      `expected Zod v4 enum-rejection code 'invalid_value', got ${metricIssue?.code}`
    )
  }
})

test('prescriptionInput rejects SUPPLY_DAYS — only OZ_PER_30D is currently supported', () => {
  const result = prescriptionInput.safeParse({
    amountOz: 30,
    metric: 'SUPPLY_DAYS'
  })
  assert.equal(result.success, false)
  if (!result.success) {
    const metricIssue = result.error.issues.find((i) => i.path.includes('metric'))
    assert.ok(metricIssue, 'must surface the rejection as a metric validation issue')
    assert.equal(
      metricIssue?.code as string,
      'invalid_value',
      `expected Zod v4 enum-rejection code 'invalid_value', got ${metricIssue?.code}`
    )
  }
})

test('the corrective migration removes cleartext refills and documents amount_oz', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const columns = (
    await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='prescriptions'"
    )
  ).rows.map((row) => row.column_name)
  assert.equal(columns.includes('refills_remaining'), false)
  const comment = (
    await db.query(
      "SELECT col_description('prescriptions'::regclass, attnum) AS comment FROM pg_attribute WHERE attrelid='prescriptions'::regclass AND attname='amount_oz'"
    )
  ).rows[0].comment
  assert.match(comment, /Approved restricted aggregate/)
})

test('the runtime role has only the columns needed to insert and aggregate prescriptions', async () => {
  const grants = await readFile(new URL('../deploy/runtime-grants.sql', import.meta.url), 'utf8')
  assert.match(grants, /GRANT SELECT \(intake_id, metric, signed_at, amount_oz\) ON prescriptions/)
  assert.match(grants, /GRANT INSERT \(id, intake_id, doctor_id, jurisdiction_code, amount_oz, metric, period_days,/)
  assert.doesNotMatch(grants, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON prescriptions/)
})
