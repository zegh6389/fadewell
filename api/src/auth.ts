import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import argon2 from 'argon2'
import { generateSecret, verifySync } from 'otplib'
import { z } from 'zod'
import type { Config } from './config.ts'
import { MIN_PASSWORD_LENGTH } from './config.ts'
import { audit, requireDb } from './db.ts'
import type { Database, Sql, Row } from './db.ts'
import { denied, Fault, unavailable } from './domain.ts'
import type { Actor, Role } from './domain.ts'
import { equalSecret, hash, open, randomToken, seal } from './security.ts'

export const roleHome: Record<Role, string> = {
  PATIENT: '/patient', DOCTOR: '/portal', STAFF: '/staff', ADMIN: '/admin'
}
export const cookieName = (config: Config) =>
  config.origin.startsWith('https://') ? '__Host-mmjgreen-session' : 'mmjgreen-session'

/**
 * The pre-rebrand cookie name.
 *
 * Still read so a rename cannot sign every signed-in user out the moment it
 * deploys. It is never written — the current name is the only one issued — and
 * every revocation path consumes it alongside the current one, so the stale
 * cookie cannot outlive the session it named.
 */
export const legacyCookieName = (config: Config) =>
  config.origin.startsWith('https://') ? '__Host-fadewell-session' : 'fadewell-session'

/**
 * Every session token the browser presented, current name first, de-duplicated.
 *
 * A rolling deploy can leave both names on one client: a new instance issues the
 * current cookie while an old instance still issues the legacy one. Reading only
 * the preferred name would leave the other session row alive in the database, so
 * rotation, logout, and join revocation all consume this list.
 */
export const sessionTokens = (request: FastifyRequest, config: Config) => {
  const tokens = new Set<string>()
  for (const name of [cookieName(config), legacyCookieName(config)]) {
    const value = request.cookies[name]
    if (value) tokens.add(value)
  }
  return [...tokens]
}

/** Reads the session cookie under the current name, falling back to the legacy one. */
export const sessionCookie = (request: FastifyRequest, config: Config) =>
  sessionTokens(request, config)[0]

/**
 * Deletes the session rows behind these tokens.
 *
 * Clearing a cookie is a browser-side act: it does not revoke the database
 * session. Anything holding the token keeps its access until the row expires.
 */
export async function revokeSessionTokens(sql: Sql, tokens: string[]) {
  for (const token of tokens) await sql.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)])
}
export const usernameInput = z.string().trim().regex(/^[A-Za-z0-9_.-]{3,64}$/)
const authFailed = () => new Fault(401, 'AUTH_FAILED', 'Check your username, password, or authenticator code.')
const locked = () => new Fault(429, 'ACCOUNT_LOCKED', 'Too many attempts. Try again in 15 minutes.')
type PendingLogin = { id: string; version: number; enrollmentSecret?: string }

export function hashPassword(plain: string) {
  return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
}
let dummyHash: Promise<string> | undefined
async function passwordMatches(stored: string | undefined, plain: string) {
  // Unknown usernames still perform Argon2 verification; never log credentials or provider errors.
  const candidate = stored || await (dummyHash ??= hashPassword(randomToken()))
  return await argon2.verify(candidate, plain)
}
async function loginAudit(sql: Sql, action: string, id: string | null, requestId: string) {
  await sql.query(
    "INSERT INTO audit_events(actor_role,action,resource_type,resource_id,request_id) VALUES ('AUTH',$1,'identity',$2,$3)",
    [action, id, requestId]
  )
}
async function rejectAttempt(sql: Sql, row: Row | undefined, requestId: string) {
  if (row) {
    const attempts = (row.locked_until && new Date(row.locked_until).getTime() <= Date.now()
      ? 0 : row.failed_login_attempts) + 1
    await sql.query('UPDATE local_credentials SET failed_login_attempts=$1,locked_until=$2 WHERE identity_id=$3',
      [attempts, attempts >= 5 ? new Date(Date.now() + 900000) : null, row.id])
  }
  await loginAudit(sql, 'LOGIN_REJECTED', row?.id || null, requestId)
  // Return the fault: throwing here would roll back the lockout and audit record.
  return { error: authFailed() }
}
async function writeSession(sql: Sql, request: FastifyRequest, config: Config, actor: { id: string; role: Role }) {
  const token = randomToken()
  // Revoke every presented session, not just the preferred one, so a token left
  // behind under the legacy cookie cannot survive this rotation.
  await revokeSessionTokens(sql, sessionTokens(request, config))
  await sql.query(
    "INSERT INTO sessions(token_hash,actor_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '4 hours')",
    [hash(token), actor.id, randomToken()]
  )
  await audit(sql, actor, 'SESSION_CREATED', 'identity', actor.id, request.id)
  return token
}

