import { z } from 'zod'
import type { Sql } from './db.ts'

export const jurisdictionStatus = z.enum(['AVAILABLE', 'COMING_SOON', 'NOT_SUPPORTED'])
export const visitType = z.enum(['VIDEO', 'PHONE', 'IN_PERSON'])

export const jurisdictionSchema = z.object({
  code: z.string().min(2).max(2),
  name: z.string().min(1).max(120),
  status: jurisdictionStatus,
  allowedVisitTypes: z.array(visitType),
  noticePeriodHours: z.number().int().min(0).max(720),
  minAge: z.number().int().min(18).max(21)
})

export type Jurisdiction = z.infer<typeof jurisdictionSchema>

type RawRow = {
  code: string
  name: string
  status: string
  allowed_visit_types: string[]
  notice_period_hours: number
  min_age: number
}

function hydrate(row: RawRow): Jurisdiction {
  return jurisdictionSchema.parse({
    code: row.code,
    name: row.name,
    status: row.status,
    allowedVisitTypes: row.allowed_visit_types,
    noticePeriodHours: row.notice_period_hours,
    minAge: row.min_age
  })
}

/**
 * Public list: includes every jurisdiction, ordered for the marketing site (status, name).
 * The endpoint decides what the caller sees; consumers should not assume any row is hidden.
 */
export async function listJurisdictions(sql: Sql): Promise<Jurisdiction[]> {
  const rows = (
    await sql.query(
      'SELECT code, name, status, allowed_visit_types, notice_period_hours, min_age FROM jurisdictions ORDER BY status, name'
    )
  ).rows as RawRow[]
  return rows.map(hydrate)
}

/**
 * Lookup a single jurisdiction by code. Returns the raw row (no schema hydration) so callers can
 * decide whether to validate the status / allowed_visit_types fields against the intake input.
 * Returns null when the code is not present so callers can map "not found" to JURISDICTION_UNKNOWN.
 */
export async function getJurisdiction(
  sql: Sql,
  code: string
): Promise<RawRow | null> {
  const rows = (
    await sql.query(
      'SELECT code, name, status, allowed_visit_types, notice_period_hours, min_age FROM jurisdictions WHERE code=$1',
      [code]
    )
  ).rows as RawRow[]
  return rows[0] || null
}