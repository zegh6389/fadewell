import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// CodeRabbit flagged that the idempotency replay lookup runs BEFORE the
// transaction and the identity FOR UPDATE lock. Two concurrent requests
// with the same Idempotency-Key can both miss the cache at the pre-tx
// lookup, then both fall through to the transaction. The first one wins
// the identity lock, saves the intake, and writes the idempotency record.
// The second one then fails on the intake version check (the first one
// already incremented it) and returns 409 instead of replaying.
//
// PGlite is single-connection and serializes all queries internally, so
// the concurrent-window race cannot be reproduced inside the test
// runner. The fix is structural: the idempotency lookup must move
// INSIDE the transaction (using the transactional `sql` parameter, not
// the outer `db()` connection) AND it must run AFTER the identity FOR
// UPDATE lock so that, in a real Postgres deployment with multiple
// connections, the second worker's lookup happens after the first
// worker's transaction has committed.
//
// This test pins the structural contract by reading the source. It is
// intentionally a code-shape assertion because the underlying bug only
// manifests under real concurrent load, which PGlite cannot simulate.

const ROUTES = fileURLToPath(new URL('../src/routes.ts', import.meta.url))

test('idempotency_keys lookup in PUT /api/v1/intake runs via the transactional sql.query, not db().query', () => {
  const source = readFileSync(ROUTES, 'utf8')
  // Find every SELECT against idempotency_keys. Each lookup must be reached
  // via `await sql.query(...)` — never `await db().query(...)` — so that the
  // query sees the transactional snapshot rather than a stale outer read.
  const lookupPositions: number[] = []
  let searchFrom = 0
  while (true) {
    const pos = source.indexOf('FROM idempotency_keys', searchFrom)
    if (pos < 0) break
    lookupPositions.push(pos)
    searchFrom = pos + 1
  }
  assert.ok(lookupPositions.length >= 1, 'must find at least one idempotency_keys lookup in routes.ts')
  for (const pos of lookupPositions) {
    const preceding = source.slice(Math.max(0, pos - 500), pos)
    // For each lookup, the most recent query() call preceding it must be
    // `sql.query(...)`, not `db().query(...)`.
    assert.match(
      preceding,
      /await\s+sql\.query\(/,
      'idempotency_keys lookup must be invoked via `await sql.query(...)` — a `db().query` call reads from the outer connection and bypasses the lock + transaction'
    )
    assert.doesNotMatch(
      preceding,
      /await\s+db\(\)\.query\(/,
      'idempotency_keys lookup must NOT be invoked via `db().query(...)` (outer connection) — that was the pre-transaction read that allowed concurrent cache misses'
    )
  }
})

test('idempotency_keys lookup in PUT /api/v1/intake runs AFTER the identity FOR UPDATE lock', () => {
  const source = readFileSync(ROUTES, 'utf8')
  const putStart = source.indexOf("app.put('/api/v1/intake',")
  assert.ok(putStart >= 0, 'could not locate PUT /api/v1/intake handler')
  const nextPutStart = source.indexOf("app.", putStart + 1)
  const handlerSlice = source.slice(putStart, nextPutStart > 0 ? nextPutStart : source.length)
  const lockPos = handlerSlice.indexOf("SELECT id FROM identities WHERE id=$1 FOR UPDATE")
  const lookupPos = handlerSlice.indexOf("FROM idempotency_keys")
  assert.ok(lockPos >= 0, 'must still acquire the identity FOR UPDATE lock')
  assert.ok(lookupPos >= 0, 'must look up idempotency_keys')
  assert.ok(
    lockPos < lookupPos,
    `identity FOR UPDATE lock (offset ${lockPos}) must be acquired BEFORE the idempotency_keys replay lookup (offset ${lookupPos}); otherwise two concurrent workers can both miss the cache before either has committed`
  )
})
