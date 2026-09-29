import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import type { Config } from './config.ts'
import type { Database } from './db.ts'
import { denied, Fault, unavailable } from './domain.ts'
import { PRIVATE_CSP, PRIVATE_PERMISSIONS, PRIVATE_ROUTE_PATTERN, STAFF_PERMISSIONS, isStaffRoute } from './security-headers.ts'
import { registerAuth } from './auth.ts'
import { migrationNames } from './migrate.ts'
import { registerRoutes } from './routes.ts'
import { registerWeb } from './web.ts'

export async function buildApp(
  config: Config,
  db?: Database,
  log: (entry: Record<string, unknown>) => void = (entry) => console.log(JSON.stringify(entry)),
  webRoot?: string,
  rateLimitMax = 120
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 48 * 1024,
    requestTimeout: 15000,
    connectionTimeout: 15000,
    genReqId: () => randomUUID(),
    trustProxy: false
  })
  await app.register(cookie)
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    referrerPolicy: { policy: 'no-referrer' }
  })
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    // ponytail: key on the Heroku-appended client IP (rightmost XFF entry);
    // the socket IP is the router, which would put every patient in one bucket.
    keyGenerator: (request) => {
      const forwarded = request.headers['x-forwarded-for']
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
      return value?.split(',').pop()?.trim() || request.ip
    }
  })
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Request-ID', request.id)
    if (PRIVATE_ROUTE_PATTERN.test(path)) {
      reply.header('X-Robots-Tag', 'noindex, nofollow')
      reply.header('Content-Security-Policy', PRIVATE_CSP)
      reply.header('Permissions-Policy', isStaffRoute(path) ? STAFF_PERMISSIONS : PRIVATE_PERMISSIONS)
    }
    if (
      config.production && webRoot && ['GET', 'HEAD'].includes(request.method) &&
      path !== '/api' && !path.startsWith('/api/') &&
      request.headers.host !== new URL(config.origin).host
    )
      return reply.code(308).redirect(`${config.origin}${request.url}`)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (
        request.headers.origin !== config.origin ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw denied()
      if (request.method !== 'DELETE' && !request.headers['content-type']?.startsWith('application/json'))
        throw new Fault(415, 'JSON_REQUIRED', 'Use a supported request format.')
    }
  })
  app.addHook('onResponse', async (request, reply) => {
    log({
      event: 'http.request',
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url || 'unmatched',
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime)
    })
  })
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
    let fault: Fault
    if (error instanceof Fault) fault = error
    else if (error instanceof ZodError) {
      // Translate recognized fields while keeping missing and malformed values
      // distinct. Unknown paths retain the generic INVALID_INPUT fallback.
      const issue = error.issues[0]
      const path = (issue?.path || []).join('.')
      const fieldMessages: Record<string, { missing: { code: string; message: string }; invalid: { code: string; message: string } }> = {
        state: {
          missing: { code: 'MISSING_STATE', message: 'Please select the State or territory first.' },
          invalid: { code: 'INVALID_STATE', message: 'Please select a valid State or territory.' }
        },
        firstName: {
          missing: { code: 'MISSING_FIRST_NAME', message: 'Please enter your first name.' },
          invalid: { code: 'INVALID_FIRST_NAME', message: 'Please enter a valid first name no longer than 100 characters.' }
        },
        lastName: {
          missing: { code: 'MISSING_LAST_NAME', message: 'Please enter your last name.' },
          invalid: { code: 'INVALID_LAST_NAME', message: 'Please enter a valid last name no longer than 100 characters.' }
        },
        email: {
          missing: { code: 'MISSING_EMAIL', message: 'Please enter your email address.' },
          invalid: { code: 'INVALID_EMAIL', message: 'Please enter an email address no longer than 254 characters.' }
        },
        phone: {
          missing: { code: 'MISSING_PHONE', message: 'Please enter your phone number.' },
          invalid: { code: 'INVALID_PHONE', message: 'Please enter a phone number no longer than 50 characters.' }
        },
        reason: {
          missing: { code: 'MISSING_REASON', message: 'Please tell us the reason for your request.' },
          invalid: { code: 'INVALID_REASON', message: 'Please keep the reason for your request to 4,000 characters or fewer.' }
        },
        mode: {
          missing: { code: 'MISSING_MODE', message: 'Please choose how you want to consult.' },
          invalid: { code: 'INVALID_MODE', message: 'Please choose a valid consultation type.' }
        }
      }
      const issueDetails = issue as { code?: string; input?: unknown } | undefined
      const body = request.body as Record<string, unknown> | null | undefined
      const issueInput =
        issueDetails && Object.hasOwn(issueDetails, 'input')
          ? issueDetails.input
          : body?.[path]
      const missingOrEmpty =
        ['invalid_type', 'invalid_value', 'too_small'].includes(issueDetails?.code ?? '') &&
        (issueInput === undefined || (typeof issueInput === 'string' && !issueInput.trim()))
      const entry = fieldMessages[path]
      const targeted = entry?.[missingOrEmpty ? 'missing' : 'invalid']
      fault = new Fault(
        400,
        targeted?.code ?? 'INVALID_INPUT',
        targeted?.message ?? 'Check the information and try again.'
      )
    } else if (error.statusCode === 400)
      fault = new Fault(400, 'INVALID_INPUT', 'Check the information and try again.')
    else if (['23505', '23P01'].includes(error.code || ''))
      fault = new Fault(
        409,
        'CONFLICT',
        'This record or appointment conflicts with an existing one. Refresh and try again.'
      )
    else if (error.statusCode === 429)
      fault = new Fault(429, 'RATE_LIMITED', 'Please wait before trying again.')
    else if (error.statusCode === 413)
      fault = new Fault(413, 'TOO_LARGE', 'This request is too large.')
    else fault = unavailable()
    // Log only the error class and database code: never messages, stacks, bodies, or cookies.
    const cause = error as { code?: unknown; constructor?: { name?: unknown } }
    const errorName = typeof cause?.constructor?.name === 'string' ? cause.constructor.name : 'Error'
    const errorCode = typeof cause?.code === 'string' && /^[A-Z0-9]{5}$/.test(cause.code) ? cause.code : undefined
    log({ event: 'http.failure', requestId: request.id, code: fault.code, status: fault.status, errorName, ...(errorCode ? { errorCode } : {}) })
    reply
      .code(fault.status)
      .send({ error: { code: fault.code, message: fault.message }, requestId: request.id })
  })
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0]
    if (
      webRoot &&
      request.method === 'GET' &&
      path !== '/api' &&
      !path.startsWith('/api/') &&
      !path.includes('.')
    )
      return reply.sendFile('index.html')
    return reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'This service route is not available.' } })
  })
  app.get('/api/health/live', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))
  app.get('/api/health/ready', { config: { rateLimit: false } }, async () => {
    if (!db || !config.encryptionKey) throw unavailable()
    if (!(await db.query('SELECT version FROM questionnaires LIMIT 1')).rows.length)
      throw unavailable()
    const expected = (await migrationNames()).at(-1)
    if (!expected) throw unavailable()
    if (!(
      await db.query(
        'SELECT name FROM schema_migrations WHERE name=$1 AND deferred_completed_at IS NOT NULL',
        [expected]
      )
    ).rows.length)
      throw unavailable()
    return { status: 'ready' }
  })
  registerAuth(app, db, config)
  registerRoutes(app, db, config)
  if (webRoot) await registerWeb(app, webRoot)
  return app
}
