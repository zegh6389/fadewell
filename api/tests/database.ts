import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import type { Database, DatabaseConnection, Sql } from '../src/db.ts'
import { connectDatabase } from '../src/db.ts'
import { loadConfig } from '../src/config.ts'

export async function testDatabase(): Promise<Database> {
  if (process.env.TEST_DATABASE_URL) {
    const admin = connectDatabase({
      ...loadConfig({}),
      databaseUrl: process.env.TEST_DATABASE_URL
    })!
    // Roles are cluster-wide; serialize creation across concurrently running test databases.
    await admin.transaction(async (sql) => {
      await sql.query('SELECT pg_advisory_xact_lock(62431900)')
      await sql.query(`DO $$ DECLARE r text; BEGIN
        FOREACH r IN ARRAY ARRAY['mca_runtime','mca_worker'] LOOP
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', r);
          END IF;
        END LOOP;
      END $$`)
    })
    const name = `mca_test_${crypto.randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${name}"`)
    try {
      const url = new URL(process.env.TEST_DATABASE_URL)
      url.pathname = `/${name}`
      const database = connectDatabase({ ...loadConfig({}), databaseUrl: url.href })!
      return {
        ...database,
        async close() {
          await database.close()
          await admin.query(`DROP DATABASE "${name}"`)
          await admin.close()
        }
      }
    } catch (failure) {
      await admin.query(`DROP DATABASE "${name}"`).catch(() => {})
      await admin.close().catch(() => {})
      throw failure
    }
  }
  const pg = new PGlite({ extensions: { btree_gist } })
  const adapt = (sql: { query: Function; exec: Function }): Sql => ({
    query: async (text, values) =>
      values ? sql.query(text, values) : (await sql.exec(text)).at(-1) || { rows: [] }
  })
  const connection: DatabaseConnection = {
    ...adapt(pg),
    transaction: (run) => pg.transaction((tx) => run(adapt(tx)))
  }
  return {
    ...connection,
    withConnection: (run) => run(connection),
    close: () => pg.close()
  }
}
