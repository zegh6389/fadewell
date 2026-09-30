import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { migrate } from "../src/migrate.ts";
import { testDatabase, testConfig } from "./database.ts";
import { seal } from "../src/security.ts";

test("guest intake needs no account, retains its session and cannot access another patient or staff", async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  await migrate(db);
  await db.query(
    "UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO','PHONE']::text[] WHERE code='CA'",
  );
  const config = testConfig();
  const app = await buildApp(config, db, () => {});
  t.after(() => app.close());
  const headers = { origin: config.origin, "content-type": "application/json" };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/guest",
        payload: {},
        headers: { ...headers, origin: "https://attacker.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/guest",
        payload: { role: "ADMIN" },
        headers,
      })
    ).statusCode,
    403,
  );
  const start = await app.inject({
    method: "POST",
    url: "/api/auth/guest",
    payload: {},
    headers,
  });
  assert.equal(start.statusCode, 200, start.body);
  const cookie = start.cookies.find((c) => c.name === "__Host-mmjgreen-session")!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  const sessionHeaders = {
    ...headers,
    cookie: `${cookie.name}=${cookie.value}`,
  };
  const session = (
    await app.inject({ url: "/api/v1/session", headers: sessionHeaders })
  ).json();
  assert.equal(session.role, "PATIENT");
  const repeated = await app.inject({
    method: "POST",
    url: "/api/auth/guest",
    payload: {},
    headers: sessionHeaders,
  });
  assert.equal(repeated.cookies.length, 0);
  assert.equal((await db.query("SELECT * FROM identities")).rows.length, 1);
  const body = {
    firstName: "Synthetic",
    lastName: "Test",
    email: "synthetic@example.test",
    phone: "+12025550123",
    state: "CA",
    reason: "Synthetic test only",
    mode: "PHONE",
    smsConsent: false,
    emailConsent: false,
    answers: {
      age_verified: "Yes",
      goals: "Discuss options",
      history: "None",
      medications: "None",
      allergies: "None",
    },
    version: 0,
  };
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/api/v1/intake",
        payload: body,
        headers: sessionHeaders,
      })
    ).statusCode,
    403,
  );
  const { age_verified: _ageVerified, ...answersWithoutAge } = body.answers;
  const withoutAge = { ...body, answers: answersWithoutAge };
  const missingAge = await app.inject({
    method: "PUT",
    url: "/api/v1/intake",
    payload: withoutAge,
    headers: { ...sessionHeaders, "x-csrf-token": session.csrf },
  });
  assert.equal(missingAge.statusCode, 200, missingAge.body);
  const missingAgeIntake = (
    await app.inject({ url: "/api/v1/intake", headers: sessionHeaders })
  ).json().intake;
  assert.ok(missingAgeIntake.issues.includes("AGE_VERIFICATION_REQUIRED"));
  const saved = await app.inject({
    method: "PUT",
    url: "/api/v1/intake",
    payload: { ...body, version: missingAge.json().version },
    headers: { ...sessionHeaders, "x-csrf-token": session.csrf },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  // Submit requires the compulsory ID document.
  const guestDocId = randomUUID();
  await db.query(
    `INSERT INTO id_documents(id, intake_id, patient_id, id_type, mime, size_bytes, sha256, encrypted_payload)
     SELECT $1, i.id, i.patient_id, 'DRIVERS_LICENSE', 'image/jpeg', 4, repeat('a', 64), $2
     FROM intakes i WHERE i.id=$3`,
    [guestDocId, seal({ mime: 'image/jpeg', data: 'dGVzdA==' }, config.encryptionKey, `iddoc:${guestDocId}`), saved.json().id]
  );
  const submitted = await app.inject({
    method: "POST",
    url: "/api/v1/intake/submit",
    payload: { version: saved.json().version },
    headers: { ...sessionHeaders, "x-csrf-token": session.csrf },
  });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().state, "REVIEW_PENDING");
  assert.equal(
    (
      await app.inject({ url: "/api/v1/intake", headers: sessionHeaders })
    ).json().intake.id,
    saved.json().id,
  );
  const other = await app.inject({
    method: "POST",
    url: "/api/auth/guest",
    payload: {},
    headers,
  });
  const otherCookie = other.cookies.find(
    (c) => c.name === "__Host-mmjgreen-session",
  )!;
  assert.equal(
    (
      await app.inject({
        url: "/api/v1/intake",
        headers: { cookie: `${otherCookie.name}=${otherCookie.value}` },
      })
    ).json().intake,
    null,
  );
  assert.equal(
    (await app.inject({ url: "/api/v1/admin/users", headers: sessionHeaders }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM outbox_events WHERE event_type='intake.submitted'",
      )
    ).rows.length,
    1,
  );
  const disabled = await buildApp(
    { ...config, intakeEnabled: false },
    db,
    () => {},
  );
  t.after(() => disabled.close());
  assert.equal(
    (
      await disabled.inject({
        method: "POST",
        url: "/api/auth/guest",
        payload: {},
        headers,
      })
    ).statusCode,
    503,
  );
});
