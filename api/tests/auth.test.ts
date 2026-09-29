import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { generateSecret, generateSync, verifySync } from 'otplib'
import { seal } from '../src/security.ts'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { hashPassword } from '../src/auth.ts'
import { migrate } from '../src/migrate.ts'
import { open } from '../src/security.ts'
import type { Database } from '../src/db.ts'
import { testDatabase } from './database.ts'

test('local credentials enforce MFA, persist lockouts, revoke access, and work with runtime grants', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  for (const name of ['runtime-grants.sql', 'worker-grants.sql'])
    await db.query(await readFile(new URL(`../deploy/${name}`, import.meta.url), 'utf8'))
  await db.query('CREATE POLICY mca_backend ON local_credentials TO mca_runtime USING (true) WITH CHECK (true)')
  const runtime: Database = {
    query: (text, values) => db.transaction(async (sql) => {
      await sql.query('SET LOCAL ROLE mca_runtime'); return sql.query(text, values)
    }),
    transaction: (run) => db.transaction(async (sql) => {
      await sql.query('SET LOCAL ROLE mca_runtime'); return run(sql)
    }),
    withConnection: (run) => db.withConnection(async (connection) => {
      await connection.query('SET ROLE mca_runtime')
      try { return await run(connection) } finally { await connection.query('RESET ROLE') }
    }),
    close: async () => {}
  }
  const password = 'Synthetic-Password-2026'
  const config = { ...loadConfig({}), origin: 'https://care.example.test', encryptionKey: randomBytes(32).toString('base64') }
  const logs: unknown[] = []
  const app = await buildApp(config, runtime, (entry) => logs.push(entry))
  t.after(() => app.close())
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Local authentication must not contact an identity provider') })
  let requests = 0
  const post = (path: string, body: unknown, cookie = '', csrf = '') => app.inject({
    method: 'POST', url: `/api/auth/${path}`, remoteAddress: `192.0.2.${++requests}`,
    headers: { origin: config.origin, 'content-type': 'application/json', cookie, 'x-csrf-token': csrf }, payload: body as any
  })
  const login = (username: string, value = password) => post('login', { username, password: value })
  const cookie = (r: Awaited<ReturnType<typeof login>>, name = '__Host-fadewell-login') => {
    const c = r.cookies.find((item) => item.name === name)!
    assert.ok(c, `${r.statusCode}: ${r.body}`)
    assert.equal(c.httpOnly, true); assert.equal(c.secure, true); assert.equal(c.path, '/'); assert.equal(c.domain, undefined)
    return `${c.name}=${c.value}`
  }
  const account = async (username: string, role = 'ADMIN') => {
    const id = randomUUID()
    await db.query("INSERT INTO identities(id,issuer,subject,role) VALUES ($1,'local',$2,$3)", [id, username, role])
    await db.query('INSERT INTO local_credentials(identity_id,username,password_hash) VALUES ($1,$2,$3)', [id, username, await hashPassword(password)])
    return id
  }
  const adminId = await account('AdminOne')
  const session = async (value: string) => (await app.inject({ url: '/api/v1/session', headers: { cookie: value } })).json()
  const invalidCode = (secret: string) => {
    for (let i = 0; i < 10; i++) {
      const value = String(i).padStart(6, '0')
      if (!verifySync({ secret, token: value, epochTolerance: 30 }).valid) return value
    }
    throw new Error('Unable to select invalid test token')
  }

  assert.equal((await login('Nobody')).statusCode, 401)
  assert.equal((await login('AdminOne', 'wrong')).statusCode, 401)
  assert.equal((await db.query('SELECT failed_login_attempts FROM local_credentials WHERE identity_id=$1', [adminId])).rows[0].failed_login_attempts, 1)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action='LOGIN_REJECTED'")).rows[0].n, 2)
  assert.equal((await post('login', { username: 'AdminOne', password, role: 'ADMIN' })).statusCode, 400)

  const first = await login(' adminone ')
  assert.equal(first.statusCode, 200)
  assert.equal(first.json().step, 'mfa')
  assert.equal(first.cookies.some((c) => c.name === '__Host-fadewell-session'), false, 'Password alone must not grant workforce access')
  const firstCookie = cookie(first)
  const firstSecret = first.json().secret
  assert.ok(firstSecret)
  const stored = (await db.query('SELECT encrypted_payload FROM login_states')).rows[0].encrypted_payload
  assert.equal(stored.includes(firstSecret), false)
  assert.equal(stored.includes(adminId), false)
  const pending = await app.inject({ url: '/api/auth/pending', headers: { cookie: firstCookie } })
  assert.equal(pending.json().secret, firstSecret)
  assert.equal((await post('mfa', { code: invalidCode(firstSecret) }, firstCookie)).statusCode, 401)
  assert.equal((await post('mfa', { code: generateSync({ secret: firstSecret }) }, firstCookie)).statusCode, 401)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n, 0)

  const fresh = await login('AdminOne')
  const secret = fresh.json().secret
  const completed = await post('mfa', { code: generateSync({ secret }) }, cookie(fresh))
  assert.equal(completed.statusCode, 200, completed.body)
  assert.equal(completed.json().home, '/admin')
  const activeCookie = cookie(completed, '__Host-fadewell-session')
  const actor = await session(activeCookie)
  assert.equal(actor.role, 'ADMIN')
  const credential = (await db.query('SELECT * FROM local_credentials WHERE identity_id=$1', [adminId])).rows[0]
  assert.match(credential.password_hash, /^\$argon2id\$/)
  assert.equal(credential.encrypted_totp_secret.includes(secret), false)
  assert.equal(open(credential.encrypted_totp_secret, config.encryptionKey, `totp:${adminId}`), secret)
  assert.equal(credential.failed_login_attempts, 0)

  const next = await login('AdminOne')
  assert.equal(next.json().secret, undefined, 'Never redisplay an enrolled secret')
  assert.equal((await post('mfa', { code: generateSync({ secret }) }, cookie(next))).statusCode, 401, 'A previously accepted TOTP time step cannot be replayed')
  const stale = await login('AdminOne')
  assert.equal((await post('password/change', { currentPassword: 'wrong', newPassword: 'New-Synthetic-2026' }, activeCookie, actor.csrf)).statusCode, 401)
  assert.equal((await post('password/change', { currentPassword: password, newPassword: 'short' }, activeCookie, actor.csrf)).statusCode, 400)
  assert.equal((await post('password/change', { currentPassword: password, newPassword: 'New-Synthetic-2026' }, activeCookie)).statusCode, 403)
  assert.equal((await post('password/change', { currentPassword: password, newPassword: 'New-Synthetic-2026' }, activeCookie, actor.csrf)).statusCode, 200)
  assert.equal((await app.inject({ url: '/api/v1/session', headers: { cookie: activeCookie } })).statusCode, 401)
  const futureToken = () => generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 })
  assert.equal((await post('mfa', { code: futureToken() }, cookie(stale))).statusCode, 401, 'Password changes invalidate pending MFA')
  const relogin = await login('AdminOne', 'New-Synthetic-2026')
  const renewed = await post('mfa', { code: futureToken() }, cookie(relogin))
  assert.equal(renewed.statusCode, 200, renewed.body)
  const renewedCookie = cookie(renewed, '__Host-fadewell-session')
  const renewedActor = await session(renewedCookie)
  assert.equal((await post('logout', {}, renewedCookie, renewedActor.csrf)).statusCode, 200)
  assert.equal((await app.inject({ url: '/api/v1/session', headers: { cookie: renewedCookie } })).statusCode, 401)

  const lockedId = await account('LockedDoctor', 'DOCTOR')
  for (let i = 0; i < 5; i++) assert.equal((await login('LockedDoctor', 'wrong')).statusCode, 401)
  assert.equal((await login('LockedDoctor')).statusCode, 429)
  assert.equal((await db.query('SELECT failed_login_attempts FROM local_credentials WHERE identity_id=$1', [lockedId])).rows[0].failed_login_attempts, 5)
  await db.query("UPDATE local_credentials SET locked_until=now()-interval '1 minute' WHERE identity_id=$1", [lockedId])
  const afterLock = await login('LockedDoctor')
  assert.equal(afterLock.statusCode, 200)
  assert.equal(afterLock.json().step, 'mfa')
  assert.equal(afterLock.cookies.some((c) => c.name === '__Host-fadewell-session'), false)
  const doctorLogin = await post('mfa', { code: generateSync({ secret: afterLock.json().secret }) }, cookie(afterLock))
  assert.equal(doctorLogin.statusCode, 200)
  assert.equal((await session(cookie(doctorLogin, '__Host-fadewell-session'))).role, 'DOCTOR')
  assert.equal((await db.query('SELECT failed_login_attempts FROM local_credentials WHERE identity_id=$1', [lockedId])).rows[0].failed_login_attempts, 0)

  const disabledId = await account('DisabledStaff', 'STAFF')
  const staffStart = await login('DisabledStaff')
  assert.equal(staffStart.json().step, 'mfa')
  const staffLogin = await post('mfa', { code: generateSync({ secret: staffStart.json().secret }) }, cookie(staffStart))
  const staffCookie = cookie(staffLogin, '__Host-fadewell-session')
  await db.query('UPDATE identities SET enabled=false WHERE id=$1', [disabledId])
  assert.equal((await app.inject({ url: '/api/v1/session', headers: { cookie: staffCookie } })).statusCode, 401)
  assert.equal((await login('DisabledStaff')).statusCode, 401)
  await assert.rejects(runtime.query("UPDATE identities SET role='ADMIN' WHERE id=$1", [lockedId]))
  await assert.rejects(runtime.query("UPDATE local_credentials SET username='Changed' WHERE identity_id=$1", [lockedId]))
  await assert.rejects(db.transaction(async (sql) => { await sql.query('SET LOCAL ROLE mca_worker'); await sql.query('SELECT password_hash FROM local_credentials') }))
  await assert.rejects(db.query("UPDATE local_credentials SET username='ADMINONE' WHERE identity_id=$1", [lockedId]),
    (error: any) => error.code === '23505')
  const serializedLogs = JSON.stringify(logs)
  for (const value of [password, firstSecret, secret, credential.password_hash, activeCookie.split('=')[1]])
    assert.equal(serializedLogs.includes(value), false)
})

