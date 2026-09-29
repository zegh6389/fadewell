import { z } from 'zod'

export   type Config = {
  production: boolean
  origin: string
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
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:5173')
  if (env.NOTIFICATIONS_ENABLED === 'true' && origin.protocol !== 'https:')
    throw new Error('Notification links require an HTTPS application origin')
  if (
    origin.origin !== origin.href.replace(/\/$/, '') ||
    (production && origin.protocol !== 'https:')
  )
    throw new Error('APP_ORIGIN must be an exact HTTPS origin in production')
  if (env.DATA_ENCRYPTION_KEY && !/^[A-Za-z0-9+/]{43}=$/.test(env.DATA_ENCRYPTION_KEY))
    throw new Error('DATA_ENCRYPTION_KEY must be a base64 encoded 32-byte key')
  const minPasswordLength = 12
  const databaseUrl = mode === 'worker' ? (env.DATABASE_WORKER_URL ?? env.DATABASE_URL) : env.DATABASE_URL
  if (
    production &&
    (!databaseUrl ||
      !env.DATA_ENCRYPTION_KEY ||
      (mode === 'api' && origin.protocol !== 'https:'))
  )
    throw new Error('Production service configuration is incomplete')
  return {
    production,
    origin: origin.origin,
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
