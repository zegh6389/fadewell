import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { migrate } from "../src/migrate.ts";
import { hash, randomToken } from "../src/security.ts";
import { testDatabase } from "./database.ts";
import type { Role } from "../src/domain.ts";

test("doctors can delete their own availability windows, blocked when booked or foreign", async (t) => {
  const config = {
    ...loadConfig({}),
    origin: "https://care.example.test",
    encryptionKey: randomBytes(32).toString("base64"),
    intakeEnabled: true,
  };
  const db = await testDatabase();
  t.after(() => db.close());
  await migrate(db);
  const app = await buildApp(config, db, () => {});
  t.after(() => app.close());
  async function actor(role: Role) {
    const id = randomUUID(),
      token = randomToken(),
      csrf = randomToken();
    await db.query("INSERT INTO identities(id,issuer,subject,role) VALUES ($1,$2,$3,$4)", [id, "https://identity.test", id, role]);
    await db.query("INSERT INTO sessions(token_hash,actor_id,csrf,expires_at) VALUES ($1,$2,$3,now()+interval '1 hour')", [hash(token), id, csrf]);
    return {
      id,
      headers: {
        cookie: "__Host-mmjgreen-session=" + token,
        origin: config.origin,
        "content-type": "application/json",
        "x-csrf-token": csrf,
      },
    };
  }
  const bare = (h: Record<string, string>) => ({ cookie: h.cookie, origin: h.origin, "x-csrf-token": h["x-csrf-token"] });
  const doctor = await actor("DOCTOR");
  const otherDoctor = await actor("DOCTOR");
  const staff = await actor("STAFF");
  const created = (
    await app.inject({
      method: "POST",
      url: "/api/v1/availability",
      headers: doctor.headers,
      payload: {
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 115200000).toISOString(),
        timezone: "America/New_York",
        bufferMinutes: 5,
      },
    })
  ).json();
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/v1/availability/" + created.id, headers: bare(staff.headers) })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/v1/availability/" + created.id, headers: bare(otherDoctor.headers) })).statusCode,
    403,
  );
  const removed = await app.inject({ method: "DELETE", url: "/api/v1/availability/" + created.id, headers: bare(doctor.headers) });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(
    (await app.inject({ method: "DELETE", url: "/api/v1/availability/" + created.id, headers: bare(doctor.headers) })).statusCode,
    404,
  );

  // A window with a booked appointment cannot be deleted.
  const booked = (
    await app.inject({
      method: "POST",
      url: "/api/v1/availability",
      headers: doctor.headers,
      payload: {
        startsAt: new Date(Date.now() + 172800000).toISOString(),
        endsAt: new Date(Date.now() + 201600000).toISOString(),
        timezone: "America/New_York",
        bufferMinutes: 5,
      },
    })
  ).json();
  const patientId = randomUUID();
  await db.query("INSERT INTO identities(id,issuer,subject,role) VALUES ($1,'test',$2,'PATIENT')", [patientId, patientId]);
  const intakeId = randomUUID();
  await db.query(
    "INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,state_code) VALUES ($1,$2,'2026-09-initial',$3,'CA')",
    [intakeId, patientId, "v1.a.b.c"],
  );
  await db.query(
    "INSERT INTO appointments(id,intake_id,patient_id,doctor_id,availability_id,starts_at,ends_at,reserved_until,timezone,mode,created_by,request_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UTC','VIDEO',$9,$10)",
    [
      randomUUID(),
      intakeId,
      patientId,
      doctor.id,
      booked.id,
      new Date(Date.now() + 172800000),
      new Date(Date.now() + 174000000),
      new Date(Date.now() + 174300000),
      staff.id,
      randomUUID(),
    ],
  );
  const blocked = await app.inject({ method: "DELETE", url: "/api/v1/availability/" + booked.id, headers: bare(doctor.headers) });
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.match(blocked.body, /WINDOW_IN_USE/);
});
