import { randomBytes } from 'node:crypto'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { migrate } from '../src/migrate.ts'
import { hash, randomToken, seal } from '../src/security.ts'
import { browserActors } from './browser-fixtures.ts'
import { testDatabase } from './database.ts'

if (
  process.env.NODE_ENV === 'production' ||
  process.env.DATABASE_URL ||
  process.env.TEST_DATABASE_URL
)
  throw new Error('Browser fixtures require an isolated in-memory test database')
const db = await testDatabase()
const encryptionKey = randomBytes(32).toString('base64')
await migrate(db)
// E2E needs at least one jurisdiction that will accept a patient intake.
// Migration 017 fail-closes every placeholder row; mark California AVAILABLE so the
// patient save flow has a real option to pick. Production seeds stay governed by
// their regulator-reviewed migration; this override lives only in the test harness.
await db.query(
  "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[], notice_period_hours=0 WHERE code='CA'"
)
for (const actor of Object.values(browserActors)) {
  await db.query('INSERT INTO identities(id,issuer,subject,role) VALUES ($1,$2,$3,$4)', [
    actor.id,
    'https://synthetic.test',
    actor.id,
    actor.role
  ])
  await db.query(
    "INSERT INTO sessions(token_hash,actor_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
    [hash(actor.token), actor.id, randomToken()]
  )
}
const deliveryIntake = '20000000-0000-4000-8000-000000000006'
const deliveryEvent = '30000000-0000-4000-8000-000000000006'
await db.query(
  "INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,state,state_code) VALUES ($1,$2,'2026-09-initial',$3,'REVIEW_PENDING','CA')",
  [
    deliveryIntake,
    browserActors.deliveryPatient.id,
    seal(
      {
        firstName: 'SyntheticDelivery',
        lastName: 'Test',
        email: 'delivery@example.test',
        phone: '+12025550188',
        reason: 'Synthetic privately held reason',
        mode: 'VIDEO',
        emailConsent: true,
        smsConsent: false,
        answers: { goals: 'Discuss care', history: 'None', medications: 'None', allergies: 'None' },
        normalized: { email: 'delivery@example.test', phone: '+12025550188' }
      },
      encryptionKey,
      `intake:${deliveryIntake}`
    )
  ]
)
await db.query(
  "INSERT INTO outbox_events(id,event_type,resource_id,deduplication_key,status) VALUES ($1,'intake.submitted',$2,'browser-delivery-fixture','PROCESSED')",
  [deliveryEvent, deliveryIntake]
)
await db.query(
  "INSERT INTO notifications(event_id,intake_id,channel,status) VALUES ($1,$2,'EMAIL','BLOCKED')",
  [deliveryEvent, deliveryIntake]
)
const app = await buildApp(
  {
    // The origin must match the origin the browser actually uses, or the
    // service rejects every mutating request as cross-origin (403). The web
    // test suite serves the bundle with `vite preview` on 4173, so it sets
    // APP_ORIGIN to match; local dev keeps the Vite default.
    ...loadConfig({ APP_ORIGIN: process.env.APP_ORIGIN || 'http://127.0.0.1:5173' }),
    encryptionKey,
    intakeEnabled: true
  },
  db,
  () => {},
  undefined,
  10000 // ponytail: synthetic browser suite shares one IP; production keeps its 120/min default.
)
await app.listen({ host: '127.0.0.1', port: 3001 })
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, async () => {
    await app.close()
    await db.close()
    process.exit(0)
  })
