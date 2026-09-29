import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { connectDatabase } from './db.ts'
import { fileURLToPath } from 'node:url'
import { safeErrorCode } from './security.ts'

let db: ReturnType<typeof connectDatabase> = undefined
try {
  const config = loadConfig()
  db = connectDatabase(config)
  if (config.production) {
    const privileges = await db!.query(
      "SELECT has_table_privilege(current_user, 'audit_events', 'UPDATE, DELETE, TRUNCATE') AS unsafe"
    )
    if (privileges.rows[0]?.unsafe !== false)
      throw new Error('Runtime database role has excessive audit privileges')
  }
  const app = await buildApp(
    config,
    db,
    undefined,
    process.env.SERVE_WEB === 'true'
      ? fileURLToPath(new URL('../dist/', import.meta.url))
      : undefined
  )
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, async () => {
      await app.close()
      await db?.close()
      process.exit(0)
    })
  await app.listen({ port: config.port, host: config.production ? '0.0.0.0' : '127.0.0.1' })
  console.log(JSON.stringify({ event: 'service.started', port: config.port }))
} catch (err) {
  console.error(JSON.stringify({ event: 'service.start_failed', code: safeErrorCode(err) }))
  await db?.close().catch(() => {})
  process.exitCode = 1
}