export async function authenticate(request: FastifyRequest, db: Database | undefined, config: Config, roles?: Role[]): Promise<Actor> {
  const database = requireDb(db)
  const token = sessionCookie(request, config)
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new Fault(401, 'AUTH_REQUIRED', 'Sign in to continue.')
  const tokenHash = hash(token)
  const passive = ['/api/v1/session', '/api/v1/consultations/:id', '/api/v1/consultations/:id/events'].includes(request.routeOptions.url || '')
  const row = (await database.query(
    `UPDATE sessions s SET last_seen_at=CASE WHEN $2 THEN s.last_seen_at ELSE now() END FROM identities i
     WHERE s.actor_id=i.id AND s.token_hash=$1 AND i.enabled=true AND s.expires_at>now()
     AND s.last_seen_at>now()-interval '15 minutes'
      RETURNING i.id,i.role,s.csrf,s.expires_at,s.join_appointment_id`, [tokenHash, passive]
  )).rows[0]
  if (!row) throw new Fault(401, 'SESSION_EXPIRED', 'Your session has ended. Sign in again to continue.')
  if (row.join_appointment_id) {
    const route = request.routeOptions.url
    const consultationRoute = ['/api/v1/consultations/:id', '/api/v1/consultations/:id/events', '/api/v1/consultations/:id/media'].includes(route || '')
    if (row.role !== 'PATIENT' || !(route === '/api/v1/session' || route === '/api/v1/workspace' || route === '/api/auth/logout' ||
      (consultationRoute && (request.params as { id?: string }).id === row.join_appointment_id))) throw denied()
  }
  if (roles && !roles.includes(row.role)) throw denied()
  if (!['GET', 'HEAD'].includes(request.method) && !equalSecret(String(request.headers['x-csrf-token'] || ''), row.csrf)) throw denied()
  return { id: row.id, role: row.role, csrf: row.csrf, sessionHash: tokenHash, expiresAt: new Date(row.expires_at).toISOString(), joinAppointmentId: row.join_appointment_id || null }
}