test('corrupted MFA challenges and stored secrets fail closed with 401, never 503', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  const config = { ...loadConfig({}), origin: 'https://care.example.test', encryptionKey: randomBytes(32).toString('base64') }
  const app = await buildApp(config, db, () => {})
  t.after(() => app.close())
  const headers = { origin: config.origin, 'content-type': 'application/json' }
  const password = 'Synthetic-Password-2026'
  const id = randomUUID()
  await db.query(`INSERT INTO identities(id,issuer,subject,role) VALUES ($1,'local','corrupt-1','ADMIN')`, [id])
  await db.query('INSERT INTO local_credentials(identity_id,username,password_hash) VALUES ($1,$2,$3)',
    [id, 'CorruptAdmin', await hashPassword(password)])
  const start = await app.inject({
    method: 'POST', url: '/api/auth/login', headers, payload: { username: 'CorruptAdmin', password }
  })
  assert.equal(start.statusCode, 200)
  const pending = start.cookies.find((c) => c.name === '__Host-fadewell-login')!
  // Tamper with the stored challenge: decryption must fail closed as a bad login.
  await db.query('UPDATE login_states SET encrypted_payload=$1', ['v1.tampered.invalid'])
  const tampered = await app.inject({
    method: 'POST', url: '/api/auth/mfa', headers: { ...headers, cookie: `__Host-fadewell-login=${pending.value}` },
    payload: { code: '123456' }
  })
  assert.equal(tampered.statusCode, 401, tampered.body)
  // Corrupt the stored secret on an enrolled account: verification must fail closed.
  await db.query('UPDATE local_credentials SET encrypted_totp_secret=$1, totp_verified=true WHERE identity_id=$2',
    ['v1.tampered.invalid', id])
  const enrolled = await app.inject({
    method: 'POST', url: '/api/auth/login', headers, payload: { username: 'CorruptAdmin', password }
  })
  assert.equal(enrolled.statusCode, 200)
  const enrolledPending = enrolled.cookies.find((c) => c.name === '__Host-fadewell-login')!
  const corruptSecret = await app.inject({
    method: 'POST', url: '/api/auth/mfa', headers: { ...headers, cookie: `__Host-fadewell-login=${enrolledPending.value}` },
    payload: { code: '123456' }
  })
  assert.equal(corruptSecret.statusCode, 401, corruptSecret.body)
  const unlocked = await app.inject({ url: '/api/auth/pending', headers: { cookie: `__Host-fadewell-login=${enrolledPending.value}` } })
  assert.equal(unlocked.statusCode, 200)
})

