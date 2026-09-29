import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { migrate, migrationNames } from "../src/migrate.ts";
import { testDatabase } from "./database.ts";
import { hash, randomToken, seal } from "../src/security.ts";
import type { Role } from "../src/domain.ts";

test("service fails closed without backend configuration", async (t) => {
  const app = await buildApp(loadConfig({}), undefined, () => {});
  t.after(() => app.close());
  assert.equal((await app.inject("/api/health/live")).statusCode, 200);
  assert.equal((await app.inject("/api/health/ready")).statusCode, 503);
  assert.equal((await app.inject("/api/v1/session")).statusCode, 503);
  assert.deepEqual((await app.inject("/api/auth/status")).json(), {
    configured: false,
    intakeEnabled: false,
    provider: "local",
  });
  assert.equal((await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "http://localhost:5173" }, payload: { username: "nobody", password: "anything" } })).statusCode, 503);
  assert.throws(() =>
    loadConfig({ NODE_ENV: "production", APP_ORIGIN: "http://example.com" }),
  );
  assert.throws(() =>
    loadConfig({ NODE_ENV: "production", APP_ORIGIN: "https://example.com" }),
  );
  assert.throws(() =>
    loadConfig({
      NOTIFICATIONS_ENABLED: "true",
      APP_ORIGIN: "http://example.com",
    }),
  );
  assert.throws(() => loadConfig({ NODE_TLS_REJECT_UNAUTHORIZED: "0" }));
});

