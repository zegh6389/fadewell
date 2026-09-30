import pg from 'pg'
import { allowInsecureTls } from './config.ts'
import type { Config } from './config.ts'
import type { Actor } from './domain.ts'
import { unavailable } from './domain.ts'

export type Row = Record<string, any>
export interface Sql {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>
}
export interface DatabaseConnection extends Sql {
  transaction<T>(run: (sql: Sql) => Promise<T>): Promise<T>
}
export interface Database extends DatabaseConnection {
  withConnection<T>(run: (connection: DatabaseConnection) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export function connectDatabase(
  config: Config,
  opts: { url?: string } = {}
): Database | undefined {
  const databaseUrl = opts.url ?? config.databaseUrl
  if (!databaseUrl) return undefined
  // TLS query parameters can override pg's ssl option. Reject instead of silently weakening verification.
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('Database connection URL is invalid')
  }
  if (
    config.production &&
    ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some((key) => url.searchParams.has(key))
  )
    throw new Error('Configure database TLS through the runtime trust store, not URL overrides')
  const insecure = allowInsecureTls()
  const ssl = insecure ? { rejectUnauthorized: false } : (config.production ? { rejectUnauthorized: true } : undefined)
  if (insecure) console.warn(JSON.stringify({ event: 'tls.verification_disabled' }))
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    ssl
  })
  pool.on('error', () => {
    console.error(JSON.stringify({ event: 'database.connection_failed' }))
  })
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(run) {
      const sql = await pool.connect()
      let broken: unknown
      try {
        await sql.query('BEGIN ISOLATION LEVEL READ COMMITTED')
        const result = await run(sql)
        await sql.query('COMMIT')
        return result
      } catch (error) {
        try {
          await sql.query('ROLLBACK')
        } catch (rollbackError) {
          broken = rollbackError
        }
        throw error
      } finally {
        sql.release(broken ? (broken as Error) : undefined)
      }
    },
    async withConnection(run) {
      const sql = await pool.connect()
      const connection: DatabaseConnection = {
        query: (text, values) => sql.query(text, values),
        async transaction(runInTransaction) {
          await sql.query('BEGIN ISOLATION LEVEL READ COMMITTED')
          try {
            const result = await runInTransaction(sql)
            await sql.query('COMMIT')
            return result
          } catch (error) {
            await sql.query('ROLLBACK').catch(() => {})
            throw error
          }
        }
      }
      let failed = false
      try {
        return await run(connection)
      } catch (error) {
        failed = true
        throw error
      } finally {
        sql.release(failed)
      }
    },
    close: () => pool.end()
  }
}

export function requireDb(db?: Database): Database {
  if (!db) throw unavailable()
  return db
}
export async function audit(
  sql: Sql,
  actor: Pick<Actor, 'id' | 'role'>,
  action: string,
  resource: string,
  id: string | null,
  requestId: string
) {
  await sql.query(
    'INSERT INTO audit_events(actor_id, actor_role, action, resource_type, resource_id, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor.id, actor.role, action, resource, id, requestId]
  )
}
export async function event(sql: Sql, type: string, id: string, version: number) {
  await sql.query(
    'INSERT INTO outbox_events(event_type, resource_id, deduplication_key) VALUES ($1,$2,$3) ON CONFLICT (deduplication_key) DO NOTHING',
    [type, id, `${type}:${id}:${version}`]
  )
}
