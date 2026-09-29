import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// CodeRabbit flagged a check-then-act race in the cumulative-prescription
// path. The flow reads SUM(amount_oz) for (patient_id, metric) and then
// INSERTs a new prescription if the running total + new amount fits under
// cap.max_value. Two concurrent transactions can both read the SAME
// running total (both pre-insert), both see "total + new ≤ cap", and
// both INSERT — combined amount blows past the cap.
//
// Fix: acquire a transaction-scoped advisory lock keyed by (patient_id,
// metric) BEFORE the cumulative SUM, hold it through the INSERT. Two
// concurrent requests for the same (patient, metric) then serialize
// instead of racing; the second one waits for the first to commit and
// sees the inserted row in its SUM.
//
// PGlite is single-connection and serializes queries internally, so the
// concurrent-window race cannot be reproduced inside the test runner.
// The test pins the structural contract — the lock acquisition must be
// present, must use pg_advisory_xact_lock (transaction-scoped, auto-
// released on commit/rollback), and must be positioned BEFORE the
// cumulative SUM and BEFORE the INSERT — so that future refactors cannot
// silently regress to the racy shape.

const ROUTES = fileURLToPath(new URL('../src/routes.ts', import.meta.url))

test('POST /api/v1/intakes/:id/prescription acquires a pg_advisory_xact_lock keyed by patient_id + metric before the cumulative SUM', () => {
  const source = readFileSync(ROUTES, 'utf8')
  // Locate the prescription POST handler.
  const start = source.indexOf("app.post('/api/v1/intakes/:id/prescription'")
  assert.ok(start >= 0, 'could not locate POST /api/v1/intakes/:id/prescription handler')
  const handlerEnd = source.indexOf("\n  }", start)
  assert.ok(handlerEnd > 0, 'could not find end of prescription POST handler')
  const handler = source.slice(start, handlerEnd)
  // The advisory lock must appear inside the db().transaction(async (sql) => ...)
  // body — it must be transaction-scoped so the lock is auto-released on
  // commit/rollback rather than leaking across worker runs.
  const lockPos = handler.indexOf('pg_advisory_xact_lock(')
  assert.ok(lockPos >= 0, 'prescription handler must call pg_advisory_xact_lock to serialize the cumulative check + insert')
  // The cumulative SUM must appear AFTER the lock, and the INSERT must
  // appear AFTER the SUM. Both conditions matter — locking without
  // holding through the INSERT leaves the same race window as no lock.
  const sumPos = handler.indexOf('COALESCE(SUM(amount_oz)')
  const insertPos = handler.indexOf("INSERT INTO prescriptions")
  assert.ok(sumPos >= 0, 'prescription handler must run a SUM(amount_oz) query')
  assert.ok(insertPos >= 0, 'prescription handler must run an INSERT INTO prescriptions')
  assert.ok(
    lockPos < sumPos,
    `advisory lock (offset ${lockPos}) must be acquired BEFORE the cumulative SUM (offset ${sumPos}); otherwise two concurrent transactions can both read the same running total and both pass the cap check`
  )
  assert.ok(
    sumPos < insertPos,
    `cumulative SUM (offset ${sumPos}) must run BEFORE the INSERT (offset ${insertPos}); the lock-then-SUM-then-INSERT sequence is what serializes the check-and-act`
  )
})

test('the advisory lock is keyed by patient_id and metric (both serialized via hashtext)', () => {
  const source = readFileSync(ROUTES, 'utf8')
  const start = source.indexOf("app.post('/api/v1/intakes/:id/prescription'")
  assert.ok(start >= 0)
  const handlerEnd = source.indexOf("\n  }", start)
  const handler = source.slice(start, handlerEnd)
  // The pg_advisory_xact_lock call must use the 2-arg form with both
  // keys wrapped in hashtext($N)::int so the (UUID, metric) pair fits
  // the int4-int4 namespace. Search for the SQL call specifically (with
  // its open paren) so the explanatory comment that mentions
  // pg_advisory_xact_lock by name does not match first.
  const lockLineIdx = handler.indexOf('pg_advisory_xact_lock(')
  assert.ok(lockLineIdx >= 0, 'pg_advisory_xact_lock SQL call must exist (with its open paren)')
  const sliceAfterLock = handler.slice(lockLineIdx, lockLineIdx + 300)
  assert.match(
    sliceAfterLock,
    /pg_advisory_xact_lock\(\s*hashtext\(\$1\)[^,]*,\s*hashtext\(\$2\)/,
    'pg_advisory_xact_lock must use the 2-arg form with hashtext($1)::int and hashtext($2)::int so both (patient_id, metric) keys fit the int4-int4 namespace'
  )
  // The parameter array passed to sql.query must bind those $N positions
  // to intake.patient_id (key #1) and input.metric (key #2).
  assert.match(
    sliceAfterLock,
    /\[\s*intake\.patient_id\s*,\s*input\.metric\s*\]/,
    'lock parameter array must bind $1=intake.patient_id and $2=input.metric — different (patient, metric) pairs must hold independent locks so two unrelated doctors do not serialize against each other'
  )
})

test('the cumulative SUM filter uses (patient_id, metric, signed_at) — the lock keys must match the SUM filter keys', () => {
  const source = readFileSync(ROUTES, 'utf8')
  const start = source.indexOf("app.post('/api/v1/intakes/:id/prescription'")
  assert.ok(start >= 0)
  const handlerEnd = source.indexOf("\n  }", start)
  const handler = source.slice(start, handlerEnd)
  // The SUM aggregates prescriptions for the same patient + metric.
  // The lock MUST be keyed by the same (patient_id, metric) tuple, not
  // by something looser (e.g. just patient_id) — otherwise two doctors
  // issuing concurrent prescriptions for the same patient but DIFFERENT
  // metrics would needlessly serialize against each other.
  const lockSpan = handler.slice(handler.indexOf('pg_advisory_xact_lock'), handler.indexOf('pg_advisory_xact_lock') + 200)
  const sumSpan = handler.slice(handler.indexOf('COALESCE(SUM(amount_oz)'), handler.indexOf('COALESCE(SUM(amount_oz)') + 300)
  assert.match(
    lockSpan,
    /hashtext/,
    'lock must use hashtext for the patient_id and metric keys'
  )
  assert.match(
    sumSpan,
    /intake\.patient_id|patient_id\s*=\s*\$1/,
    'SUM must filter by patient_id'
  )
  assert.match(
    sumSpan,
    /p\.metric\s*=\s*\$2/,
    'SUM must filter by metric'
  )
})