test('local authentication requires backend configuration and retains production password policy', () => {
  const env = { NODE_ENV: 'production', APP_ORIGIN: 'https://care.example.test', DATABASE_URL: 'postgres://example', DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
  assert.equal(loadConfig(env).production, true)
  assert.equal(loadConfig({ ...env, MIN_PASSWORD_LENGTH: '10' }).minPasswordLength, 12)
  assert.throws(() => loadConfig({ ...env, DATA_ENCRYPTION_KEY: '' }))
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'http://insecure.test' }))
})

test('admin user creation issues TOTP setup key, and TOTP/password reset rotate credentials', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  for (const name of ['runtime-grants.sql', 'worker-grants.sql'])
    await db.query(await readFile(new URL(`../deploy/${name}`, import.meta.url), 'utf8'))
  const config = {
    ...loadConfig({}),
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64'),
    minPasswordLength: 12
  }
  const adminPassword = 'Synthetic-Admin-2026'
  const adminId = randomUUID()
  const totpSecret = generateSecret()
  await db.query(`INSERT INTO identities(id,issuer,subject,role) VALUES ($1,'local','admin-1','ADMIN')`, [adminId])
  await db.query(`INSERT INTO local_credentials(identity_id,username,password_hash,password_updated_at)
    VALUES ($1,'AdminOne',$2,now())`, [adminId, await hashPassword(adminPassword)])
  // Simulate MFA enrollment so /api/auth/login returns a session directly.
  await db.query(
    `UPDATE local_credentials SET encrypted_totp_secret=$1, totp_verified=true
     WHERE identity_id=(SELECT id FROM identities WHERE subject='admin-1')`,
    [seal(totpSecret, config.encryptionKey, `totp:${adminId}`)]
  )
  const app = await buildApp(config, db, () => {})
  t.after(() => app.close())
  const headers = { origin: config.origin, 'content-type': 'application/json' }
  const login = async (username: string, password: string) => app.inject({
    method: 'POST', url: '/api/auth/login', remoteAddress: '192.0.2.10', headers, payload: { username, password }
  })
  const completeMfa = async (cookie: string, code: string) => app.inject({
    method: 'POST', url: '/api/auth/mfa', remoteAddress: '192.0.2.10',
    headers: { ...headers, cookie }, payload: { code }
  })
  const adminStart = await login('AdminOne', adminPassword)
  assert.equal(adminStart.statusCode, 200, adminStart.body)
  const adminPending = adminStart.cookies.find((item) => item.name === '__Host-fadewell-login')!
  const adminCode = generateSync({ secret: totpSecret })
  const adminSession = await completeMfa(`__Host-fadewell-login=${adminPending.value}`, adminCode)
  assert.equal(adminSession.statusCode, 200, adminSession.body)
  const adminCookie = adminSession.cookies.find((item) => item.name === '__Host-fadewell-session')!
  assert.ok(adminCookie, `no admin session cookie: ${adminSession.body}`)
  const adminCsrf = (await app.inject({
    url: '/api/v1/session', headers: { ...headers, cookie: `${adminCookie.name}=${adminCookie.value}` }
  })).json().csrf
  const auth = {
    ...headers,
    cookie: `${adminCookie.name}=${adminCookie.value}`,
    'x-csrf-token': adminCsrf
  }
  const postAdmin = (path: string, body: unknown) =>
    app.inject({ method: 'POST', url: `/api/v1${path}`, headers: auth, payload: body as any })
  const patchAdmin = (path: string, body: unknown) =>
    app.inject({ method: 'PATCH', url: `/api/v1${path}`, headers: auth, payload: body as any })

  // Patient accounts cannot be created through this endpoint.
  const patientAttempt = await postAdmin('/admin/users', {
    username: 'PatientOne', password: 'New-Patient-2026', role: 'PATIENT'
  })
  assert.equal(patientAttempt.statusCode, 400, patientAttempt.body)

  const created = await postAdmin('/admin/users', {
    username: 'DoctorOne', password: 'New-Doctor-2026', role: 'DOCTOR'
  })
  assert.equal(created.statusCode, 200, created.body)
  const createdBody = created.json()
  assert.ok(!('totpSecret' in createdBody), 'admin creation must not issue setup keys')
  assert.equal(createdBody.username, 'DoctorOne')
  assert.match(createdBody.message, /first sign-in/)
  const duplicate = await postAdmin('/admin/users', {
    username: 'doctorone', password: 'Different-Password-2026', role: 'DOCTOR'
  })
  assert.equal(duplicate.statusCode, 409, duplicate.body)

  // All workforce roles must finish TOTP enrollment before receiving a session.
  const doctorStart = await login('DoctorOne', 'New-Doctor-2026')
  assert.equal(doctorStart.statusCode, 200, doctorStart.body)
  assert.equal(doctorStart.json().step, 'mfa')
  assert.equal(doctorStart.cookies.some((c) => c.name === '__Host-fadewell-session'), false)
  const doctorPendingCookie = doctorStart.cookies.find(c => c.name === '__Host-fadewell-login')!
  assert.equal((await completeMfa(`${doctorPendingCookie.name}=${doctorPendingCookie.value}`, generateSync({ secret: doctorStart.json().secret }))).json().home, '/portal')

  // Authenticator reset applies to every workforce role.
  const totpReset = await postAdmin(`/admin/users/${createdBody.id}/reset-totp`, {})
  assert.equal(totpReset.statusCode, 200, totpReset.body)

  // Password reset revokes active sessions and requires the new password.
  const weak = await patchAdmin(`/admin/users/${createdBody.id}/password`, { password: 'short' })
  assert.equal(weak.statusCode, 400, weak.body)
  const ok = await patchAdmin(`/admin/users/${createdBody.id}/password`, {
    password: 'Another-Doctor-2026'
  })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal((await login('DoctorOne', 'New-Doctor-2026')).statusCode, 401)
  const doctorAfterResetPwd = await login('DoctorOne', 'Another-Doctor-2026')
  assert.equal(doctorAfterResetPwd.statusCode, 200, doctorAfterResetPwd.body)
  assert.equal(doctorAfterResetPwd.json().step, 'mfa')
  // Listing shows the new username and authenticator state.
  const list = await app.inject({ url: '/api/v1/admin/users', headers: auth })
  assert.equal(list.statusCode, 200, list.body)
  const summary = list.json().users.find((row: { id: string }) => row.id === createdBody.id)
  assert.equal(summary.username, 'DoctorOne')
  assert.equal(summary.totp_verified, false)
  assert.equal(summary.has_password, true)

  // Workforce members cannot reach admin endpoints.
  const doctorLogin = await login('DoctorOne', 'Another-Doctor-2026')
  assert.equal(doctorLogin.json().step, 'mfa')
  const doctorPending = doctorLogin.cookies.find(item => item.name === '__Host-fadewell-login')!
  const doctorCompleted = await completeMfa(`${doctorPending.name}=${doctorPending.value}`, generateSync({ secret: doctorLogin.json().secret }))
  const doctorSessionCookie = doctorCompleted.cookies.find((item) => item.name === '__Host-fadewell-session')!
  assert.ok(doctorSessionCookie, doctorCompleted.body)
  const doctorAuth = { ...headers, cookie: `${doctorSessionCookie.name}=${doctorSessionCookie.value}` }
  const doctorPost = await app.inject({
    method: 'POST', url: '/api/v1/admin/users', headers: doctorAuth, payload: {
      username: 'OtherDoctor', password: 'Other-Password-2026', role: 'DOCTOR'
    }
  })
  assert.equal(doctorPost.statusCode, 403, doctorPost.body)

  // Deletion removes sign-in access and hides the account from access management.
  const deleteHeaders = { ...auth, 'content-type': undefined }
  const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${createdBody.id}`, headers: deleteHeaders })
  assert.equal(deleted.statusCode, 200, deleted.body)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM local_credentials WHERE identity_id=$1', [createdBody.id])).rows[0].n, 0)
  assert.equal((await db.query('SELECT enabled FROM identities WHERE id=$1', [createdBody.id])).rows[0].enabled, false)
  assert.equal((await login('DoctorOne', 'Another-Doctor-2026')).statusCode, 401)
  const listAfterDelete = await app.inject({ url: '/api/v1/admin/users', headers: auth })
  assert.equal(listAfterDelete.json().users.some((row: { id: string }) => row.id === createdBody.id), false)
  const selfDelete = await app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${adminId}`, headers: deleteHeaders })
  assert.equal(selfDelete.statusCode, 403, selfDelete.body)
})
