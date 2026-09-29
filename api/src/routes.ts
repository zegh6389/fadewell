import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createVideoRoom, mintVideoToken } from './providers.ts'
import { authenticate, cookieName, hashPassword, usernameInput } from './auth.ts'
import type { Config } from './config.ts'
import { audit, requireDb, event as enqueueOutbox } from './db.ts'
import type { Database, Row, Sql } from './db.ts'
import {
  changeTimer,
  conflict,
  denied,
  Fault,
  intakeInput,
  JurisdictionComingSoonError,
  JurisdictionNotSupportedError,
  JurisdictionUnknownError,
  missing,
  modeAllowedInJurisdiction,
  PrescriptionCapExceededError,
  PrescriptionCumulativeExceededError,
  PrescriptionNoCapDefinedError,
  prescriptionInput,
  unavailable,
  uuid,
  validateIntake,
  VisitTypeNotAllowedError
} from './domain.ts'
import type { Actor, IntakeInput, Role, Timer } from './domain.ts'
import { open, seal, hash, randomToken } from './security.ts'
import { loadLatestQuestionnaire, loadQuestionnaire } from './questionnaire.ts'
import { getJurisdiction, listJurisdictions } from './jurisdictions.ts'
import { createHash } from 'node:crypto'

// Canonicalise a parsed JSON body so a hash is stable across key-order differences. Two requests
// with the same key/value pairs in different orders must hash identically.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}'
}
function payloadHash(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

const versionInput = z.strictObject({ version: z.number().int().positive() })
const idParam = (request: FastifyRequest) => z.object({ id: uuid }).parse(request.params).id
const timezone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  })
const dateTime = z.iso.datetime()