test("healthcare API authorization, persistence and transactions", async (t) => {
  const config = {
    ...loadConfig({}),
    origin: 'https://care.example.test',
    encryptionKey: randomBytes(32).toString("base64"),
    intakeEnabled: true,
  };
  const db = await testDatabase();
  t.after(() => db.close());
  await migrate(db);
  await migrate(db);
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'",
  );
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='AL'",
  );
  await t.test("readiness requires the latest migration", async () => {
    const health = await buildApp(config, db, () => {});
    try {
      assert.equal((await health.inject("/api/health/ready")).statusCode, 200);
      const migration = (await db.query(
        "DELETE FROM schema_migrations WHERE name=(SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1) RETURNING name,checksum,deferred_completed_at",
      )).rows[0];
      try {
        assert.equal((await health.inject("/api/health/ready")).statusCode, 503);
      } finally {
        await db.query(
          "INSERT INTO schema_migrations(name,checksum,deferred_completed_at) VALUES ($1,$2,$3)",
          [migration.name,migration.checksum,migration.deferred_completed_at]
        );
      }
    } finally {
      await health.close();
    }
  });
  await t.test("readiness rejects incomplete deferred migration work", async () => {
    const health = await buildApp(config, db, () => {});
    const latest = (await migrationNames()).at(-1)!;
    try {
      await db.query("UPDATE schema_migrations SET deferred_completed_at=NULL WHERE name=$1", [latest]);
      assert.equal((await health.inject("/api/health/ready")).statusCode, 503);
    } finally {
      await db.query("UPDATE schema_migrations SET deferred_completed_at=now() WHERE name=$1", [latest]);
      await health.close();
    }
  });
  const logs: Record<string, unknown>[] = [];
  const app = await buildApp(config, db, (entry) => logs.push(entry));
  t.after(() => app.close());
  async function actor(role: Role) {
    const id = randomUUID(),
      token = randomToken(),
      csrf = randomToken();
    await db.query(
      "INSERT INTO identities(id,issuer,subject,role) VALUES ($1,$2,$3,$4)",
      [id, "https://identity.test", id, role],
    );
    await db.query(
      "INSERT INTO sessions(token_hash,actor_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
      [hash(token), id, csrf],
    );
    return {
      id,
      token,
      csrf,
      headers: {
        cookie: `__Host-fadewell-session=${token}`,
        origin: config.origin,
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
    };
  }
  const patient = await actor("PATIENT"),
    other = await actor("PATIENT"),
    doctor = await actor("DOCTOR"),
    otherDoctor = await actor("DOCTOR"),
    staff = await actor("STAFF"),
    admin = await actor("ADMIN");
  const input = {
    version: 0,
    firstName: "SyntheticMira",
    lastName: "Test",
    email: "synthetic@example.test",
    phone: "+12025550138",
    state: "CA",
    reason: "SyntheticSensitiveReason",
    mode: "VIDEO",
    smsConsent: false,
    emailConsent: false,
    answers: {
      age_verified: "Yes",
      goals: "Discuss options",
      history: "None",
      medications: "None",
      allergies: "None",
    },
  };
  let intake: { id: string; version: number }, appointment: { id: string };

  await t.test(
    "all resource families require authentication and ignore forged roles",
    async () => {
      for (const path of [
        "/api/v1/session",
        "/api/v1/workspace",
        "/api/v1/intake",
        "/api/v1/questionnaire",
        `/api/v1/intakes/${randomUUID()}`,
        `/api/v1/consultations/${randomUUID()}`,
        `/api/v1/consultations/${randomUUID()}/events`,
        "/api/v1/admin/audit",
        "/api/v1/admin/users",
        "/api/v1/delivery",
      ]) {
        const response = await app.inject({
          url: path,
          headers: { "x-role": "ADMIN" },
        });
        assert.equal(response.statusCode, 401, path);
        assert.equal(response.headers["cache-control"], "no-store");
      }
      assert.equal(
        (
          await app.inject({
            url: "/api/v1/admin/users",
            headers: patient.headers,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            url: "/api/auth/callback?state=invalid&code=SECRET",
            headers: { cookie: "fadewell-login=other" },
          })
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "cross-origin, missing CSRF and unexpected input cannot write",
    async () => {
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: { ...patient.headers, origin: "https://attacker.test" },
            payload: input,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: { ...patient.headers, "x-csrf-token": "" },
            payload: input,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: patient.headers,
            payload: { ...input, role: "ADMIN" },
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: doctor.headers,
            payload: input,
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "autosave is durable, encrypted, audited and version checked",
    async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/intake",
        headers: patient.headers,
        payload: input,
      });
      assert.equal(response.statusCode, 200, response.body);
      intake = response.json();
      // Submit requires a compulsory ID document; file one for this intake.
      const docId = randomUUID();
      await db.query(
        `INSERT INTO id_documents(id, intake_id, patient_id, id_type, mime, size_bytes, sha256, encrypted_payload)
         SELECT $1, i.id, i.patient_id, 'DRIVERS_LICENSE', 'image/jpeg', 4, repeat('a', 64), $2
         FROM intakes i WHERE i.id=$3`,
        [docId, seal({ mime: 'image/jpeg', data: 'dGVzdA==' }, config.encryptionKey, `iddoc:${docId}`), intake.id]
      );
      const restored = await app.inject({
        url: "/api/v1/intake",
        headers: patient.headers,
      });
      assert.equal(restored.json().intake.data.firstName, input.firstName);
      assert.equal(restored.json().intake.data.state, input.state);
      assert.equal(
        (
          await db.query("SELECT encrypted_payload FROM intakes WHERE id=$1", [
            intake.id,
          ])
        ).rows[0].encrypted_payload.includes(input.reason),
        false,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: patient.headers,
            payload: input,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await db.query("SELECT * FROM intake_revisions WHERE intake_id=$1", [
            intake.id,
          ])
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    "lost save acknowledgements can be retried with a stable key without duplicate revisions",
    async () => {
      const request = {
        ...input,
        version: intake.version,
        requestKey: randomUUID(),
      };
      const save = () =>
        app.inject({
          method: "PUT",
          url: "/api/v1/intake",
          headers: patient.headers,
          payload: request,
        });
      const first = await save(),
        second = await save();
      assert.equal(first.statusCode, 200);
      assert.deepEqual(second.json(), first.json());
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: patient.headers,
            payload: { ...request, firstName: "Changed payload" },
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: patient.headers,
            payload: { ...request, state: "AL" },
          })
        ).statusCode,
        409,
        "a stable requestKey must reject a changed jurisdiction state",
      );
      intake = first.json();
      assert.equal(
        (
          await db.query("SELECT * FROM intake_revisions WHERE intake_id=$1", [
            intake.id,
          ])
        ).rows.length,
        2,
      );
    },
  );
  await t.test(
    "staff destination verification is revoked when the patient changes that address",
    async () => {
      const body = {
        version: intake.version,
        channel: "EMAIL",
        confirmedWithPatient: true,
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${intake.id}/verify-contact`,
            headers: patient.headers,
            payload: body,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${intake.id}/verify-contact`,
            headers: staff.headers,
            payload: body,
          })
        ).statusCode,
        200,
      );
      assert.deepEqual(
        (
          await app.inject({
            url: `/api/v1/intakes/${intake.id}`,
            headers: staff.headers,
          })
        ).json().verifiedChannels,
        ["EMAIL"],
      );
      const changed = await app.inject({
        method: "PUT",
        url: "/api/v1/intake",
        headers: patient.headers,
        payload: {
          ...input,
          version: intake.version,
          email: "different@example.test",
        },
      });
      assert.equal(changed.statusCode, 200);
      assert.deepEqual(
        (
          await app.inject({
            url: `/api/v1/intakes/${intake.id}`,
            headers: staff.headers,
          })
        ).json().verifiedChannels,
        [],
      );
      intake = (
        await app.inject({
          method: "PUT",
          url: "/api/v1/intake",
          headers: patient.headers,
          payload: { ...input, version: changed.json().version },
        })
      ).json();
    },
  );
  await t.test(
    "patient and unassigned doctor cannot read a different record",
    async () => {
      for (const user of [other, doctor])
        assert.equal(
          (
            await app.inject({
              url: `/api/v1/intakes/${intake.id}`,
              headers: user.headers,
            })
          ).statusCode,
          404,
        );
      assert.equal(
        (
          await app.inject({ url: "/api/v1/workspace", headers: other.headers })
        ).json().intakes.length,
        0,
      );
      const administrative = (
        await app.inject({
          url: `/api/v1/intakes/${intake.id}`,
          headers: staff.headers,
        })
      ).json();
      assert.deepEqual(administrative.data.answers, {});
      assert.equal(administrative.data.reason, "");
    },
  );
  await t.test(
    "submission is replay safe and verified only by staff",
    async () => {
      const send = () =>
        app.inject({
          method: "POST",
          url: "/api/v1/intake/submit",
          headers: patient.headers,
          payload: { version: intake.version },
        });
      const submitted = await send();
      assert.equal(submitted.json().state, "REVIEW_PENDING");
      assert.deepEqual((await send()).json(), submitted.json());
      assert.equal(
        (
          await db.query(
            "SELECT * FROM outbox_events WHERE resource_id=$1 AND event_type='intake.submitted'",
            [intake.id],
          )
        ).rows.length,
        1,
      );
      const review = {
        version: submitted.json().version,
        action: "verify",
        note: "Administrative verification completed.",
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${intake.id}/review`,
            headers: patient.headers,
            payload: review,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${intake.id}/review`,
            headers: staff.headers,
            payload: review,
          })
        ).json().state,
        "VERIFIED",
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: "/api/v1/intake",
            headers: patient.headers,
            payload: { ...input, version: 4 },
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "availability rejects invalid zones and patient writes",
    async () => {
      const values = {
        startsAt: new Date(Date.now() + 60000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        timezone: "America/New_York",
        bufferMinutes: 5,
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/availability",
            headers: patient.headers,
            payload: values,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/availability",
            headers: doctor.headers,
            payload: { ...values, timezone: "invalid" },
          })
        ).statusCode,
        400,
      );
      const slot = await app.inject({
        method: "POST",
        url: "/api/v1/availability",
        headers: doctor.headers,
        payload: values,
      });
      assert.equal(slot.statusCode, 200, slot.body);
      const booking = {
        requestKey: randomUUID(),
        intakeId: intake.id,
        availabilityId: slot.json().id,
        startsAt: values.startsAt,
        durationMinutes: 15,
        mode: "VIDEO",
      };
      await db.query("UPDATE jurisdictions SET notice_period_hours=2 WHERE code='CA'");
      const tooSoon = await app.inject({ method: 'POST', url: '/api/v1/appointments', headers: staff.headers, payload: booking });
      assert.equal(tooSoon.statusCode, 422, tooSoon.body);
      await db.query("UPDATE jurisdictions SET notice_period_hours=0, allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='CA'");
      const wrongMode = await app.inject({ method: 'POST', url: '/api/v1/appointments', headers: staff.headers,
        payload: { ...booking, mode: 'PHONE' } });
      assert.equal(wrongMode.statusCode, 422, wrongMode.body);
      await db.query("UPDATE jurisdictions SET allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'");
      const wrongPreference = await app.inject({ method: 'POST', url: '/api/v1/appointments', headers: staff.headers,
        payload: { ...booking, mode: 'PHONE' } });
      assert.equal(wrongPreference.statusCode, 422, wrongPreference.body);
      assert.equal(wrongPreference.json().error.code, 'VISIT_TYPE_NOT_PREFERRED');
      const booked = await app.inject({
        method: "POST",
        url: "/api/v1/appointments",
        headers: staff.headers,
        payload: booking,
      });
      assert.equal(booked.statusCode, 200, booked.body);
      appointment = booked.json();
      assert.deepEqual(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/appointments",
            headers: staff.headers,
            payload: booking,
          })
        ).json(),
        appointment,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/appointments",
            headers: staff.headers,
            payload: { ...booking, mode: "PHONE" },
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/v1/intakes/${intake.id}`,
            headers: doctor.headers,
          })
        ).json().data.reason,
        input.reason,
      );
    },
  );
  await t.test(
    "database rejects overlapping doctor windows including buffers",
    async () => {
      const original = (
        await db.query("SELECT * FROM appointments WHERE id=$1", [
          appointment.id,
        ])
      ).rows[0];
      const insert = (starts: Date, patientId: string) =>
        db.query(
          `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'UTC','VIDEO',$8,$9)`,
          [
            intake.id,
            patientId,
            doctor.id,
            original.availability_id,
            starts,
            new Date(starts.getTime() + 600000),
            new Date(starts.getTime() + 900000),
            staff.id,
            randomUUID(),
          ],
        );
      // Separate intake avoids the one-active-intake constraint masking range exclusion.
      const second = await app.inject({
        method: "PUT",
        url: "/api/v1/intake",
        headers: other.headers,
        payload: input,
      });
      const secondId = second.json().id;
      await assert.rejects(
        db.query(
          `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'UTC','VIDEO',$8,$9)`,
          [
            secondId,
            other.id,
            doctor.id,
            original.availability_id,
            original.ends_at,
            new Date(Date.parse(original.ends_at) + 600000),
            new Date(Date.parse(original.ends_at) + 900000),
            staff.id,
            randomUUID(),
          ],
        ),
        (error: any) => error.code === "23P01",
      );
      await assert.rejects(insert(new Date(original.starts_at), other.id));
    },
  );
  await t.test(
    "concurrent reservations for distinct patients cannot occupy the same doctor interval",
    async () => {
      const ids = [randomUUID(), randomUUID()];
      const patients = [await actor("PATIENT"), await actor("PATIENT")];
      for (let index = 0; index < 2; index += 1) {
        await db.query(
          "INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,state,state_code) VALUES ($1,$2,'2026-09-initial',$3,'VERIFIED','CA')",
          [
            ids[index],
            patients[index].id,
            seal(input, config.encryptionKey, `intake:${ids[index]}`),
          ],
        );
      }
      const start = new Date(Date.now() + 86400000);
      const end = new Date(start.getTime() + 900000);
      const reserved = new Date(end.getTime() + 300000);
      const slotId = randomUUID();
      await db.query(
        "INSERT INTO availability(id,doctor_id,starts_at,ends_at,timezone) VALUES ($1,$2,$3,$4,'UTC')",
        [slotId, doctor.id, start, reserved],
      );
      const outcomes = await Promise.allSettled(
        ids.map((id, index) =>
          db.transaction((sql) =>
            sql.query(
              `INSERT INTO appointments(intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'UTC','VIDEO',$8,$9)`,
              [
                id,
                patients[index].id,
                doctor.id,
                slotId,
                start,
                end,
                reserved,
                staff.id,
                randomUUID(),
              ],
            ),
          ),
        ),
      );
      assert.equal(
        outcomes.filter((item) => item.status === "fulfilled").length,
        1,
      );
      const failed = outcomes.find(
        (item) => item.status === "rejected",
      ) as PromiseRejectedResult;
      assert.equal(failed.reason.code, "23P01");
      const booked = (
        await db.query("SELECT id FROM appointments WHERE availability_id=$1", [
          slotId,
        ])
      ).rows[0];
      await db.query("INSERT INTO consultations(id,duration) VALUES ($1,900)", [
        booked.id,
      ]);
      const cancelled = await app.inject({
        method: "POST",
        url: `/api/v1/appointments/${booked.id}/cancel`,
        headers: staff.headers,
        payload: { version: 1 },
      });
      assert.equal(cancelled.statusCode, 200);
      assert.equal(cancelled.json().status, "CANCELLED");
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/consultations/${booked.id}/timer`,
            headers: doctor.headers,
            payload: { version: 1, action: "start" },
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "notes are persisted encrypted and unresolved discrepancies cannot be verified",
    async () => {
      const noted = await app.inject({
        method: "POST",
        url: `/api/v1/intakes/${intake.id}/notes`,
        headers: staff.headers,
        payload: {
          kind: "CONTACT",
          text: "Synthetic confidential contact attempt.",
        },
      });
      assert.equal(noted.statusCode, 200);
      const note = (
        await db.query("SELECT encrypted_payload FROM notes WHERE id=$1", [
          noted.json().id,
        ])
      ).rows[0];
      assert.equal(note.encrypted_payload.includes("confidential"), false);
      const current = (
        await app.inject({ url: "/api/v1/intake", headers: other.headers })
      ).json().intake;
      const changed = await app.inject({
        method: "PUT",
        url: "/api/v1/intake",
        headers: other.headers,
        payload: { ...input, version: current.version, email: "malformed" },
      });
      const otherDocId = randomUUID();
      await db.query(
        `INSERT INTO id_documents(id, intake_id, patient_id, id_type, mime, size_bytes, sha256, encrypted_payload)
         SELECT $1, i.id, i.patient_id, 'DRIVERS_LICENSE', 'image/jpeg', 4, repeat('a', 64), $2
         FROM intakes i WHERE i.id=$3`,
        [otherDocId, seal({ mime: 'image/jpeg', data: 'dGVzdA==' }, config.encryptionKey, `iddoc:${otherDocId}`), current.id]
      );
      const submitted = await app.inject({
        method: "POST",
        url: "/api/v1/intake/submit",
        headers: other.headers,
        payload: { version: changed.json().version },
      });
      assert.equal(submitted.json().state, "NEEDS_CORRECTION");
      const body = {
        version: submitted.json().version,
        action: "verify",
        note: "Cannot verify invalid contact information.",
      };
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${current.id}/review`,
            headers: staff.headers,
            payload: body,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/intakes/${current.id}/review`,
            headers: staff.headers,
            payload: { ...body, action: "request_correction" },
          })
        ).statusCode,
        200,
      );
    },
  );
  await t.test(
    "only assigned doctor controls authoritative timer and start window",
    async () => {
      const timer = (
        await app.inject({
          url: `/api/v1/consultations/${appointment.id}`,
          headers: patient.headers,
        })
      ).json();
      for (const user of [patient, staff, admin, otherDoctor]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/consultations/${appointment.id}/timer`,
          headers: user.headers,
          payload: { version: timer.version, action: "start" },
        });
        assert.ok([403, 404].includes(response.statusCode));
      }
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/consultations/${appointment.id}/timer`,
        headers: doctor.headers,
        payload: { version: timer.version, action: "start" },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().status, "ACTIVE");
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/consultations/${appointment.id}/timer`,
            headers: doctor.headers,
            payload: { version: timer.version, action: "pause" },
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/v1/consultations/${appointment.id}`,
            headers: other.headers,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/v1/consultations/${appointment.id}`,
            headers: patient.headers,
          })
        ).json().version,
        timer.version + 1,
      );
    },
  );
  await t.test(
    "live stream is resource scoped and closes when its session is revoked",
    async () => {
      assert.equal(
        (
          await app.inject({
            url: `/api/v1/consultations/${appointment.id}/events`,
            headers: other.headers,
          })
        ).statusCode,
        404,
      );
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const before = (
        await db.query(
          "SELECT last_seen_at FROM sessions WHERE token_hash=$1",
          [hash(patient.token)],
        )
      ).rows[0];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(
          `${address}/api/v1/consultations/${appointment.id}/events`,
          {
            headers: { cookie: patient.headers.cookie },
            signal: controller.signal,
          },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        const reader = response.body!.getReader();
        const initial = new TextDecoder().decode((await reader.read()).value);
        assert.match(initial, /event: snapshot/);
        const after = (
          await db.query(
            "SELECT last_seen_at FROM sessions WHERE token_hash=$1",
            [hash(patient.token)],
          )
        ).rows[0];
        assert.equal(
          new Date(before.last_seen_at).getTime(),
          new Date(after.last_seen_at).getTime(),
          "Passive streaming must not renew idle sessions",
        );
        await db.query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(patient.token),
        ]);
        let ended = "";
        const endDecoder = new TextDecoder();
        for (;;) {
          const next = await reader.read();
          if (next.value) ended += endDecoder.decode(next.value, { stream: true });
          if (ended.includes("event: access-ended") || next.done) break;
        }
        assert.match(ended, /event: access-ended/);
        assert.match(ended, /SESSION_EXPIRED/);
        await reader.cancel();
      } finally {
        clearTimeout(timeout);
        controller.abort();
        await db.query(
          "INSERT INTO sessions(token_hash,actor_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')",
          [hash(patient.token), patient.id, patient.csrf],
        );
      }
    },
  );
  await t.test(
    "doctor timer commands complete the appointment only on explicit end",
    async () => {
      let timer = (
        await app.inject({
          url: `/api/v1/consultations/${appointment.id}`,
          headers: doctor.headers,
        })
      ).json();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/v1/appointments/${appointment.id}/cancel`,
            headers: staff.headers,
            payload: { version: 1 },
          })
        ).statusCode,
        409,
      );
      for (const [action, seconds] of [
        ["pause", 0],
        ["resume", 0],
        ["extend", 300],
        ["set", 1200],
        ["end", 0],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/consultations/${appointment.id}/timer`,
          headers: doctor.headers,
          payload: { version: timer.version, action, seconds },
        });
        assert.equal(response.statusCode, 200, response.body);
        timer = response.json();
      }
      assert.equal(timer.status, "ENDED");
      assert.equal(timer.appointmentStatus, "COMPLETED");
      assert.equal(
        (await db.query("SELECT state FROM intakes WHERE id=$1", [intake.id]))
          .rows[0].state,
        "COMPLETED",
      );
    },
  );
  await t.test(
    "patients can withdraw notification consent after an encounter has completed",
    async () => {
      const current = (
        await app.inject({
          url: "/api/v1/preferences",
          headers: patient.headers,
        })
      ).json().preferences;
      const enabled = await app.inject({
        method: "PATCH",
        url: "/api/v1/preferences",
        headers: patient.headers,
        payload: {
          version: current.version,
          emailConsent: true,
          smsConsent: true,
        },
      });
      assert.equal(enabled.statusCode, 200);
      const withdrawn = await app.inject({
        method: "PATCH",
        url: "/api/v1/preferences",
        headers: patient.headers,
        payload: {
          version: enabled.json().version,
          emailConsent: false,
          smsConsent: false,
        },
      });
      assert.equal(withdrawn.statusCode, 200);
      const restored = (
        await app.inject({
          url: "/api/v1/preferences",
          headers: patient.headers,
        })
      ).json().preferences;
      assert.equal(restored.emailConsent, false);
      assert.equal(restored.smsConsent, false);
      assert.equal(
        (await db.query("SELECT state FROM intakes WHERE id=$1", [intake.id]))
          .rows[0].state,
        "COMPLETED",
      );
      assert.equal(
        (
          await app.inject({
            method: "PATCH",
            url: "/api/v1/preferences",
            headers: staff.headers,
            payload: restored,
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "history is append-only and sensitive reads have audit events",
    async () => {
      for (const table of [
        "audit_events",
        "intake_revisions",
        "notes",
        "questionnaires",
      ]) {
        await assert.rejects(
          db.query(`DELETE FROM ${table}`),
          (error: any) => error.code === "42501",
        );
        await assert.rejects(db.query(`TRUNCATE ${table}`));
      }
      const response = await app.inject({
        url: "/api/v1/admin/audit",
        headers: admin.headers,
      });
      assert.equal(response.statusCode, 200);
      assert.ok(
        response
          .json()
          .events.some((entry: any) => entry.action === "PATIENT_VIEWED"),
      );
      assert.ok(
        response
          .json()
          .events.some((entry: any) => entry.action === "AUDIT_VIEWED"),
      );
      assert.equal(
        (
          await app.inject({
            url: "/api/v1/admin/users",
            headers: admin.headers,
          })
        ).statusCode,
        200,
      );
      const delivery = await app.inject({
        url: "/api/v1/delivery",
        headers: admin.headers,
      });
      assert.equal(delivery.json().deliveryEnabled, false);
      assert.ok(delivery.json().events.length > 0);
    },
  );
  await t.test(
    "audit write failure rolls back the medical record change and returns no sensitive error",
    async () => {
      await db.query(
        "CREATE FUNCTION fail_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic secret database error'; END; $$; CREATE TRIGGER fail_audit_test BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_audit_test()",
      );
      try {
        const response = await app.inject({
          method: "POST",
          url: `/api/v1/intakes/${intake.id}/notes`,
          headers: staff.headers,
          payload: { kind: "INTERNAL", text: "Must roll back" },
        });
        assert.equal(response.statusCode, 503);
        assert.equal(response.body.includes("secret"), false);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS total FROM notes WHERE intake_id=$1",
              [intake.id],
            )
          ).rows[0].total,
          2,
        );
      } finally {
        await db.query(
          "DROP TRIGGER fail_audit_test ON audit_events; DROP FUNCTION fail_audit_test()",
        );
      }
    },
  );
  await t.test(
    "runtime database role cannot change role assignments or rewrite protected history",
    async () => {
      await db.query(
        await readFile(
          new URL("../deploy/runtime-grants.sql", import.meta.url),
          "utf8",
        ),
      );
      await assert.rejects(
        db.transaction(async (sql) => {
          await sql.query("SET LOCAL ROLE mca_runtime");
          await sql.query("UPDATE identities SET role='ADMIN' WHERE id=$1", [
            patient.id,
          ]);
        }),
        (error: any) => error.code === "42501",
      );
      await assert.rejects(
        db.transaction(async (sql) => {
          await sql.query("SET LOCAL ROLE mca_runtime");
          await sql.query("DELETE FROM audit_events");
        }),
        (error: any) => error.code === "42501",
      );
      await db.transaction(async (sql) => {
        await sql.query("SET LOCAL ROLE mca_runtime");
        await sql.query("SELECT * FROM questionnaires");
        await sql.query("UPDATE identities SET enabled=true WHERE id=$1", [
          patient.id,
        ]);
      });
    },
  );
  await t.test(
    "disabling user revokes sessions and logout invalidates session",
    async () => {
      assert.equal(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/v1/admin/users/${admin.id}`,
            headers: admin.headers,
            payload: { enabled: false },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "PATCH",
            url: `/api/v1/admin/users/${otherDoctor.id}`,
            headers: admin.headers,
            payload: { enabled: false },
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            url: "/api/v1/session",
            headers: otherDoctor.headers,
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/logout",
            headers: other.headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ url: "/api/v1/session", headers: other.headers }))
          .statusCode,
        401,
      );
      await db.query(
        "UPDATE sessions SET last_seen_at=now()-interval '16 minutes' WHERE actor_id=$1",
        [patient.id],
      );
      assert.equal(
        (await app.inject({ url: "/api/v1/session", headers: patient.headers }))
          .statusCode,
        401,
      );
    },
  );
  await t.test(
    "concurrent administrators cannot revoke the last active administrator",
    async () => {
      const secondAdmin = await actor("ADMIN");
      let count = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const guardedDb = {
        ...db,
        async query(text: string, values?: unknown[]) {
          const result = await db.query(text, values);
          if (text.includes("UPDATE sessions s SET")) {
            if (++count === 2) release();
            await gate;
          }
          return result;
        },
      };
      const concurrent = await buildApp(config, guardedDb, () => {});
      try {
        const results = await Promise.all([
          concurrent.inject({
            method: "PATCH",
            url: `/api/v1/admin/users/${secondAdmin.id}`,
            headers: admin.headers,
            payload: { enabled: false },
          }),
          concurrent.inject({
            method: "PATCH",
            url: `/api/v1/admin/users/${admin.id}`,
            headers: secondAdmin.headers,
            payload: { enabled: false },
          }),
        ]);
        assert.deepEqual(
          results.map((result) => result.statusCode).sort(),
          [200, 403],
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM identities WHERE role='ADMIN' AND enabled=true",
            )
          ).rows[0].n,
          1,
        );
      } finally {
        await concurrent.close();
      }
    },
  );
  await t.test(
    "logs never contain submitted content, tokens or callback query strings",
    async () => {
      const text = JSON.stringify(logs);
      for (const value of [
        input.firstName,
        input.reason,
        input.email,
        patient.token,
        patient.csrf,
        "SECRET",
        "?state=",
      ])
        assert.equal(text.includes(value), false, value);
      assert.ok(logs.every((entry) => typeof entry.requestId === "string"));
    },
  );
});
