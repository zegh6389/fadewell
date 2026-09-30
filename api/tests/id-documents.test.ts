import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { testDatabase } from './database.ts'
import { hash, randomToken } from '../src/security.ts'
import type { Role } from '../src/domain.ts'

function imageBytes(kind: 'jpeg' | 'png' | 'gif', size = 128) {
  const magic =
    kind === 'jpeg'
      ? [0xff, 0xd8, 0xff, 0xe0]
      : kind === 'png'
        ? [0x89, 0x50, 0x4e, 0x47]
        : [0x47, 0x49, 0x46, 0x38]
  const bytes = Buffer.alloc(Math.max(size, magic.length + 2))
  Buffer.from(magic).copy(bytes)
  bytes[bytes.length - 2] = kind === 'jpeg' ? 0xff : 0x00
  bytes[bytes.length - 1] = kind === 'jpeg' ? 0xd9 : 0x00
  return bytes.toString('base64')
}

async function setupApp(t: test.TestContext) {
  const config = {
    ...loadConfig({}),
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString('base64'),
    intakeEnabled: true
  }
  const db = await testDatabase()
  t.after(() => db.close())
  await migrate(db)
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'"
  )
  const logs: Record<string, unknown>[] = []
  const app = await buildApp(config, db, () => logs.push)
  t.after(() => app.close())
  async function actor(role: Role) {
    const id = randomUUID(),
      token = randomToken(),
      csrf = randomToken()
    await db.query('INSERT INTO identities(id, issuer, subject, role) VALUES ($1, $2, $3, $4)', [
      id,
      'https://identity.test',
      id,
      role
    ])
    await db.query(
      'INSERT INTO sessions(token_hash, actor_id, csrf, expires_at) VALUES ($1, $2, $3, now() + interval \'1 hour\')',
      [hash(token), id, csrf]
    )
    return {
      id,
      headers: {
        cookie: `__Host-mmjgreen-session=${token}`,
        origin: config.origin,
        'content-type': 'application/json',
        'x-csrf-token': csrf
      }
    }
  }
  const patient = await actor('PATIENT')
  const staff = await actor('STAFF')
  const draft = await app.inject({
    method: 'PUT',
    url: '/api/v1/intake',
    headers: patient.headers,
    payload: {
      version: 0,
      firstName: 'Synthetic',
      lastName: 'Patient',
      email: 'synthetic@example.test',
      phone: '+12025550138',
      state: 'CA',
      reason: 'First medical card evaluation',
      mode: 'VIDEO',
      smsConsent: false,
      emailConsent: false,
      answers: {}
    }
  })
  assert.equal(draft.statusCode, 200, draft.body)
  return { app, db, patient, staff, actor, intakeId: draft.json().id }
}

test('POST /api/v1/intake/submit refuses intakes without an ID document', async (t) => {
  const { app, patient } = await setupApp(t)
  const refused = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/submit',
    headers: patient.headers,
    payload: { version: 1 }
  })
  assert.equal(refused.statusCode, 409, refused.body)
  assert.equal(refused.json().error?.code, 'ID_DOCUMENT_REQUIRED')
})

test('POST /api/v1/intake/id-document stores an ID and re-upload replaces it', async (t) => {
  const { app, db, patient, intakeId } = await setupApp(t)
  const first = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: patient.headers,
    payload: { idType: 'DRIVERS_LICENSE', mime: 'image/jpeg', data: imageBytes('jpeg') }
  })
  assert.equal(first.statusCode, 200, first.body)
  assert.equal(first.json().idType, 'DRIVERS_LICENSE')
  const second = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: patient.headers,
    payload: { idType: 'STATE_ID', mime: 'image/png', data: imageBytes('png') }
  })
  assert.equal(second.statusCode, 200, second.body)
  const current = await app.inject({ url: '/api/v1/intake', headers: patient.headers })
  assert.equal(current.json().intake.idDocument?.idType, 'STATE_ID')
  const documents = (await db.query('SELECT id FROM id_documents WHERE intake_id=$1', [intakeId])).rows
  assert.equal(documents.length, 1)
})

test('POST /api/v1/intake/id-document rejects non-image bytes and oversize uploads', async (t) => {
  const { app, patient } = await setupApp(t)
  const fake = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: patient.headers,
    payload: { idType: 'DRIVERS_LICENSE', mime: 'image/jpeg', data: imageBytes('gif') }
  })
  assert.equal(fake.statusCode, 400, fake.body)
  assert.equal(fake.json().error?.code, 'INVALID_ID_DOCUMENT')
  const huge = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: patient.headers,
    payload: { idType: 'DRIVERS_LICENSE', mime: 'image/jpeg', data: imageBytes('jpeg', 2097153) }
  })
  assert.equal(huge.statusCode, 400, huge.body)
})

test('ID image bytes go to clinicians and the patient, metadata only to staff', async (t) => {
  const { app, db, patient, staff, actor, intakeId } = await setupApp(t)
  await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: patient.headers,
    payload: { idType: 'PASSPORT', mime: 'image/jpeg', data: imageBytes('jpeg') }
  })
  const unauth = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/id-document',
    headers: { origin: 'https://care.example.test', 'content-type': 'application/json' },
    payload: { idType: 'PASSPORT', mime: 'image/jpeg', data: imageBytes('jpeg') }
  })
  assert.equal(unauth.statusCode, 401, unauth.body)
  const own = await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: patient.headers })
  assert.ok(own.json().idDocument?.image?.data, own.body)
  const doctor = await actor('DOCTOR')
  const availabilityId = randomUUID()
  const startsAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  await db.query(
    "INSERT INTO availability(id,doctor_id,starts_at,ends_at,timezone) VALUES ($1,$2,$3,$4,'UTC')",
    [availabilityId, doctor.id, startsAt, endsAt]
  )
  await db.query(
    `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,
       reserved_until,timezone,mode,created_by,request_key)
     VALUES ($1,$2,$3,$4,$5,$6,$6,'UTC','VIDEO',$3,$7)`,
    [intakeId, patient.id, doctor.id, availabilityId, startsAt, endsAt, randomUUID()]
  )
  const clinical = await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: doctor.headers })
  assert.ok(clinical.json().idDocument?.image?.data, clinical.body)
  const otherPatient = await actor('PATIENT')
  const denied = await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: otherPatient.headers })
  assert.equal(denied.statusCode, 404, denied.body)
  const review = await app.inject({ url: `/api/v1/intakes/${intakeId}`, headers: staff.headers })
  assert.equal(review.json().idDocument?.idType, 'PASSPORT')
  assert.equal(review.json().idDocument?.image, undefined)
})