export function registerAuth(app: FastifyInstance, database: Database | undefined, config: Config) {
  const db = () => requireDb(database)
  const key = () => { if (!config.encryptionKey) throw unavailable(); return config.encryptionKey }
  const options = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
  const cookies = { path: '/', httpOnly: true, secure: config.origin.startsWith('https://'), sameSite: 'strict' as const }
  const pendingCookie = cookies.secure ? '__Host-mmjgreen-login' : 'mmjgreen-login'
  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(cookieName(config), token, { ...cookies, sameSite: 'lax', maxAge: 14400 })
  /** Clears the current cookie and any pre-rebrand one still on the browser. */
  const clearSession = (reply: FastifyReply) => {
    reply.clearCookie(cookieName(config), cookies)
    reply.clearCookie(legacyCookieName(config), cookies)
  }
  const credentialQuery = `SELECT i.id,i.role,i.enabled,c.* FROM identities i
    JOIN local_credentials c ON c.identity_id=i.id`

  app.get('/api/auth/status', async () => ({
    configured: Boolean(database && config.encryptionKey), intakeEnabled: config.intakeEnabled, provider: 'local'
  }))

  app.post('/api/auth/login', options, async (request, reply) => {
    key()
    const input = z.object({ username: usernameInput, password: z.string().min(1).max(128) }).strict().parse(request.body)
    const pending = randomToken()
    const result = await db().transaction(async (sql) => {
      const row = (await sql.query(`${credentialQuery} WHERE lower(c.username)=lower($1) FOR UPDATE OF i,c`, [input.username])).rows[0]
      if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        await loginAudit(sql, 'LOGIN_LOCKED', row.id, request.id)
        return { error: locked() }
      }
      const matches = await passwordMatches(row?.password_hash, input.password)
      if (!row?.enabled || row.role === 'PATIENT' || !matches) return rejectAttempt(sql, row, request.id)
        await loginAudit(sql, 'PASSWORD_VERIFIED', row.id, request.id)
        let enrollmentSecret: string | undefined
        if (row.totp_verified) {
          await sql.query("INSERT INTO login_states(state_hash, encrypted_payload, expires_at) VALUES ($1,$2,now()+interval '10 minutes')",
            [hash(pending), seal({ id: row.id, version: row.version } as PendingLogin, key(), `login:${hash(pending)}`)])
        } else {
          // Enrollment or re-enrollment: rotate the TOTP secret so the previous
          // (potentially leaked) key cannot be used, and wipe the last-step window.
          enrollmentSecret = generateSecret()
          const rotated = (await sql.query(
            "UPDATE local_credentials SET encrypted_totp_secret=$1, totp_last_step=NULL, version=version+1 WHERE identity_id=$2 RETURNING version",
            [seal(enrollmentSecret, key(), `totp:${row.id}`), row.id]
          )).rows[0]
          await sql.query("INSERT INTO login_states(state_hash, encrypted_payload, expires_at) VALUES ($1,$2,now()+interval '10 minutes')",
            [hash(pending), seal({ id: row.id, version: rotated.version, enrollmentSecret } as PendingLogin, key(), `login:${hash(pending)}`)])
        }
        if (row.totp_verified) return { step: 'mfa' }
        return { step: 'mfa', secret: enrollmentSecret }
    })
    if ('error' in result) throw result.error
    reply.setCookie(pendingCookie, pending, { ...cookies, maxAge: 600 })
    return result
  })

  app.get('/api/auth/pending', async (request) => {
    key()
    const pending = request.cookies[pendingCookie]
    if (!pending || !/^[A-Za-z0-9_-]{43}$/.test(pending)) return { step: 'login' }
    const row = (await db().query('SELECT encrypted_payload FROM login_states WHERE state_hash=$1 AND expires_at>now()', [hash(pending)])).rows[0]
    if (!row) return { step: 'login' }
    let state: PendingLogin
    try {
      state = open<PendingLogin>(row.encrypted_payload, key(), `login:${hash(pending)}`)
    } catch {
      return { step: 'login' }
    }
    const identity = (await db().query(`${credentialQuery} WHERE i.id=$1 AND c.version=$2 AND i.enabled=true`, [state.id, state.version])).rows[0]
    if (!identity) return { step: 'login' }
    let secret: string | undefined
    if (state.enrollmentSecret !== undefined && !identity.totp_verified) {
      secret = state.enrollmentSecret
        ? state.enrollmentSecret
        : (() => {
            try {
              return open<string>(identity.encrypted_totp_secret, key(), `totp:${identity.id}`)
            } catch {
              return ''
            }
          })()
    }
    return { step: 'mfa', ...(secret !== undefined ? { secret } : {}) }
  })

  app.post('/api/auth/mfa', options, async (request, reply) => {
    key()
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(request.body)
    const pending = request.cookies[pendingCookie]
    if (!pending || !/^[A-Za-z0-9_-]{43}$/.test(pending)) throw authFailed()
    // Consume before verification, so even a bad code cannot replay the same challenge.
    const row = (await db().query('DELETE FROM login_states WHERE state_hash=$1 AND expires_at>now() RETURNING encrypted_payload', [hash(pending)])).rows[0]
    reply.clearCookie(pendingCookie, cookies)
    if (!row) throw authFailed()
    // An unreadable challenge fails closed as a bad login, never as a server error.
    let state: PendingLogin
    try {
      state = open<PendingLogin>(row.encrypted_payload, key(), `login:${hash(pending)}`)
      if (typeof state?.id !== 'string' || typeof state?.version !== 'number') throw new Error('INVALID_CHALLENGE')
    } catch {
      throw authFailed()
    }
    const result = await db().transaction(async (sql) => {
      const identity = (await sql.query(`${credentialQuery} WHERE i.id=$1 FOR UPDATE OF i,c`, [state.id])).rows[0]
      if (!identity?.enabled || identity.role === 'PATIENT' || identity.version !== state.version) return { error: authFailed() }
      if (identity.locked_until && new Date(identity.locked_until).getTime() > Date.now()) return { error: locked() }
      let secret: string
      try {
        secret = state.enrollmentSecret || open<string>(identity.encrypted_totp_secret, key(), `totp:${identity.id}`)
      } catch {
        return rejectAttempt(sql, identity, request.id)
      }
      let verified: { valid: boolean; timeStep?: number }
      try {
        verified = verifySync({ secret, token: code, epochTolerance: 30,
          ...(identity.totp_last_step === null ? {} : { afterTimeStep: Number(identity.totp_last_step) }) })
      } catch {
        return rejectAttempt(sql, identity, request.id)
      }
      if (!verified.valid || !('timeStep' in verified)) return rejectAttempt(sql, identity, request.id)
      await sql.query(`UPDATE local_credentials SET encrypted_totp_secret=$1,totp_last_step=$2,
        failed_login_attempts=0,locked_until=NULL${identity.totp_verified ? '' : ', totp_verified=true'} WHERE identity_id=$3`,
        [seal(secret, key(), `totp:${identity.id}`), verified.timeStep, identity.id])
      await loginAudit(sql, !identity.totp_verified ? 'TOTP_ENROLLED' : 'MFA_VERIFIED', identity.id, request.id)
      return { token: await writeSession(sql, request, config, { id: identity.id, role: identity.role }), home: roleHome[identity.role as Role] }
    })
    if ('error' in result) throw result.error
    setSession(reply, result.token)
    return { home: result.home }
  })

  app.post('/api/auth/password/change', options, async (request, reply) => {
    const actor = await authenticate(request, database, config, ['ADMIN', 'STAFF', 'DOCTOR'])
    const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128) }).strict().parse(request.body)
    const result = await db().transaction(async (sql) => {
      const row = (await sql.query(`${credentialQuery} WHERE i.id=$1 FOR UPDATE OF i,c`, [actor.id])).rows[0]
      if (!row?.enabled || !await passwordMatches(row.password_hash, input.currentPassword)) return { error: authFailed() }
      await sql.query('UPDATE local_credentials SET password_hash=$1,password_updated_at=now(),version=version+1 WHERE identity_id=$2',
        [await hashPassword(input.newPassword), actor.id])
      await sql.query('DELETE FROM sessions WHERE actor_id=$1', [actor.id])
      await audit(sql, actor, 'PASSWORD_CHANGED', 'identity', actor.id, request.id)
      return { changed: true }
    })
    if ('error' in result) throw result.error
    clearSession(reply)
    return { changed: true, step: 'login' }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const actor = await authenticate(request, database, config)
    await db().transaction(async (sql) => {
      // Revoke both names, not just the one that authenticated this request:
      // clearSession() only removes the cookies from the browser.
      await revokeSessionTokens(sql, sessionTokens(request, config))
      await audit(sql, actor, 'SESSION_REVOKED', 'identity', actor.id, request.id)
    })
    clearSession(reply)
    reply.clearCookie(pendingCookie, cookies)
    return { signedOut: true }
  })
  app.get('/api/v1/session', async (request) => {
    const actor = await authenticate(request, database, config)
    return { id: actor.id, role: actor.role, csrf: actor.csrf, expiresAt: actor.expiresAt, intakeEnabled: config.intakeEnabled, home: roleHome[actor.role], ...(actor.joinAppointmentId ? { joinAppointmentId: actor.joinAppointmentId } : {}) }
  })
  app.post('/api/auth/guest', options, async (request, reply) => {
    if (!config.intakeEnabled) throw unavailable()
    key()
    if (!z.object({}).strict().safeParse(request.body).success) throw denied()
    const result = await db().transaction(async (sql) => {
      const previous = sessionCookie(request, config)
      if (previous) {
        const existing = (await sql.query(`SELECT i.role FROM sessions s JOIN identities i ON i.id=s.actor_id
          WHERE s.token_hash=$1 AND i.enabled=true AND s.expires_at>now() AND s.last_seen_at>now()-interval '15 minutes'`, [hash(previous)])).rows[0]
        if (existing) { if (existing.role !== 'PATIENT') throw denied(); return null }
      }
      const identity = (await sql.query("INSERT INTO identities(issuer,subject,role) VALUES ('guest-intake',$1,'PATIENT') RETURNING id,role", [randomToken()])).rows[0]
      return writeSession(sql, request, config, { id: identity.id, role: 'PATIENT' })
    })
    if (result) setSession(reply, result)
    return { home: '/patient?view=intake' }
  })
}
