import { setTimeout as delay } from 'node:timers/promises'
import { loadConfig } from './config.ts'
import { connectDatabase, requireDb } from './db.ts'
import { runDeliveryCycle } from './delivery.ts'
import { createDeliveryProvider } from './providers.ts'
import { safeErrorCode } from './security.ts'
import { IDEMPOTENCY_CLEANUP_INTERVAL_MS, runIdempotencyCleanup } from './idempotency-cleanup.ts'

try {
  const config = loadConfig(process.env, 'worker')
  const db = requireDb(connectDatabase(config, { url: config.workerDatabaseUrl ?? config.databaseUrl }))
  if (!config.encryptionKey) throw new Error('Worker encryption configuration missing')
  if (
    config.production &&
    (
      await db.query(
        "SELECT has_table_privilege(current_user,'audit_events','UPDATE, DELETE, TRUNCATE') AS unsafe"
      )
    ).rows[0]?.unsafe !== false
  )
    throw new Error('Worker role has excessive privileges')
  const provider = createDeliveryProvider()
  let running = true
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      running = false
    })
  try {
    let nextCleanupAt = 0
    while (running) {
      if (Date.now() >= nextCleanupAt) {
        const startedAt = Date.now()
        try {
          const deleted = await runIdempotencyCleanup(db)
          console.log(JSON.stringify({
            event: 'idempotency.cleanup_completed',
            deleted,
            durationMs: Date.now() - startedAt
          }))
          nextCleanupAt = Date.now() + IDEMPOTENCY_CLEANUP_INTERVAL_MS
        } catch (err) {
          console.error(JSON.stringify({
            event: 'idempotency.cleanup_failed',
            code: safeErrorCode(err),
            durationMs: Date.now() - startedAt
          }))
          nextCleanupAt = Date.now() + 5 * 60 * 1000
        }
      }
      try {
        const worked = await runDeliveryCycle(db, config.encryptionKey, config.origin, provider)
        if (worked) console.log(JSON.stringify({ event: 'delivery.cycle_completed' }))
        await delay(worked ? 50 : 1000)
      } catch (err) {
        console.error(JSON.stringify({ event: 'delivery.cycle_failed', code: safeErrorCode(err) }))
        await delay(5000)
      }
    }
  } finally {
    await db.close()
  }
} catch (err) {
  console.error(JSON.stringify({ event: 'delivery.worker_start_failed', code: safeErrorCode(err) }))
  process.exitCode = 1
}
