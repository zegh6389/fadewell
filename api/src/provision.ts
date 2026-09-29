import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { loadConfig } from './config.ts'
import { connectDatabase, requireDb } from './db.ts'
import type { Database } from './db.ts'
import { hashPassword, usernameInput } from './auth.ts'

// Operator-only. Runtime credentials cannot create/change usernames or role assignments.
let db: Database | undefined
try {
  const config = loadConfig()
  const role = z.enum(['ADMIN', 'STAFF', 'DOCTOR']).parse(process.argv[2])
  const username = usernameInput.parse(process.argv[3])
  const minimum = role === 'ADMIN' && process.env.PROVISION_ALLOW_SHORT_ADMIN === 'true' ? 10 : 12
  const password = z.string().min(minimum).max(128).parse(process.env.PROVISION_PASSWORD)
  const existingId = process.env.PROVISION_ID ? z.string().uuid().parse(process.env.PROVISION_ID) : undefined
  const passwordHash = await hashPassword(password)
  db = requireDb(connectDatabase(config))
  const id = await db.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(62431893)')
    const credential = (await sql.query(
      'SELECT identity_id FROM local_credentials WHERE lower(username)=lower($1)', [username]
    )).rows[0]
    if (credential && process.env.PROVISION_RESET_PASSWORD !== 'true') throw new Error('Account already exists')
    if (credential && existingId && credential.identity_id !== existingId) throw new Error('Username belongs to another identity')
    const identityId = existingId || credential?.identity_id
    const identity = identityId
      ? (await sql.query('SELECT id,role,enabled FROM identities WHERE id=$1 FOR UPDATE', [identityId])).rows[0]
      : (await sql.query("INSERT INTO identities(issuer,subject,role) VALUES ('local',$1,$2) RETURNING id,role,enabled",
          [username.toLowerCase(), role])).rows[0]
    if (!identity?.enabled || identity.role !== role) throw new Error('Identity is disabled or role does not match')
    if (credential) {
      const resetMfa = process.env.PROVISION_RESET_MFA === 'true'
      await sql.query(`UPDATE local_credentials SET password_hash=$1,password_updated_at=now(),version=version+1,
        failed_login_attempts=0,locked_until=NULL,
        encrypted_totp_secret=CASE WHEN $3 THEN NULL ELSE encrypted_totp_secret END,
        totp_verified=CASE WHEN $3 THEN false ELSE totp_verified END,
        totp_last_step=CASE WHEN $3 THEN NULL ELSE totp_last_step END WHERE identity_id=$2`, [passwordHash, identity.id, resetMfa])
      if (resetMfa) await sql.query(`INSERT INTO audit_events(actor_role,action,resource_type,resource_id,request_id)
        VALUES ('OPERATOR','MFA_RESET_BY_OPERATOR','identity',$1,$2)`, [identity.id, randomUUID()])
    } else {
      await sql.query('INSERT INTO local_credentials(identity_id,username,password_hash) VALUES ($1,$2,$3)', [identity.id, username, passwordHash])
    }
    await sql.query('DELETE FROM sessions WHERE actor_id=$1', [identity.id])
    await sql.query(`INSERT INTO audit_events(actor_role,action,resource_type,resource_id,request_id)
      VALUES ('OPERATOR',$1,'identity',$2,$3)`, [credential ? 'PASSWORD_RESET_BY_OPERATOR' : 'LOCAL_LOGIN_PROVISIONED', identity.id, randomUUID()])
    return identity.id
  })
  console.log(JSON.stringify({ event: 'identity.provisioned', id, username, role }))
} catch (err) {
  console.error(JSON.stringify({ event: 'identity.provision_failed', code: (err as { code?: string })?.code, message: err instanceof Error ? err.message : String(err) }))
  process.exitCode = 1
} finally {
  await db?.close()
}