export function registerRoutes(
  app: FastifyInstance,
  database: Database | undefined,
  config: Config
) {
  const db = () => requireDb(database)
  const key = () => {
    if (!config.encryptionKey) throw unavailable()
    return config.encryptionKey
  }
  const auth = (request: FastifyRequest, allowed?: Role[]) =>
    authenticate(request, database, config, allowed)
  const payload = (row: Row) =>
    open<IntakeInput & { normalized: { email: string | null; phone: string | null } }>(
      row.encrypted_payload,
      key(),
      `intake:${row.id}`
    )
  const patientView = (row: Row) => ({
    id: row.id,
    patientId: row.patient_id,
    questionnaireVersion: row.questionnaire_version,
    state: row.state,
    issues: row.issues,
    version: row.version,
    updatedAt: row.updated_at,
    data: payload(row)
  })
  async function scopedIntake(sql: Sql, actor: Actor, id: string) {
    const row = (
      await sql.query(
        `SELECT i.* FROM intakes i WHERE i.id=$1 AND
      ($2 IN ('STAFF','ADMIN') OR ($2='PATIENT' AND i.patient_id=$3) OR
      ($2='DOCTOR' AND EXISTS (SELECT 1 FROM appointments a WHERE a.intake_id=i.id AND a.doctor_id=$3 AND a.status IN ('CONFIRMED','COMPLETED'))))`,
        [id, actor.role, actor.id]
      )
    ).rows[0]
    if (!row) throw missing()
    return row
  }
  async function revision(sql: Sql, actor: Actor, row: Row) {
    await sql.query(
      'INSERT INTO intake_revisions(intake_id, version, encrypted_payload, actor_id) VALUES ($1,$2,$3,$4)',
      [row.id, row.version, row.encrypted_payload, actor.id]
    )
  }

  app.get('/api/v1/questionnaire', async (request) => {
    await auth(request)
    // No .catch(undefined): a malformed supplied version (empty string,
    // over-100-char string, non-string type) must be rejected at the API
    // boundary so the client does not silently receive the latest
    // questionnaire when it asked for a specific one. loadLatestQuestionnaire
    // is reached only when request.query.version is literally undefined.
    const requested = z
      .string()
      .min(1)
      .max(100)
      .optional()
      .parse((request.query as { version?: unknown } | undefined)?.version)
    const sql = db()
    const q = requested
      ? await loadQuestionnaire(requested, sql)
      : await loadLatestQuestionnaire(sql)
    if (!q) throw missing()
    return q
  })

  app.get('/api/v1/jurisdictions', async () => {
    return listJurisdictions(db())
  })

  app.get('/api/v1/intake', async (request) => {
    const actor = await auth(request, ['PATIENT'])
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          "SELECT * FROM intakes WHERE patient_id=$1 AND state NOT IN ('COMPLETED','CANCELLED') ORDER BY created_at DESC LIMIT 1",
          [actor.id]
        )
      ).rows[0]
      await audit(sql, actor, 'INTAKE_VIEWED', 'intake', row?.id || null, request.id)
      if (!row) return { intake: null }
      const doc = (
        await sql.query('SELECT id, id_type, mime, created_at FROM id_documents WHERE intake_id=$1', [row.id])
      ).rows[0]
      return {
        intake: {
          ...patientView(row),
          idDocument: doc
            ? { id: doc.id, idType: doc.id_type, mime: doc.mime, createdAt: doc.created_at }
            : null
        }
      }
    })
  })

  app.put('/api/v1/intake', async (request, reply) => {
    const actor = await auth(request, ['PATIENT'])
    if (!config.intakeEnabled) throw unavailable()
    const input = intakeInput.parse(request.body)
    const { version: _version, requestKey: _requestKey, ...raw } = input
    const { state } = raw
    // Idempotency replay length check happens up front so a malformed key
    // can be rejected with 400 before the transaction is even opened — the
    // hash-cache lookup itself is intentionally NOT done here. It must run
    // inside the transaction, after the identity FOR UPDATE lock, so that
    // two concurrent workers for the same (actor, key) cannot both miss
    // the cache, both fall through, and the second one then 409s on the
    // intake version check instead of replaying the first response.
    const idempotencyKey = (request.headers['idempotency-key'] as string | undefined)?.trim()
    let idempotencyHash: string | undefined
    if (idempotencyKey !== undefined) {
        if (idempotencyKey.length === 0 || idempotencyKey.length > 255)
          throw new Fault(
            400,
            'INVALID_IDEMPOTENCY_KEY',
            'Idempotency-Key must be 1-255 characters.'
          )
        idempotencyHash = payloadHash(request.body)
      }
    return db().transaction(async (sql) => {
      // Lock the identity even before a draft exists, so two tabs cannot both create one.
      await sql.query('SELECT id FROM identities WHERE id=$1 FOR UPDATE', [actor.id])
      // Idempotency replay runs INSIDE the transaction, after the identity
      // lock, so a second concurrent worker for the same (actor, key)
      // cannot slip past the lookup before this worker's transaction has
      // committed the cached response. Same-key + different-body still
      // throws 409 IDEMPOTENCY_KEY_MISMATCH; same-key + same-body returns
      // the stored response verbatim.
      if (idempotencyKey !== undefined && idempotencyHash !== undefined) {
        const replay = (
          await sql.query(
            `SELECT status_code, response, payload_hash FROM idempotency_keys
             WHERE scope=$1 AND actor_id=$2 AND key=$3
               AND created_at > now() - interval '24 hours'`,
            ['intake:put', actor.id, idempotencyKey]
          )
        ).rows[0]
        if (replay) {
          if (replay.payload_hash !== idempotencyHash)
            throw new Fault(
              409,
              'IDEMPOTENCY_KEY_MISMATCH',
              'Idempotency-Key was already used with a different request body. Generate a new key for a different operation.'
            )
          reply.code(replay.status_code)
          return replay.response
        }
        await sql.query(
          `DELETE FROM idempotency_keys
           WHERE scope=$1 AND actor_id=$2 AND key=$3
             AND created_at <= now() - interval '24 hours'`,
          ['intake:put', actor.id, idempotencyKey]
        )
      }
      // Replays return the stored response before consulting mutable
      // jurisdiction policy. New writes validate against the same transaction
      // that persists the intake.
      const jurisdiction = await getJurisdiction(sql, state)
      if (!jurisdiction) throw new JurisdictionUnknownError(state)
      if (jurisdiction.status === 'NOT_SUPPORTED') throw new JurisdictionNotSupportedError(state)
      if (jurisdiction.status === 'COMING_SOON') throw new JurisdictionComingSoonError(state)
      if (!modeAllowedInJurisdiction(input.mode, jurisdiction.allowed_visit_types))
        throw new VisitTypeNotAllowedError(state, input.mode)
      const existing = (
        await sql.query(
          "SELECT * FROM intakes WHERE patient_id=$1 AND state NOT IN ('COMPLETED','CANCELLED') FOR UPDATE",
          [actor.id]
        )
      ).rows[0]
      if (existing && !['DRAFT', 'NEEDS_CORRECTION'].includes(existing.state)) throw conflict()
      // Resolve the questionnaire definition from the DB. New intakes bind to the latest version; existing
      // intakes keep their original version so answers stay valid across subsequent definitions.
      const active = existing
        ? await loadQuestionnaire(existing.questionnaire_version, sql)
        : await loadLatestQuestionnaire(sql)
      if (!active) throw unavailable()
      if (input.requestKey && existing?.save_key === input.requestKey) {
        const { normalized: _normalized, ...previous } = payload(existing)
        if (JSON.stringify(previous) !== JSON.stringify(raw)) throw conflict()
        return {
          id: existing.id,
          version: existing.version,
          state: existing.state,
          savedAt: existing.updated_at
        }
      }
      if ((existing?.version || 0) !== input.version) throw conflict()
      const id = existing?.id || randomUUID()
      const validation = validateIntake(input, active)
      if (existing) {
        const previous = payload(existing).normalized
        for (const [channel, before, after] of [
          ['EMAIL', previous.email, validation.normalized.email],
          ['SMS', previous.phone, validation.normalized.phone]
        ]) {
          if (before === after) continue
          const revoked = (
            await sql.query(
              'UPDATE contact_verifications SET revoked_at=now() WHERE intake_id=$1 AND channel=$2 AND revoked_at IS NULL RETURNING id',
              [id, channel]
            )
          ).rows
          for (const target of revoked)
            await audit(
              sql,
              actor,
              'CONTACT_VERIFICATION_REVOKED',
              'contact',
              target.id,
              request.id
            )
        }
      }
      const encrypted = seal({ ...raw, normalized: validation.normalized }, key(), `intake:${id}`)
      const row = existing
        ? (
            await sql.query(
              "UPDATE intakes SET encrypted_payload=$1, issues=$2, state='DRAFT', version=version+1, updated_at=now(), save_key=$4, state_code=$5 WHERE id=$3 RETURNING *",
              [encrypted, validation.issues, id, input.requestKey || null, state]
            )
          ).rows[0]
        : (
            await sql.query(
              'INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,issues,save_key,state_code) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
              [
                id,
                actor.id,
                active.version,
                encrypted,
                validation.issues,
                input.requestKey || null,
                state
              ]
            )
          ).rows[0]
      await revision(sql, actor, row)
      await audit(sql, actor, 'INTAKE_SAVED', 'intake', id, request.id)
      const result = { id, version: row.version, state: row.state, savedAt: row.updated_at }
      if (idempotencyKey !== undefined) {
        // Cache the response so a replay of this key returns the same payload. Inserting inside
        // the transaction keeps the cache atomic with the write: if the transaction rolls back,
        // the cache row is gone too and a retry will re-execute rather than replay a phantom.
        // payload_hash is bound to the request body so a later same-key + different-body attempt
        // is refused with IDEMPOTENCY_KEY_MISMATCH instead of replaying this response.
        await sql.query(
          `INSERT INTO idempotency_keys(scope, actor_id, key, status_code, response, payload_hash)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scope, actor_id, key) DO NOTHING`,
          ['intake:put', actor.id, idempotencyKey, 200, JSON.stringify(result), idempotencyHash]
        )
      }
      return result
    })
  })

  // ponytail: ID bytes live encrypted in PG (no object store to provision);
  // client downscales to <=2 MB before upload, per-route bodyLimit covers it.
  const idDocumentInput = z.strictObject({
    idType: z.enum(['DRIVERS_LICENSE', 'STATE_ID', 'PASSPORT', 'MILITARY_ID']),
    mime: z.enum(['image/jpeg', 'image/png']),
    data: z.string().min(100).max(2800000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
  })
  app.post('/api/v1/intake/id-document', { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const actor = await auth(request, ['PATIENT'])
    if (!config.intakeEnabled) throw unavailable()
    const input = idDocumentInput.parse(request.body)
    const bytes = Buffer.from(input.data, 'base64')
    if (bytes.length === 0 || bytes.length > 2097152)
      throw new Fault(400, 'INVALID_ID_DOCUMENT', 'Upload a clear photo of your ID, no larger than 2 MB.')
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    if ((input.mime === 'image/jpeg') !== isJpeg || (input.mime === 'image/png') !== isPng)
      throw new Fault(400, 'INVALID_ID_DOCUMENT', 'Upload a JPEG or PNG photo of your ID.')
    return db().transaction(async (sql) => {
      const intake = (
        await sql.query(
          "SELECT * FROM intakes WHERE patient_id=$1 AND state NOT IN ('COMPLETED','CANCELLED') FOR UPDATE",
          [actor.id]
        )
      ).rows[0]
      if (!intake) throw missing()
      if (!['DRAFT', 'NEEDS_CORRECTION'].includes(intake.state)) throw conflict()
      const id = randomUUID()
      const digest = createHash('sha256').update(bytes).digest('hex')
      const encrypted = seal({ mime: input.mime, data: input.data }, key(), `iddoc:${id}`)
      await sql.query(
        `INSERT INTO id_documents(id, intake_id, patient_id, id_type, mime, size_bytes, sha256, encrypted_payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (intake_id) DO UPDATE SET id=EXCLUDED.id, patient_id=EXCLUDED.patient_id,
           id_type=EXCLUDED.id_type, mime=EXCLUDED.mime, size_bytes=EXCLUDED.size_bytes,
           sha256=EXCLUDED.sha256, encrypted_payload=EXCLUDED.encrypted_payload, updated_at=now()`,
        [id, intake.id, actor.id, input.idType, input.mime, bytes.length, digest, encrypted]
      )
      await audit(sql, actor, 'ID_DOCUMENT_UPLOADED', 'intake', intake.id, request.id)
      return { id, idType: input.idType }
    })
  })

  app.post('/api/v1/intake/submit', async (request) => {
    const actor = await auth(request, ['PATIENT'])
    if (!config.intakeEnabled) throw unavailable()
    const input = versionInput.parse(request.body)
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          "SELECT * FROM intakes WHERE patient_id=$1 AND state NOT IN ('COMPLETED','CANCELLED') FOR UPDATE",
          [actor.id]
        )
      ).rows[0]
      if (!row) throw missing()
      if (row.submission_version === input.version && row.state !== 'DRAFT') {
        await audit(sql, actor, 'SUBMISSION_RECEIPT_VIEWED', 'intake', row.id, request.id)
        return { id: row.id, state: row.state, version: row.version }
      }
      if (row.version !== input.version || row.state !== 'DRAFT') throw conflict()
      const idDocument = (
        await sql.query('SELECT id FROM id_documents WHERE intake_id=$1', [row.id])
      ).rows[0]
      if (!idDocument)
        throw new Fault(
          409,
          'ID_DOCUMENT_REQUIRED',
          'Upload a photo of your ID before sending for review.'
        )
      const state = row.issues.length ? 'NEEDS_CORRECTION' : 'REVIEW_PENDING'
      const updated = (
        await sql.query(
          'UPDATE intakes SET state=$1, version=version+1, submitted_at=now(), submission_version=$2, updated_at=now() WHERE id=$3 RETURNING *',
          [state, input.version, row.id]
        )
      ).rows[0]
      await audit(sql, actor, 'INTAKE_SUBMITTED', 'intake', row.id, request.id)
      await enqueueOutbox(sql, 'intake.submitted', row.id, updated.version)
      return { id: row.id, state, version: updated.version }
    })
  })

  app.get('/api/v1/preferences', async (request) => {
    const actor = await auth(request, ['PATIENT'])
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          'SELECT * FROM intakes WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1',
          [actor.id]
        )
      ).rows[0]
      await audit(sql, actor, 'PREFERENCES_VIEWED', 'intake', row?.id || null, request.id)
      if (!row) return { preferences: null }
      const data = payload(row)
      return {
        preferences: {
          version: row.version,
          emailConsent: data.emailConsent,
          smsConsent: data.smsConsent
        }
      }
    })
  })
  app.patch('/api/v1/preferences', async (request) => {
    const actor = await auth(request, ['PATIENT'])
    const input = z
      .strictObject({
        version: z.number().int().positive(),
        emailConsent: z.boolean(),
        smsConsent: z.boolean()
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          'SELECT * FROM intakes WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
          [actor.id]
        )
      ).rows[0]
      if (!row) throw missing()
      const data = payload(row)
      if (row.version !== input.version) {
        if (data.emailConsent === input.emailConsent && data.smsConsent === input.smsConsent)
          return { version: row.version }
        throw conflict()
      }
      const encrypted = seal(
        { ...data, emailConsent: input.emailConsent, smsConsent: input.smsConsent },
        key(),
        `intake:${row.id}`
      )
      const updated = (
        await sql.query(
          'UPDATE intakes SET encrypted_payload=$1,version=version+1,save_key=NULL,updated_at=now() WHERE id=$2 RETURNING *',
          [encrypted, row.id]
        )
      ).rows[0]
      await revision(sql, actor, updated)
      await audit(sql, actor, 'COMMUNICATION_PREFERENCES_UPDATED', 'intake', row.id, request.id)
      return { version: updated.version }
    })
  })

  app.get('/api/v1/workspace', async (request) => {
    const actor = await auth(request)
    return db().transaction(async (sql) => {
      const intakes = actor.joinAppointmentId ? [] : (
        await sql.query(
          `SELECT i.* FROM intakes i WHERE
        $1 IN ('STAFF','ADMIN') OR ($1='PATIENT' AND i.patient_id=$2) OR
        ($1='DOCTOR' AND EXISTS (SELECT 1 FROM appointments a WHERE a.intake_id=i.id AND a.doctor_id=$2 AND a.status IN ('CONFIRMED','COMPLETED')))
        ORDER BY i.updated_at DESC LIMIT 100`,
          [actor.role, actor.id]
        )
      ).rows
      const appointments = (
        await sql.query(
          `SELECT a.id, a.intake_id, a.doctor_id, a.starts_at, a.ends_at, a.timezone, a.mode, a.status, a.version
         FROM appointments a WHERE ($3::uuid IS NOT NULL AND a.id=$3 AND a.patient_id=$2) OR
         ($3::uuid IS NULL AND ($1 IN ('STAFF','ADMIN') OR ($1='PATIENT' AND a.patient_id=$2) OR ($1='DOCTOR' AND a.doctor_id=$2)))
         ORDER BY a.starts_at DESC LIMIT 100`,
          [actor.role, actor.id, actor.joinAppointmentId]
        )
      ).rows
      const availability =
        actor.role === 'PATIENT'
          ? []
          : (
              await sql.query(
                "SELECT a.*, (SELECT count(*)::int AS booked FROM appointments ap WHERE ap.availability_id=a.id AND ap.status='CONFIRMED') AS booked FROM availability a JOIN identities i ON i.id=a.doctor_id WHERE a.ends_at>now() AND i.enabled=true AND ($1 IN ('STAFF','ADMIN') OR a.doctor_id=$2) ORDER BY starts_at LIMIT 100",
                [actor.role, actor.id]
              )
            ).rows
      await audit(sql, actor, 'WORKSPACE_VIEWED', 'workspace', null, request.id)
      return {
        intakes: intakes.map((row) => {
          const data = payload(row)
          return {
            id: row.id,
            state: row.state,
            version: row.version,
            issues: row.issues,
            updatedAt: row.updated_at,
            name: `${data.firstName} ${data.lastName}`.trim() || 'Name not provided'
          }
        }),
        appointments,
        availability
      }
    })
  })

  app.get('/api/v1/intakes/:id', async (request) => {
    const actor = await auth(request)
    return db().transaction(async (sql) => {
      const row = await scopedIntake(sql, actor, idParam(request))
      await audit(sql, actor, 'PATIENT_VIEWED', 'intake', row.id, request.id)
      const result = patientView(row)
      // Administrative staff do not receive clinical answers in their record response.
      if (actor.role === 'STAFF') result.data = { ...result.data, reason: '', answers: {} }
      const notes =
        actor.role === 'PATIENT'
          ? []
          : (
              await sql.query(
                'SELECT * FROM notes WHERE intake_id=$1 ORDER BY created_at DESC LIMIT 100',
                [row.id]
              )
            ).rows.map((note) => ({
              id: note.id,
              kind: note.kind,
              createdAt: note.created_at,
              ...open(note.encrypted_payload, key(), `note:${note.id}`)
            }))
      const verifiedChannels = (
        await sql.query(
          'SELECT channel FROM contact_verifications WHERE intake_id=$1 AND revoked_at IS NULL',
          [row.id]
        )
      ).rows.map((row) => row.channel)
      const doc = (
        await sql.query('SELECT * FROM id_documents WHERE intake_id=$1', [row.id])
      ).rows[0]
      // ponytail: STAFF sees answers redacted and gets ID metadata only; clinicians
      // and the owning patient get the image bytes for visual verification.
      const idDocument = !doc
        ? null
        : actor.role === 'STAFF'
          ? { id: doc.id, idType: doc.id_type, mime: doc.mime, createdAt: doc.created_at }
          : {
              id: doc.id,
              idType: doc.id_type,
              mime: doc.mime,
              createdAt: doc.created_at,
              image: open<{ mime: string; data: string }>(doc.encrypted_payload, key(), `iddoc:${doc.id}`)
            }
      return { ...result, notes, verifiedChannels, idDocument }
    })
  })

  app.post('/api/v1/intakes/:id/verify-contact', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const id = idParam(request)
    const input = z
      .strictObject({
        version: z.number().int().positive(),
        channel: z.enum(['EMAIL', 'SMS']),
        confirmedWithPatient: z.literal(true)
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      const row = (await sql.query('SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!row) throw missing()
      if (row.version !== input.version) throw conflict()
      const data = payload(row)
      const destination = input.channel === 'EMAIL' ? data.normalized.email : data.normalized.phone
      if (!destination)
        throw new Fault(
          400,
          'INVALID_DESTINATION',
          'Correct the contact details before recording verification.'
        )
      const targetId = randomUUID()
      await sql.query(
        'UPDATE contact_verifications SET revoked_at=now() WHERE intake_id=$1 AND channel=$2 AND revoked_at IS NULL',
        [id, input.channel]
      )
      await sql.query(
        'INSERT INTO contact_verifications(id,intake_id,channel,encrypted_destination,verified_by) VALUES ($1,$2,$3,$4,$5)',
        [targetId, id, input.channel, seal(destination, key(), `contact:${targetId}`), actor.id]
      )
      await audit(sql, actor, 'CONTACT_VERIFIED_BY_STAFF', 'contact', targetId, request.id)
      return { id: targetId, channel: input.channel }
    })
  })

  app.post('/api/v1/intakes/:id/review', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const id = idParam(request)
    const input = z
      .strictObject({
        version: z.number().int().positive(),
        action: z.enum(['verify', 'request_correction']),
        note: z.string().trim().min(3).max(2000)
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      const row = (await sql.query('SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!row) throw missing()
      if (
        row.version !== input.version ||
        !['REVIEW_PENDING', 'NEEDS_CORRECTION'].includes(row.state)
      )
        throw conflict()
      if (input.action === 'verify' && row.issues.length)
        throw new Fault(
          409,
          'UNRESOLVED_ISSUES',
          'Request corrected information before verification.'
        )
      const state = input.action === 'verify' ? 'VERIFIED' : 'NEEDS_CORRECTION'
      const noteId = randomUUID()
      await sql.query(
        "INSERT INTO notes(id,intake_id,actor_id,kind,encrypted_payload) VALUES ($1,$2,$3,'REVIEW',$4)",
        [noteId, id, actor.id, seal({ text: input.note }, key(), `note:${noteId}`)]
      )
      await sql.query(
        'UPDATE intakes SET state=$1, version=version+1, updated_at=now() WHERE id=$2',
        [state, id]
      )
      await audit(
        sql,
        actor,
        input.action === 'verify' ? 'INTAKE_VERIFIED' : 'CORRECTION_REQUESTED',
        'intake',
        id,
        request.id
      )
      await enqueueOutbox(
        sql,
        input.action === 'verify' ? 'intake.verified' : 'intake.correction_requested',
        id,
        row.version + 1
      )
      return { state, version: row.version + 1 }
    })
  })

  app.post('/api/v1/intakes/:id/notes', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const id = idParam(request)
    const input = z
      .strictObject({
        kind: z.enum(['CONTACT', 'INTERNAL']),
        text: z.string().trim().min(1).max(2000)
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      await scopedIntake(sql, actor, id)
      const noteId = randomUUID()
      await sql.query(
        'INSERT INTO notes(id,intake_id,actor_id,kind,encrypted_payload) VALUES ($1,$2,$3,$4,$5)',
        [noteId, id, actor.id, input.kind, seal({ text: input.text }, key(), `note:${noteId}`)]
      )
      await audit(sql, actor, 'NOTE_CREATED', 'intake', id, request.id)
      return { id: noteId }
    })
  })

  app.post('/api/v1/intakes/:id/prescription', async (request) => {
    const actor = await auth(request, ['DOCTOR'])
    const id = idParam(request)
    const input = prescriptionInput.parse(request.body)
    return db().transaction(async (sql) => {
      // scopedIntake ensures the doctor is authorised for this intake AND that it has been
      // booked / verified — prescriptions can only flow from a confirmed clinical relationship.
      await scopedIntake(sql, actor, id)
      const intake = (
        await sql.query('SELECT state_code, patient_id FROM intakes WHERE id=$1', [id])
      ).rows[0]
      // Look up the active cap for (jurisdiction, metric) on the current date. effective_to is
      // open-ended for the current rule; effective_from <= current_date < COALESCE(effective_to,
      // 'infinity') is the validity window. Without an active cap the engine fails closed:
      // better to refuse than to issue a prescription that drifts past an unenforced limit.
      // The cap row is the SOLE source of truth for both max_value and period_days:
      // a doctor-supplied periodDays cannot shrink the rolling window below the
      // regulator-configured one (otherwise a single 1-day request would defeat a
      // 30-day cap by making every prior 6-29-day-old prescription invisible to the
      // cumulative SUM).
      const cap = (
        await sql.query(
          `SELECT max_value, period_days FROM jurisdiction_prescription_caps
           WHERE jurisdiction_code=$1 AND metric=$2
             AND effective_from <= current_date
             AND (effective_to IS NULL OR effective_to > current_date)
           ORDER BY effective_from DESC LIMIT 1`,
          [intake.state_code, input.metric]
        )
      ).rows[0]
      if (!cap) throw new PrescriptionNoCapDefinedError(intake.state_code, input.metric)
      const periodDays = Number(cap.period_days)
      // Serialize concurrent prescription requests for the same
      // (patient, metric). The flow below is check-then-act: read the
      // cumulative SUM, compare against cap.max_value, then INSERT a new
      // prescription. Without a lock, two concurrent transactions for
      // the same patient can both observe the same pre-insert running
      // total, both pass the cap check, and then both INSERT — combined
      // amount exceeds cap. pg_advisory_xact_lock is held only for the
      // life of this transaction; hashtext(text)::int fits the (patient
      // UUID, metric) pair into the 2-arg advisory-lock namespace so
      // different (patient, metric) pairs do not needlessly serialize.
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::int, hashtext($2)::int)",
        [intake.patient_id, input.metric]
      )
      if (input.amountOz > Number(cap.max_value))
        throw new PrescriptionCapExceededError(
          intake.state_code,
          input.metric,
          input.amountOz,
          Number(cap.max_value)
        )
      // Phase 10 — cumulative check. Sum all prescriptions for this patient within
      // cap.period_days (the regulator-configured rolling window). If running total + new
      // amount would exceed the cap, refuse. The cap already constrains a single
      // prescription; this closes the "two prescriptions each individually OK but
      // cumulative over the limit" gap AND the "doctor shrinks periodDays to bypass"
      // gap.
      const cumulativeRow = (
        await sql.query(
          // ponytail: addition and comparison run as PostgreSQL numerics so a
          // binary float sum like 0.1 + 0.2 can never edge past an exact cap.
          `SELECT COALESCE(SUM(amount_oz), 0)::numeric AS total,
              (COALESCE(SUM(amount_oz), 0) + $4::numeric > $5::numeric) AS exceeded
           FROM prescriptions p
           WHERE p.intake_id IN (SELECT id FROM intakes WHERE patient_id=$1)
             AND p.metric=$2
             AND p.signed_at > now() - ($3 * interval '1 day')`,
          [intake.patient_id, input.metric, periodDays, String(input.amountOz), String(cap.max_value)]
        )
      ).rows[0]
      const runningTotal = Number(cumulativeRow.total)
      if (cumulativeRow.exceeded)
        throw new PrescriptionCumulativeExceededError(
          intake.state_code,
          input.metric,
          runningTotal,
          input.amountOz,
          Number(cap.max_value),
          periodDays
        )
      const prescriptionId = randomUUID()
      const encrypted = seal(
        { ...input, periodDays },
        key(),
        `prescription:${prescriptionId}`
      )
      const expiresAt = new Date(Date.now() + periodDays * 86400 * 1000).toISOString()
      await sql.query(
        `INSERT INTO prescriptions(id, intake_id, doctor_id, jurisdiction_code, amount_oz,
             metric, period_days, encrypted_payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          prescriptionId,
          id,
          actor.id,
          intake.state_code,
          input.amountOz,
          input.metric,
          periodDays,
          encrypted,
          expiresAt
        ]
      )
      await audit(sql, actor, 'PRESCRIPTION_ISSUED', 'prescription', prescriptionId, request.id)
      return { id: prescriptionId, expiresAt }
    })
  })

  app.post('/api/v1/availability', async (request) => {
    const actor = await auth(request, ['DOCTOR'])
    const input = z
      .strictObject({
        startsAt: dateTime,
        endsAt: dateTime,
        timezone,
        bufferMinutes: z.number().int().min(0).max(60)
      })
      .parse(request.body)
    if (
      Date.parse(input.startsAt) <= Date.now() ||
      Date.parse(input.endsAt) <= Date.parse(input.startsAt) ||
      Date.parse(input.endsAt) - Date.parse(input.startsAt) > 86400000
    )
      throw new Fault(
        400,
        'INVALID_INTERVAL',
        'Choose a future availability window of no more than 24 hours.'
      )
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          'INSERT INTO availability(doctor_id,starts_at,ends_at,timezone,buffer_minutes) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [actor.id, input.startsAt, input.endsAt, input.timezone, input.bufferMinutes]
        )
      ).rows[0]
      await audit(sql, actor, 'AVAILABILITY_CREATED', 'availability', row.id, request.id)
      return { id: row.id }
    })
  })

  app.delete('/api/v1/availability/:id', async (request) => {
    const actor = await auth(request, ['DOCTOR'])
    const id = idParam(request)
    return db().transaction(async (sql) => {
      const row = (await sql.query('SELECT id, doctor_id FROM availability WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!row) throw missing()
      if (row.doctor_id !== actor.id) throw denied()
      await sql.query('SAVEPOINT del_window')
      let deleted = true
      try {
        await sql.query('DELETE FROM availability WHERE id=$1', [id])
      } catch (error) {
        if ((error as { code?: string }).code !== '23503') throw error
        await sql.query('ROLLBACK TO SAVEPOINT del_window')
        deleted = false
      }
      if (!deleted)
        throw new Fault(409, 'WINDOW_IN_USE', 'This window has booked appointments and cannot be deleted.')
      await audit(sql, actor, 'AVAILABILITY_DELETED', 'availability', id, request.id)
      return { id, status: 'DELETED' }
    })
  })

  app.post('/api/v1/appointments', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const input = z
      .strictObject({
        requestKey: uuid,
        intakeId: uuid,
        availabilityId: uuid,
        startsAt: dateTime,
        durationMinutes: z.number().int().min(5).max(120),
        mode: z.enum(['VIDEO', 'WEB_AUDIO', 'PHONE'])
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      const row = (
        await sql.query('SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [input.intakeId])
      ).rows[0]
      if (!row) throw missing()
      const previous = (
        await sql.query('SELECT * FROM appointments WHERE created_by=$1 AND request_key=$2', [
          actor.id,
          input.requestKey
        ])
      ).rows[0]
      if (previous) {
        if (
          previous.intake_id !== input.intakeId ||
          previous.availability_id !== input.availabilityId ||
          new Date(previous.starts_at).getTime() !== Date.parse(input.startsAt) ||
          previous.mode !== input.mode ||
          (new Date(previous.ends_at).getTime() - new Date(previous.starts_at).getTime()) /
            60000 !==
            input.durationMinutes
        )
          throw conflict()
        return { id: previous.id, mode: previous.mode, created: false }
      }
      if (row.state !== 'VERIFIED') throw conflict()
      const slot = (
        await sql.query(
          "SELECT a.* FROM availability a JOIN identities i ON i.id=a.doctor_id WHERE a.id=$1 AND i.role='DOCTOR' AND i.enabled=true FOR UPDATE OF a",
          [input.availabilityId]
        )
      ).rows[0]
      if (!slot) throw missing()
      const start = Date.parse(input.startsAt)
      const end = start + input.durationMinutes * 60000
      const reserved = end + slot.buffer_minutes * 60000
      const jurisdiction = await getJurisdiction(sql, row.state_code)
      if (!jurisdiction || jurisdiction.status !== 'AVAILABLE' ||
        !modeAllowedInJurisdiction(input.mode, jurisdiction.allowed_visit_types))
        throw new Fault(422, 'VISIT_TYPE_NOT_ALLOWED', 'This appointment format is not available in the patient’s jurisdiction.')
      const preferredMode = payload(row).mode
      if (preferredMode !== 'EITHER' && preferredMode !== input.mode)
        throw new Fault(422, 'VISIT_TYPE_NOT_PREFERRED', 'Choose the patient’s requested consultation format.')
      if (start < Date.now() + jurisdiction.notice_period_hours * 3600000)
        throw new Fault(422, 'NOTICE_PERIOD_REQUIRED', 'Choose an appointment after the jurisdiction’s notice period.')
      if (
        start <= Date.now() ||
        start < new Date(slot.starts_at).getTime() ||
        reserved > new Date(slot.ends_at).getTime()
      )
        throw new Fault(
          409,
          'OUTSIDE_AVAILABILITY',
          'Choose a time inside the available window, including the appointment buffer.'
        )
      const created = (
        await sql.query(
          `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            row.id,
            row.patient_id,
            slot.doctor_id,
            slot.id,
            new Date(start),
            new Date(end),
            new Date(reserved),
            slot.timezone,
            input.mode,
            actor.id,
            input.requestKey
          ]
        ).catch((err) => {
        // SQLSTATE 23P01 = exclusion_violation (the EXCLUDE USING gist constraint on appointments
        // fires when the same doctor or same patient already has a CONFIRMED appointment that
        // overlaps the requested tstzrange). Convert to a typed Fault so staff UI can show
        // "this time was just taken, please pick another" instead of a generic 409 CONFLICT.
        if (err && (err as { code?: string }).code === '23P01')
          throw new Fault(
            409,
            'APPOINTMENT_SLOT_TAKEN',
            'This appointment slot is no longer available. Pick another time.'
          );
        throw err;
      })
      ).rows[0]
      await sql.query('INSERT INTO consultations(id,duration) VALUES ($1,$2)', [
        created.id,
        input.durationMinutes * 60
      ])
      await sql.query(
        "UPDATE intakes SET state='SCHEDULED', version=version+1, updated_at=now() WHERE id=$1",
        [row.id]
      )
      await audit(sql, actor, 'APPOINTMENT_CREATED', 'appointment', created.id, request.id)
      await enqueueOutbox(sql, 'appointment.created', created.id, 1)
      return { id: created.id, mode: input.mode, created: true }
    }).then(async ({ id, mode, created }) => {
      // ponytail: room attach is best-effort outside the booking transaction; booking never fails on video
      if (!created || mode === 'PHONE') return { id }
      const roomId = await createVideoRoom(process.env, `fadewell-${id}`)
      if (roomId) await db().query('UPDATE appointments SET video_room_id=$1 WHERE id=$2', [roomId, id])
      return { id }
    })
  })

  app.post('/api/v1/appointments/:id/share-link', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const id = idParam(request)
    const input = z
      .strictObject({ version: z.number().int().positive(), ttlMinutes: z.number().int().min(5).max(1440).default(120) })
      .parse(request.body)
    const token = randomToken()
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          `SELECT a.*, c.status AS consultation_status FROM appointments a
         JOIN consultations c ON c.id=a.id
         WHERE a.id=$1 AND ($2 IN ('STAFF','ADMIN') OR a.doctor_id=$3)
         FOR UPDATE OF a,c`,
          [id, actor.role, actor.id]
        )
      ).rows[0]
      if (!row) throw missing()
      if (row.version !== input.version) throw conflict()
      if (row.status !== 'CONFIRMED' || row.consultation_status !== 'READY')
        throw conflict()
      // ponytail: a short requested TTL must never expire before a late patient can join.
      const expires = new Date(Math.max(Date.now() + input.ttlMinutes * 60000,
        new Date(row.ends_at).getTime() + 60 * 60000))
      if (Date.now() > new Date(row.ends_at).getTime() + 60 * 60000 ||
        Date.now() < new Date(row.starts_at).getTime() - input.ttlMinutes * 60000 ||
        expires.getTime() <= new Date(row.starts_at).getTime() - 15 * 60000)
        throw new Fault(409, 'JOIN_LINK_TOO_EARLY', 'Issue the join link closer to the appointment so it remains valid for the patient.')
      const updated = (await sql.query(
        "UPDATE appointments SET patient_join_token_hash=$1, patient_join_token_expires_at=$2, version=version+1, updated_at=now() WHERE id=$3 RETURNING version",
        [hash(token), expires, id]
      )).rows[0]
      const eventId = randomUUID()
      await sql.query(
        `INSERT INTO outbox_events(id,event_type,resource_id,deduplication_key,encrypted_payload)
         VALUES ($1,'appointment.join_link_issued',$2,$3,$4)`,
        [eventId, id, `appointment.join_link_issued:${id}:${updated.version}`,
          seal({ token, expiresAt: expires.toISOString() }, key(), `outbox:${eventId}`)]
      )
      await audit(sql, actor, 'JOIN_LINK_ISSUED', 'appointment', id, request.id)
      return {
        token,
        expiresAt: expires.toISOString(),
        url: `${config.origin}/patient?view=appointments#join=${token}`,
        version: updated.version
      }
    })
  })

  app.post('/api/v1/join', async (request, reply) => {
    if (!config.encryptionKey) throw unavailable()
    const { token } = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(request.body)
    const sessionToken = randomToken()
    const result = await db().transaction(async (sql) => {
      const row = (
        await sql.query(
          `SELECT a.id, a.patient_id, a.doctor_id, a.status, a.starts_at, a.ends_at,
              a.patient_join_token_hash, a.patient_join_token_expires_at, a.video_room_id
        FROM appointments a JOIN identities p ON p.id=a.patient_id
        WHERE a.patient_join_token_hash=$1 AND p.enabled=true FOR UPDATE OF a FOR SHARE OF p`,
          [hash(token)]
        )
      ).rows[0]
      if (!row) throw denied()
      if (row.status !== 'CONFIRMED') throw denied()
      if (!row.patient_join_token_expires_at || new Date(row.patient_join_token_expires_at) < new Date())
        throw new Fault(410, 'LINK_EXPIRED', 'This consultation link is no longer valid.')
      const windowStart = new Date(row.starts_at).getTime() - 15 * 60000
      const windowEnd = new Date(row.ends_at).getTime() + 60 * 60000
      const now = Date.now()
      if (now < windowStart)
        throw new Fault(425, 'TOO_EARLY', 'This link becomes active 15 minutes before your consultation.')
      if (now > windowEnd)
        throw new Fault(410, 'LINK_EXPIRED', 'This consultation link is no longer valid.')
      const previous = request.cookies[cookieName(config)]
      if (previous) {
        const existing = (await sql.query('SELECT actor_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hash(previous)])).rows[0]
        if (existing && existing.actor_id !== row.patient_id) throw denied()
        await sql.query('DELETE FROM sessions WHERE token_hash=$1', [hash(previous)])
      }
      await sql.query(
        "UPDATE appointments SET patient_join_token_hash=NULL, patient_join_token_expires_at=NULL, updated_at=now() WHERE id=$1",
        [row.id]
      )
      const session = (await sql.query(
        "INSERT INTO sessions(token_hash,actor_id,csrf,expires_at,join_appointment_id) VALUES ($1,$2,$3,LEAST(now()+interval '4 hours',$4::timestamptz + interval '1 hour'),$5) RETURNING actor_id,csrf",
        [hash(sessionToken), row.patient_id, randomToken(), row.ends_at, row.id]
      )).rows[0]
      await audit(sql, { id: session.actor_id, role: 'PATIENT' }, 'JOIN_TOKEN_CONSUMED', 'appointment', row.id, request.id)
      return { consultationId: row.id, videoRoomId: row.video_room_id, issuedAt: new Date() }
    })
    reply.setCookie(cookieName(config), sessionToken, {
      path: '/', httpOnly: true, secure: config.origin.startsWith('https://'), sameSite: 'lax', maxAge: 14400
    })
    return result
  })

  app.post('/api/v1/appointments/:id/cancel', async (request) => {
    const actor = await auth(request, ['STAFF', 'ADMIN'])
    const id = idParam(request)
    const input = versionInput.parse(request.body)
    return db().transaction(async (sql) => {
      const row = (
        await sql.query(
          'SELECT a.*,c.status AS consultation_status FROM appointments a JOIN consultations c ON c.id=a.id WHERE a.id=$1 FOR UPDATE OF a,c',
          [id]
        )
      ).rows[0]
      if (!row) throw missing()
      if (
        row.version !== input.version ||
        row.status !== 'CONFIRMED' ||
        row.consultation_status !== 'READY'
      )
        throw conflict()
      await sql.query(
        "UPDATE appointments SET status='CANCELLED', version=version+1, updated_at=now() WHERE id=$1",
        [id]
      )
      await sql.query(
        "UPDATE intakes SET state='VERIFIED', version=version+1, updated_at=now() WHERE id=$1",
        [row.intake_id]
      )
      await audit(sql, actor, 'APPOINTMENT_CANCELLED', 'appointment', id, request.id)
      await enqueueOutbox(sql, 'appointment.cancelled', id, row.version + 1)
      return { status: 'CANCELLED' }
    })
  })

  async function consultation(sql: Sql, actor: Actor, id: string, lock = false) {
    const row = (
      await sql.query(
        `SELECT c.*,a.doctor_id,a.patient_id,a.status AS appointment_status,a.starts_at,a.ends_at,a.intake_id,a.video_room_id
      FROM consultations c JOIN appointments a ON a.id=c.id WHERE c.id=$1 AND
      ($2 IN ('STAFF','ADMIN') OR ($2='PATIENT' AND a.patient_id=$3) OR ($2='DOCTOR' AND a.doctor_id=$3)) ${lock ? 'FOR UPDATE OF a,c' : ''}`,
        [id, actor.role, actor.id]
      )
    ).rows[0]
    if (!row) throw missing()
    return row
  }
  const timerView = (row: Row) => ({
    id: row.id,
    status: row.status,
    duration: row.duration,
    elapsed: row.elapsed,
    runningSince: row.running_since ? new Date(row.running_since).getTime() : null,
    version: row.version,
    serverNow: Date.now(),
    appointmentStatus: row.appointment_status,
    mediaAvailable: Boolean(row.video_room_id)
  })

  app.get('/api/v1/consultations/:id/media', async (request) => {
    const actor = await auth(request, ['PATIENT', 'DOCTOR'])
    const row = await consultation(db(), actor, idParam(request))
    if (!row.video_room_id)
      throw new Fault(
        409,
        'MEDIA_UNAVAILABLE',
        'Video is not connected for this consultation yet.'
      )
    const now = Date.now()
    if (
      row.appointment_status !== 'CONFIRMED' ||
      now < new Date(row.starts_at).getTime() - 15 * 60000 ||
      now > new Date(row.ends_at).getTime() + 60 * 60000
    )
      throw denied()
    const token = await mintVideoToken(process.env, row.video_room_id)
    if (!token) throw unavailable()
    return { roomId: row.video_room_id, token }
  })
  const streams = new Map<string, number>()
  const streamResponses = new Set<ServerResponse>()
  app.addHook('preClose', async () => {
    for (const response of streamResponses) response.end()
  })
  app.get('/api/v1/consultations/:id/events', async (request, reply) => {
    const actor = await auth(request)
    const id = idParam(request)
    const initial = await db().transaction(async (sql) => {
      const row = await consultation(sql, actor, id)
      await audit(sql, actor, 'CONSULTATION_STREAM_OPENED', 'consultation', id, request.id)
      return row
    })
    if ((streams.get(actor.id) || 0) >= 3)
      throw new Fault(429, 'STREAM_LIMIT', 'Close another consultation tab before reconnecting.')
    streams.set(actor.id, (streams.get(actor.id) || 0) + 1)
    streamResponses.add(reply.raw)
    reply.hijack()
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value)
    }
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    let closed = false,
      polling = false,
      tick = 0
    let lastVersion = `${initial.version}:${initial.appointment_status}`
    const send = (name: string, value: unknown) => {
      if (!closed) reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`)
    }
    send('snapshot', timerView(initial))
    // ponytail: poll authoritative rows every 2s; switch to LISTEN/NOTIFY plus reconnect snapshots at higher connection counts.
    const interval = setInterval(async () => {
      if (polling || closed) return
      polling = true
      try {
        const currentActor = await auth(request)
        const row = await consultation(db(), currentActor, id)
        const version = `${row.version}:${row.appointment_status}`
        if (lastVersion !== version) {
          send('snapshot', timerView(row))
          lastVersion = version
        } else if (++tick % 5 === 0 && !closed) reply.raw.write(': keepalive\n\n')
      } catch (failure) {
        send('access-ended', {
          reason:
            failure instanceof Fault && failure.status === 401 ? 'SESSION_EXPIRED' : 'UNAVAILABLE'
        })
        reply.raw.end()
      } finally {
        polling = false
      }
    }, 2000)
    reply.raw.once('close', () => {
      streamResponses.delete(reply.raw)
      closed = true
      clearInterval(interval)
      const count = (streams.get(actor.id) || 1) - 1
      if (count) streams.set(actor.id, count)
      else streams.delete(actor.id)
    })
  })
  app.get('/api/v1/consultations/:id', async (request) => {
    const actor = await auth(request)
    return db().transaction(async (sql) => {
      const row = await consultation(sql, actor, idParam(request))
      await audit(sql, actor, 'CONSULTATION_VIEWED', 'consultation', row.id, request.id)
      return timerView(row)
    })
  })
  app.post('/api/v1/consultations/:id/timer', async (request) => {
    const actor = await auth(request, ['DOCTOR'])
    const input = z
      .strictObject({
        version: z.number().int().positive(),
        action: z.enum(['start', 'pause', 'resume', 'extend', 'set', 'end']),
        seconds: z.number().int().min(0).max(14400).default(0)
      })
      .parse(request.body)
    return db().transaction(async (sql) => {
      const row = await consultation(sql, actor, idParam(request), true)
      if (row.version !== input.version || row.appointment_status !== 'CONFIRMED') throw conflict()
      if (
        input.action === 'start' &&
        (Date.now() < new Date(row.starts_at).getTime() - 900000 ||
          Date.now() > new Date(row.ends_at).getTime() + 3600000)
      )
        throw new Fault(
          409,
          'OUTSIDE_JOIN_WINDOW',
          'The consultation is outside its permitted start window.'
        )
      const current: Timer = {
        status: row.status,
        duration: row.duration,
        elapsed: row.elapsed,
        runningSince: row.running_since ? new Date(row.running_since).getTime() : null
      }
      const next = changeTimer(current, input.action, input.seconds, Date.now())
      const updated = (
        await sql.query(
          'UPDATE consultations SET status=$1,duration=$2,elapsed=$3,running_since=$4,version=version+1,modified_by=$5,updated_at=now() WHERE id=$6 RETURNING *',
          [
            next.status,
            next.duration,
            next.elapsed,
            next.runningSince === null ? null : new Date(next.runningSince),
            actor.id,
            row.id
          ]
        )
      ).rows[0]
      if (input.action === 'end') {
        await sql.query(
          "UPDATE appointments SET status='COMPLETED',version=version+1,updated_at=now() WHERE id=$1",
          [row.id]
        )
        await sql.query(
          "UPDATE intakes SET state='COMPLETED',version=version+1,updated_at=now() WHERE id=$1",
          [row.intake_id]
        )
      }
      await audit(
        sql,
        actor,
        input.action === 'end' ? 'CONSULTATION_ENDED' : 'TIMER_CHANGED',
        'consultation',
        row.id,
        request.id
      )
      await enqueueOutbox(sql, 'consultation.updated', row.id, updated.version)
      return timerView({
        ...row,
        ...updated,
        appointment_status: input.action === 'end' ? 'COMPLETED' : row.appointment_status
      })
    })
  })

  app.get('/api/v1/admin/audit', async (request) => {
    const actor = await auth(request, ['ADMIN'])
    return db().transaction(async (sql) => {
      await audit(sql, actor, 'AUDIT_VIEWED', 'audit', null, request.id)
      return {
        events: (await sql.query('SELECT * FROM audit_events ORDER BY id DESC LIMIT 100')).rows
      }
    })
  })
  app.get('/api/v1/admin/users', async (request) => {
    const actor = await auth(request, ['ADMIN'])
    return db().transaction(async (sql) => {
      await audit(sql, actor, 'USERS_VIEWED', 'identity', null, request.id)
      return {
        users: (
          await sql.query(
            `SELECT i.id, i.role, i.enabled, i.created_at,
              c.username, c.totp_verified, c.password_updated_at,
              c.failed_login_attempts, c.locked_until
              FROM identities i JOIN local_credentials c ON c.identity_id=i.id
              ORDER BY i.created_at DESC LIMIT 100`
          )
        ).rows.map((row) => ({
          id: row.id,
          role: row.role,
          enabled: row.enabled,
          created_at: row.created_at,
          username: row.username,
          has_password: Boolean(row.password_updated_at),
          totp_verified: row.totp_verified ?? false,
          failed_login_attempts: row.failed_login_attempts ?? 0,
          locked_until: row.locked_until
        }))
      }
    })
  })
  const adminUserOptions = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }
  app.post('/api/v1/admin/users', adminUserOptions, async (request) => {
    if (!config.encryptionKey) throw unavailable()
    const actor = await auth(request, ['ADMIN'])
    const input = z
      .strictObject({
        username: usernameInput,
        password: z.string().min(config.minPasswordLength).max(128),
        role: z.enum(['ADMIN', 'STAFF', 'DOCTOR'])
      })
      .parse(request.body)
    // First sign-in owns enrollment keys: no admin-generated key is stored or returned.
    const result = await db().transaction(async (sql) => {
      // ponytail: one access-management lock; partition by organization if multi-tenancy is added.
      await sql.query('SELECT pg_advisory_xact_lock(62431893)')
      const existing = (
        await sql.query('SELECT identity_id FROM local_credentials WHERE lower(username)=lower($1)', [
          input.username
        ])
      ).rows[0]
      if (existing) throw new Fault(409, 'USERNAME_TAKEN', 'That username is already in use.')
      const identity = (
        await sql.query(
          "INSERT INTO identities(issuer,subject,role) VALUES ('local',$1,$2) RETURNING id",
          [input.username.toLowerCase(), input.role]
        )
      ).rows[0]
      await sql.query(
        `INSERT INTO local_credentials(identity_id,username,password_hash,password_updated_at)
         VALUES ($1,$2,$3,now())`,
        [identity.id, input.username, await hashPassword(input.password)]
      )
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [identity.id])
      await audit(sql, actor, 'USER_CREATED', 'identity', identity.id, request.id)
      return {
        id: identity.id,
        username: input.username,
        role: input.role
      }
    })
    return {
      ...result,
      message: 'Share the username and initial password with the workforce member. They set up an authenticator at first sign-in.'
    }
  })
  app.post('/api/v1/admin/users/:id/reset-totp', adminUserOptions, async (request) => {
    if (!config.encryptionKey) throw unavailable()
    const actor = await auth(request, ['ADMIN'])
    const id = idParam(request)
    // First sign-in owns enrollment keys: reset only clears verification so the
    // next sign-in issues the usable key; no replacement key is stored or returned.
    const result = await db().transaction(async (sql) => {
      const credential = (
        await sql.query(
          'SELECT identity_id FROM local_credentials WHERE identity_id=$1 FOR UPDATE',
          [id]
        )
      ).rows[0]
      if (!credential) throw missing()
      await sql.query(
        `UPDATE local_credentials SET totp_last_step=NULL,
          totp_verified=false, failed_login_attempts=0, locked_until=NULL,
          version=version+1 WHERE identity_id=$1`,
        [id]
      )
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [id])
      await audit(sql, actor, 'USER_TOTP_RESET', 'identity', id, request.id)
      return { id }
    })
    return {
      ...result,
      message: 'The workforce member will receive their authenticator setup key at next sign-in. Their previous authenticator app codes are no longer accepted.'
    }
  })
  app.patch('/api/v1/admin/users/:id/password', adminUserOptions, async (request) => {
    if (!config.encryptionKey) throw unavailable()
    const actor = await auth(request, ['ADMIN'])
    const id = idParam(request)
    const input = z
      .strictObject({ password: z.string().min(config.minPasswordLength).max(128) })
      .parse(request.body)
    await db().transaction(async (sql) => {
      const credential = (
        await sql.query(
          'SELECT identity_id FROM local_credentials WHERE identity_id=$1 FOR UPDATE',
          [id]
        )
      ).rows[0]
      if (!credential) throw missing()
      await sql.query(
        `UPDATE local_credentials SET password_hash=$1, password_updated_at=now(), version=version+1,
          failed_login_attempts=0, locked_until=NULL WHERE identity_id=$2`,
        [await hashPassword(input.password), id]
      )
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [id])
      await audit(sql, actor, 'USER_PASSWORD_RESET', 'identity', id, request.id)
    })
    return { id, message: 'Password reset. Share the new password with the workforce member.' }
  })
  app.delete('/api/v1/admin/users/:id', adminUserOptions, async (request) => {
    const actor = await auth(request, ['ADMIN'])
    const id = idParam(request)
    if (actor.id === id) throw denied()
    return db().transaction(async (sql) => {
      // ponytail: one access-management lock; partition by organization if multi-tenancy is added.
      await sql.query('SELECT pg_advisory_xact_lock(62431893)')
      const target = (await sql.query('SELECT id, role, enabled FROM identities WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!target) throw missing()
      if (target.role === 'ADMIN' && target.enabled) {
        const others = (await sql.query(
          "SELECT count(*)::int AS n FROM identities WHERE role='ADMIN' AND enabled=true AND id<>$1", [id]
        )).rows[0]
        if (!others?.n) throw new Fault(409, 'LAST_ADMIN', 'Enable another administrator before deleting this one.')
      }
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [id])
      await sql.query('DELETE FROM local_credentials WHERE identity_id=$1', [id])
      // ponytail: tombstone, not row delete — history/audit FKs are load-bearing and the runtime role has no DELETE on identities
      await sql.query('UPDATE identities SET enabled=false WHERE id=$1', [id])
      await audit(sql, actor, 'USER_DELETED', 'identity', id, request.id)
      return { id, status: 'DELETED' }
    })
  })
  app.patch('/api/v1/admin/users/:id', async (request) => {
    const actor = await auth(request, ['ADMIN'])
    const id = idParam(request)
    const input = z.strictObject({ enabled: z.boolean() }).parse(request.body)
    if (actor.id === id) throw denied()
    return db().transaction(async (sql) => {
      // ponytail: one access-management lock; partition by organization if multi-tenancy is added.
      await sql.query('SELECT pg_advisory_xact_lock(62431893)')
      const activeActor = (
        await sql.query("SELECT id FROM identities WHERE id=$1 AND role='ADMIN' AND enabled=true", [
          actor.id
        ])
      ).rows[0]
      if (!activeActor) throw denied()
      const row = (
        await sql.query('UPDATE identities SET enabled=$1 WHERE id=$2 RETURNING id', [
          input.enabled,
          id
        ])
      ).rows[0]
      if (!row) throw missing()
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [id])
      await audit(
        sql,
        actor,
        input.enabled ? 'USER_ENABLED' : 'USER_DISABLED',
        'identity',
        id,
        request.id
      )
      return { id, enabled: input.enabled }
    })
  })
  app.get('/api/v1/delivery', async (request) => {
    const actor = await auth(request, ['ADMIN', 'STAFF'])
    return db().transaction(async (sql) => {
      await audit(sql, actor, 'OUTBOX_VIEWED', 'outbox', null, request.id)
      return {
        deliveryEnabled: config.notificationsEnabled,
        notifications: (
          await sql.query(
            'SELECT id,intake_id,channel,status,attempts,created_at,updated_at FROM notifications ORDER BY created_at DESC LIMIT 100'
          )
        ).rows,
        attempts: (
          await sql.query(
            'SELECT notification_id,attempt,outcome,created_at FROM notification_attempts ORDER BY id DESC LIMIT 100'
          )
        ).rows,
        events: (
          await sql.query(
            'SELECT id,event_type,status,attempts,created_at FROM outbox_events ORDER BY created_at DESC LIMIT 100'
          )
        ).rows
      }
    })
  })
}
