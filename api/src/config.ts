import { z } from 'zod'

export   type Config = {
  production: boolean
  origin: string
  /**
   * Further origins a browser may make a state-changing request from.
   *
   * `origin` remains the canonical one — it is what links are built from and
   * what a production host redirects to — and it is checked on its own, so
   * overriding it in a fixture still works. The extras exist so one build can
   * be reached as `http://localhost:4173` and `http://192.168.2.47:4173`
   * without loosening the check that made this a defence in the first place: a
   * request is refused unless its Origin matches exactly.
   */
  extraOrigins: string[]
  port: number
  databaseUrl?: string
  workerDatabaseUrl?: string
  encryptionKey?: string
  intakeEnabled: boolean
  notificationsEnabled: boolean
  minPasswordLength: number
}

export function loadConfig(env = process.env, mode: 'api' | 'worker' = 'api'): Config {
  const production = env.NODE_ENV === 'production'
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' && process.env.FADEWELL_ALLOW_INSECURE_TLS !== 'true')
    throw new Error('TLS certificate verification must remain enabled unless the operator opts in with FADEWELL_ALLOW_INSECURE_TLS')

  /**
   * An origin is a scheme, host and port and nothing else. A path, query or
   * fragment would never be sent in an Origin header, so accepting one here
   * would silently never match — and a prefix match would be a hole.
   */
  const parseOrigin = (value: string, label: string) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`${label} must be an absolute origin, for example https://cards.example.com`)
    }
    if (url.origin !== value.replace(/\/$/, ''))
      throw new Error(`${label} must be an exact origin with no path, query or fragment`)
    if (production && url.protocol !== 'https:')
      throw new Error(`${label} must use HTTPS in production`)
    return url.origin
  }

  const origin = parseOrigin(env.APP_ORIGIN || 'http://localhost:5173', 'APP_ORIGIN')
  const extraOrigins = (env.APP_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => parseOrigin(value, 'APP_ORIGINS'))

  if (env.NOTIFICATIONS_ENABLED === 'true' && new URL(origin).protocol !== 'https:')
    throw new Error('Notification links require an HTTPS application origin')
  if (env.DATA_ENCRYPTION_KEY && !/^[A-Za-z0-9+/]{43}=$/.test(env.DATA_ENCRYPTION_KEY))
    throw new Error('DATA_ENCRYPTION_KEY must be a base64 encoded 32-byte key')
  const minPasswordLength = 12
  const databaseUrl = mode === 'worker' ? (env.DATABASE_WORKER_URL ?? env.DATABASE_URL) : env.DATABASE_URL
  if (
    production &&
    (!databaseUrl ||
      !env.DATA_ENCRYPTION_KEY ||
      (mode === 'api' && new URL(origin).protocol !== 'https:'))
  )
    throw new Error('Production service configuration is incomplete')
  return {
    production,
    origin,
    extraOrigins: extraOrigins.filter((value) => value !== origin),
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT || 3001),
    databaseUrl: env.DATABASE_URL,
    workerDatabaseUrl: env.DATABASE_WORKER_URL,
    encryptionKey: env.DATA_ENCRYPTION_KEY,
    intakeEnabled: env.INTAKE_ENABLED === 'true',
    notificationsEnabled: env.NOTIFICATIONS_ENABLED === 'true',
    minPasswordLength
  }
}
