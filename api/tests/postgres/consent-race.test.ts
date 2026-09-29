import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { testDatabase } from '../database.ts'
import { migrate } from '../../src/migrate.ts'
import { runDeliveryCycle } from '../../src/delivery.ts'
import { seal } from '../../src/security.ts'
import type { Sql } from '../../src/db.ts'

test(
  'consent withdrawal and dispatch intent have a defined order across PostgreSQL connections',
  { timeout: 20000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'TEST_DATABASE_URL must point to a disposable PostgreSQL test cluster'
    )
    const db = await testDatabase()
    t.after(() => db.close())
    await migrate(db)
    const key = randomBytes(32).toString('base64')
    const patient = randomUUID(),
      staff = randomUUID(),
      intake = randomUUID(),
      verification = randomUUID()
    const data = {
      emailConsent: true,
      smsConsent: false,
      normalized: { email: 'synthetic@example.test' }
    }
    for (const [id, role] of [
      [patient, 'PATIENT'],
      [staff, 'STAFF']
    ])
      await db.query('INSERT INTO identities(id,issuer,subject,role) VALUES ($1,$2,$3,$4)', [
        id,
        'https://synthetic.test',
        id,
        role
      ])
    await db.query(
      "INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload) VALUES ($1,$2,'2026-09-initial',$3)",
      [intake, patient, seal(data, key, `intake:${intake}`)]
    )
    await db.query(
      "INSERT INTO contact_verifications(id,intake_id,channel,encrypted_destination,verified_by) VALUES ($1,$2,'EMAIL',$3,$4)",
      [verification, intake, seal(data.normalized.email, key, `contact:${verification}`), staff]
    )
    await db.query(
      "INSERT INTO outbox_events(event_type,resource_id,deduplication_key) VALUES ('intake.submitted',$1,$2)",
      [intake, randomUUID()]
    )
    let signalRead: () => void = () => {},
      resume: () => void = () => {},
      signalWithdrawal: () => void = () => {}
    const read = new Promise<void>((resolve) => {
      signalRead = resolve
    })
    const proceed = new Promise<void>((resolve) => {
      resume = resolve
    })
    const withdrawalStarted = new Promise<void>((resolve) => {
      signalWithdrawal = resolve
    })
    const gated = {
      ...db,
      transaction: <T>(run: (sql: Sql) => Promise<T>) =>
        db.transaction((sql) =>
          run({
            query: async (text, values) => {
              const result = await sql.query(text, values)
              if (text.startsWith('SELECT * FROM intakes WHERE patient_id=')) {
                signalRead()
                await proceed
              }
              return result
            }
          })
        )
    }
    let sends = 0,
      withdrawn = false
    const worker = runDeliveryCycle(gated, key, 'https://care.example.test', {
      available: () => true,
      send: async () => {
        sends += 1
        return { outcome: 'ACCEPTED', receipt: 'synthetic-receipt' }
      }
    })
    let withdrawal: Promise<void> | undefined
    try {
      await Promise.race([
        read,
        worker.then(() => {
          throw new Error('Dispatch completed before the ordering checkpoint')
        })
      ])
      const name = `consent-race-${randomUUID()}`
      withdrawal = db
        .transaction(async (sql) => {
          await sql.query("SELECT set_config('application_name',$1,true)", [name])
          signalWithdrawal()
          await sql.query('UPDATE intakes SET encrypted_payload=$1 WHERE id=$2', [
            seal({ ...data, emailConsent: false }, key, `intake:${intake}`),
            intake
          ])
          await sql.query(
            "INSERT INTO audit_events(actor_id,actor_role,action,resource_type,resource_id,request_id) VALUES ($1,'PATIENT','CONSENT_WITHDRAWAL_TEST','intake',$2,$3)",
            [patient, intake, randomUUID()]
          )
        })
        .then(() => {
          withdrawn = true
        })
      await Promise.race([
        withdrawalStarted,
        withdrawal.then(() => {
          throw new Error('Withdrawal completed before its checkpoint')
        })
      ])
      let waiting = false
      for (let attempt = 0; attempt < 100 && !withdrawn; attempt += 1) {
        waiting =
          (
            await db.query(
              "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
              [name]
            )
          ).rows.length > 0
        if (waiting) break
        await delay(20)
      }
      assert.equal(
        waiting,
        true,
        'Consent changes must wait until the already-authorized send intent commits'
      )
      resume()
      await Promise.all([worker, withdrawal])
      assert.equal(sends, 1)
      const events = (
        await db.query(
          "SELECT action FROM audit_events WHERE action IN ('DELIVERY_STARTED','CONSENT_WITHDRAWAL_TEST') ORDER BY id"
        )
      ).rows
      assert.deepEqual(
        events.map((row) => row.action),
        ['DELIVERY_STARTED', 'CONSENT_WITHDRAWAL_TEST']
      )
    } finally {
      resume()
      await Promise.allSettled([worker, ...(withdrawal ? [withdrawal] : [])])
    }
  }
)
