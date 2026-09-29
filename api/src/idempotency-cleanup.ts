import { randomUUID } from 'node:crypto'
import type { Database } from './db.ts'

export const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export async function runIdempotencyCleanup(db: Database): Promise<number> {
  return db.transaction(async (sql) => {
    const result = await sql.query(
      "DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'"
    )
    await sql.query(
      `INSERT INTO audit_events(actor_role, action, resource_type, request_id)
       VALUES ('WORKER','IDEMPOTENCY_CLEANUP_COMPLETED','idempotency_keys',$1)`,
      [randomUUID()]
    )
    return result.rowCount ?? 0
  })
}
