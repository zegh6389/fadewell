import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash as hashToken, seal } from '../src/security.ts'
import { runDeliveryCycle } from '../src/delivery.ts'

test('join tokens are issued, single-use, scoped and refuse mismatched or stale credentials', async (t) => {
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'"
  )
  const config = { ...loadConfig({}), origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64'), intakeEnabled: true }
  const app = await buildApp(config, db, () => {})
  t.after(() => app.close())
  const headers = { origin: config.origin, 'content-type': 'application/json' }
  const start = await app.inject({ method: 'POST', url: '/api/auth/guest', payload: {}, headers })
  const cookie = start.cookies.find(c => c.name === '__Host-mmjgreen-session')!
  const sessionHeaders = { ...headers, cookie: `${cookie.name}=${cookie.value}` }
  const session = (await app.inject({ url: '/api/v1/session', headers: sessionHeaders })).json()
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/intake', payload: {
    firstName: 'Synthetic', lastName: 'Join', email: 'join@example.test', phone: '+12025550144',
    state: 'CA', reason: 'join flow', mode: 'PHONE', smsConsent: true, emailConsent: false,
    answers: { age_verified: 'Yes' }, version: 0
  }, headers: { ...sessionHeaders, 'x-csrf-token': session.csrf } })
  const intakeId = saved.json().id
  // Submit requires the compulsory ID document.
  const joinDocId = randomUUID()
  await db.query(
    `INSERT INTO id_documents(id, intake_id, patient_id, id_type, mime, size_bytes, sha256, encrypted_payload)
     SELECT $1, i.id, i.patient_id, 'DRIVERS_LICENSE', 'image/jpeg', 4, repeat('a', 64), $2
     FROM intakes i WHERE i.id=$3`,
    [joinDocId, seal({ mime: 'image/jpeg', data: 'dGVzdA==' }, config.encryptionKey, `iddoc:${joinDocId}`), intakeId]
  )
  await app.inject({ method: 'POST', url: '/api/v1/intake/submit', payload: { version: saved.json().version },
    headers: { ...sessionHeaders, 'x-csrf-token': session.csrf } })
  const now = new Date()
  const startsAt = new Date(now.getTime() + 10 * 60000).toISOString()
  const endsAt = new Date(now.getTime() + 25 * 60000).toISOString()
  const doctor = await db.query("INSERT INTO identities(issuer,subject,role) VALUES ('synthetic','doctor-join','DOCTOR') RETURNING id")
  const availability = await db.query("INSERT INTO availability(doctor_id,starts_at,ends_at,timezone,buffer_minutes) VALUES ($1,$2,$3,'UTC',5) RETURNING id",
    [doctor.rows[0].id, new Date(now.getTime() - 24 * 3600 * 1000), new Date(now.getTime() + 72 * 3600 * 1000)])
  await db.query("UPDATE intakes SET state='VERIFIED' WHERE id=$1", [intakeId])
  const staff = await db.query("INSERT INTO identities(issuer,subject,role) VALUES ('synthetic','staff-join','STAFF') RETURNING id")
  await db.query("INSERT INTO sessions(token_hash,actor_id,csrf,expires_at,last_seen_at) VALUES ($1,$2,$3,now()+interval '4 hours',now())",
    [hashToken(randomBytes(32).toString('base64url')), staff.rows[0].id, randomBytes(32).toString('base64url')])
  // (no active cookie for this staff identity; subsequent staff actions go through headersFor)
  const appointment = (await db.query(
    `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'UTC','VIDEO',$8,$9) RETURNING id,version`,
    [intakeId, session.id, doctor.rows[0].id, availability.rows[0].id, startsAt, endsAt,
      new Date(now.getTime() + 80 * 60000), staff.rows[0].id, randomUUID()]
  )).rows[0]
  await db.query("INSERT INTO consultations(id,duration) VALUES ($1,$2)", [appointment.id, 900])
  await db.query("UPDATE intakes SET state='SCHEDULED' WHERE id=$1", [intakeId])

  const guestDenied = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appointment.id}/share-link`,
    payload: { version: appointment.version }, headers: { ...sessionHeaders, 'x-csrf-token': session.csrf } })
  assert.equal(guestDenied.statusCode, 403)

  const headersFor = async (issuer: string, subject: string) => {
    const identity = (await db.query(
      "INSERT INTO identities(issuer,subject,role) VALUES ($1,$2,'STAFF') RETURNING id", [issuer, subject]
    )).rows[0]
    const token = randomBytes(32).toString('base64url')
    const csrf = randomBytes(32).toString('base64url')
    await db.query("INSERT INTO sessions(token_hash,actor_id,csrf,expires_at,last_seen_at) VALUES ($1,$2,$3,now()+interval '4 hours',now())", [hashToken(token), identity.id, csrf])
    return { ...headers, cookie: `__Host-mmjgreen-session=${token}`, 'x-csrf-token': csrf }
  }
  const staffHeaders = await headersFor('synthetic', 'staff-join-2')
  const intakeRecord = await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: staffHeaders })
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/intakes/${intakeId}/verify-contact`,
    payload: { version: intakeRecord.json().version, channel: 'SMS', confirmedWithPatient: true }, headers: staffHeaders })).statusCode, 200)
  const issued = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appointment.id}/share-link`,
    payload: { version: appointment.version }, headers: staffHeaders })
  assert.equal(issued.statusCode, 200)
  const { token, url } = issued.json()
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token))
  assert.equal(url, `${config.origin}/patient?view=appointments#join=${token}`)
  const queued = (await db.query("SELECT encrypted_payload FROM outbox_events WHERE event_type='appointment.join_link_issued' AND resource_id=$1", [appointment.id])).rows[0]
  assert.ok(queued?.encrypted_payload)
  assert.equal(queued.encrypted_payload.includes(token), false)
  const texts: string[] = []
  for (let cycle = 0; cycle < 12; cycle++) {
    await runDeliveryCycle(db, config.encryptionKey, config.origin, {
      available: (channel) => channel === 'SMS',
      send: async (message) => { texts.push(message.text); return { outcome: 'ACCEPTED', receipt: randomUUID() } }
    })
    if (texts.some(text => text.includes(url))) break
  }
  assert.equal(texts.filter(text => text.includes(url)).length, 1, 'verified, consented phone gets the one-use link')

  const consume = () => app.inject({ method: 'POST', url: '/api/v1/join', payload: { token }, headers })
  const exchanges = await Promise.all([consume(), consume()])
  assert.deepEqual(exchanges.map(r => r.statusCode).sort(), [200, 403])
  const consumed = exchanges.find(r => r.statusCode === 200)!
  assert.equal(consumed.statusCode, 200)
  assert.equal(consumed.json().consultationId, appointment.id)
  const exchangedCookie = consumed.cookies.find(c => c.name === '__Host-mmjgreen-session')!
  assert.equal(exchangedCookie.httpOnly, true)
  assert.equal(exchangedCookie.secure, true)
  assert.equal((await app.inject({ url: `/api/v1/consultations/${appointment.id}`, headers: {
    cookie: `${exchangedCookie.name}=${exchangedCookie.value}`
  } })).statusCode, 200, 'The exchanged session must actually authorize consultation access')
  const joinedHeaders = { cookie: `${exchangedCookie.name}=${exchangedCookie.value}` }
  const joinedSession = await app.inject({ url: '/api/v1/session', headers: joinedHeaders })
  assert.equal(joinedSession.json().joinAppointmentId, appointment.id)
  assert.equal((await app.inject({ url: '/api/v1/intake', headers: joinedHeaders })).statusCode, 403)
  assert.equal((await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: joinedHeaders })).statusCode, 403)
  assert.equal((await app.inject({ url: `/api/v1/consultations/${randomUUID()}`, headers: joinedHeaders })).statusCode, 403)
  const joinedWorkspace = await app.inject({ url: '/api/v1/workspace', headers: joinedHeaders })
  assert.deepEqual(joinedWorkspace.json().intakes, [])
  assert.deepEqual(joinedWorkspace.json().appointments.map((a: { id: string }) => a.id), [appointment.id])

  const replay = await consume()
  assert.equal(replay.statusCode, 403, replay.body)

  const current = (await db.query("SELECT version FROM appointments WHERE id=$1", [appointment.id])).rows[0]
  const fresh = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appointment.id}/share-link`,
    payload: { version: current.version, ttlMinutes: 15 }, headers: staffHeaders })
  assert.equal(fresh.statusCode, 200, fresh.body)
  assert.ok(Date.parse(fresh.json().expiresAt) >= Date.parse(endsAt) + 60 * 60000,
    'join links must work through the entire visit and late-join grace period')
  const newToken = fresh.json().token
  for (let cycle = 0; cycle < 6; cycle++) {
    await runDeliveryCycle(db, config.encryptionKey, config.origin, {
      available: channel => channel === 'SMS',
      send: async message => { texts.push(message.text); return { outcome: 'ACCEPTED', receipt: randomUUID() } }
    })
    if (texts.some(text => text.includes(newToken))) break
  }
  assert.equal(texts.filter(text => text.includes(newToken)).length, 1, 'reissued link must not dedupe to a revoked link')
  await db.query("UPDATE appointments SET patient_join_token_expires_at=now()-interval '1 hour' WHERE id=$1", [appointment.id])
  const expired = await app.inject({ method: 'POST', url: '/api/v1/join', payload: { token: newToken }, headers })
  assert.equal(expired.statusCode, 410, expired.body)

  const unknown = await app.inject({ method: 'POST', url: '/api/v1/join', payload: { token: randomBytes(32).toString('base64url') }, headers })
  assert.equal(unknown.statusCode, 403, unknown.body)

  const preferences = (await app.inject({ url: '/api/v1/preferences', headers: sessionHeaders })).json().preferences
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/preferences', headers: { ...sessionHeaders, 'x-csrf-token': session.csrf },
    payload: { version: preferences.version, emailConsent: false, smsConsent: false } })).statusCode, 200)
  const version = (await db.query('SELECT version FROM appointments WHERE id=$1', [appointment.id])).rows[0].version
  const optedOut = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appointment.id}/share-link`,
    payload: { version, ttlMinutes: 15 }, headers: staffHeaders })
  assert.equal(optedOut.statusCode, 200)
  for (let cycle = 0; cycle < 4; cycle++) await runDeliveryCycle(db, config.encryptionKey, config.origin, {
    available: channel => channel === 'SMS',
    send: async message => { texts.push(message.text); return { outcome: 'ACCEPTED', receipt: randomUUID() } }
  })
  assert.equal(texts.some(text => text.includes(optedOut.json().token)), false, 'withdrawn SMS consent suppresses issued link')

  await db.query("UPDATE appointments SET starts_at=now()+interval '1 day', ends_at=now()+interval '1 day 15 minutes', reserved_until=now()+interval '1 day 20 minutes' WHERE id=$1", [appointment.id])
  const latestVersion = (await db.query('SELECT version FROM appointments WHERE id=$1', [appointment.id])).rows[0].version
  const tooEarly = await app.inject({ method: 'POST', url: `/api/v1/appointments/${appointment.id}/share-link`,
    payload: { version: latestVersion, ttlMinutes: 120 }, headers: staffHeaders })
  assert.equal(tooEarly.statusCode, 409)
  assert.equal(tooEarly.json().error.code, 'JOIN_LINK_TOO_EARLY')
})
