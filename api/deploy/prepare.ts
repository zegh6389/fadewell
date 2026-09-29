import { readFile } from 'node:fs/promises'
import { connectDatabase, requireDb } from '../src/db.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'

// Operator-only: pass the migration-owner URL in DATABASE_URL, never deploy it.
const db = requireDb(connectDatabase(loadConfig(process.env, 'worker')))
try {
  const apiLogin = process.env.API_DATABASE_LOGIN
  const workerLogin = process.env.WORKER_DATABASE_LOGIN
  for (const login of [apiLogin, workerLogin])
    if (!login || !/^mca_[a-z_]+$/.test(login) || ['mca_runtime', 'mca_worker'].includes(login))
      throw new Error('A dedicated application login is required')
  if (apiLogin === workerLogin) throw new Error('API and worker logins must be separate')
  await migrate(db)
  await db.transaction(async (sql) => {
    await sql.query("SET LOCAL lock_timeout = '5s'")
    for (const login of [apiLogin, workerLogin]) {
      const role = (await sql.query(
        'SELECT rolcanlogin AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) AS safe FROM pg_roles WHERE rolname=$1',
        [login]
      )).rows[0]
      if (!role?.safe) throw new Error('Application login has unsafe attributes')
    }
    for (const name of ['runtime-grants.sql', 'worker-grants.sql', 'supabase-grants.sql'])
      await sql.query(await readFile(new URL(name, import.meta.url), 'utf8'))
    await sql.query(`GRANT mca_runtime TO "${apiLogin}" WITH INHERIT TRUE`)
    await sql.query(`GRANT mca_worker TO "${workerLogin}" WITH INHERIT TRUE`)
    for (const login of [apiLogin, workerLogin]) {
      const unsafe = (await sql.query(
        "SELECT has_table_privilege($1, 'audit_events', 'UPDATE, DELETE, TRUNCATE') AS unsafe",
        [login]
      )).rows[0]?.unsafe
      if (unsafe !== false) throw new Error('Application login can alter audit history')
    }
  })
  console.log(JSON.stringify({ event: 'deployment.database_prepared' }))
} catch {
  console.error(JSON.stringify({ event: 'deployment.database_prepare_failed' }))
  process.exitCode = 1
} finally {
  await db.close()
}
