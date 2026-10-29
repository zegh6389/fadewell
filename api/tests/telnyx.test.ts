import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { migrate } from "../src/migrate.ts";
import {
  createDeliveryProvider,
  createVideoRoom,
  mintVideoToken,
} from "../src/providers.ts";
import { hash as hashToken, seal } from "../src/security.ts";
import { testDatabase, testConfig } from "./database.ts";

test("Telnyx requires explicit complete configuration and preserves ambiguous send failures", async (t) => {
  const env = {
    NOTIFICATIONS_ENABLED: "true",
    TELNYX_API_KEY: "synthetic",
    TELNYX_FROM: "+12025550101",
    TELNYX_MESSAGING_PROFILE_ID: "synthetic-profile",
  };
  assert.equal(
    createDeliveryProvider({ ...env, TELNYX_API_KEY: "" }).available("SMS"),
    false,
  );
  assert.equal(
    createDeliveryProvider({
      ...env,
      NOTIFICATIONS_ENABLED: "false",
    }).available("SMS"),
    false,
  );
  const provider = createDeliveryProvider(env);
  assert.equal(provider.available("SMS"), true);
  let status = 200;
  const id = "af616762-ff07-4ffd-96f2-2e5269d058f7";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, "https://api.telnyx.com/v2/messages");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer synthetic",
      );
      assert.deepEqual(JSON.parse(String(init?.body)), {
        from: env.TELNYX_FROM,
        to: "+12025550102",
        text: "Your care team received your information.",
        messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID,
      });
      return new Response(JSON.stringify({ data: { id } }), { status });
    },
  );
  const message = {
    channel: "SMS" as const,
    to: "+12025550102",
    text: "Your care team received your information.",
    notificationId: id,
  };
  assert.deepEqual(await provider.send(message), {
    outcome: "ACCEPTED",
    receipt: `telnyx:${id}`,
  });
  for (const [code, outcome] of [
    [429, "RETRY"],
    [401, "FAILED"],
    [500, "UNCERTAIN"],
  ] as const) {
    status = code;
    assert.equal((await provider.send(message)).outcome, outcome);
  }
});

test("video helpers fail closed without a key, a room, or provider approval", async (t) => {
  assert.equal(await createVideoRoom({}, "mmjgreen-test"), null);
  assert.equal(await mintVideoToken({ TELNYX_API_KEY: "k" }, "not-a-uuid"), null);
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 500 }));
  const env = { TELNYX_API_KEY: "synthetic" };
  assert.equal(await createVideoRoom(env, "mmjgreen-test"), null);
  assert.equal(await mintVideoToken(env, randomUUID()), null);
});

test("booking attaches a Telnyx room and scoped participants mint join tokens", async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  await migrate(db);
  await db.query("UPDATE jurisdictions SET status='AVAILABLE', allowed_visit_types=ARRAY['VIDEO']::text[] WHERE code='CA'");
  const roomId = randomUUID();
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target === "https://api.telnyx.com/v2/rooms") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
      const body = JSON.parse(String(init?.body));
      assert.match(body.unique_name, /^mmjgreen-/);
      assert.equal(body.max_participants, 2);
      return Response.json({ data: { id: roomId } }, { status: 201 });
    }
    assert.equal(
      target,
      `https://api.telnyx.com/v2/rooms/${roomId}/actions/generate_join_client_token`
    );
    return Response.json({ data: { token: "synthetic-client-token" } }, { status: 201 });
  });
  const previousKey = process.env.TELNYX_API_KEY;
  process.env.TELNYX_API_KEY = "synthetic";
  t.after(() => {
    if (previousKey === undefined) delete process.env.TELNYX_API_KEY;
    else process.env.TELNYX_API_KEY = previousKey;
  });
  const config = testConfig();
  const app = await buildApp(config, db, () => {});
  t.after(() => app.close());
  const now = new Date();
  const doctor = (await db.query("INSERT INTO identities(issuer,subject,role) VALUES ('synthetic','doctor-video','DOCTOR') RETURNING id")).rows[0];
  const staff = (await db.query("INSERT INTO identities(issuer,subject,role) VALUES ('synthetic','staff-video','STAFF') RETURNING id")).rows[0];
  const staffToken = randomBytes(32).toString("base64url"),
    staffCsrf = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions(token_hash,actor_id,csrf,expires_at,last_seen_at) VALUES ($1,$2,$3,now()+interval '4 hours',now())", [hashToken(staffToken), staff.id, staffCsrf]);
  const headers = { origin: config.origin, "content-type": "application/json", cookie: `__Host-mmjgreen-session=${staffToken}`, "x-csrf-token": staffCsrf };
  const patient = (await db.query("INSERT INTO identities(issuer,subject,role) VALUES ('synthetic','patient-video','PATIENT') RETURNING id")).rows[0];
  const intakeId = randomUUID();
  const intake = (await db.query("INSERT INTO intakes(id,patient_id,questionnaire_version,encrypted_payload,state,state_code) VALUES ($1,$2,'2026-09-initial',$3,'VERIFIED','CA') RETURNING id", [intakeId, patient.id, seal({ mode: 'VIDEO' }, config.encryptionKey!, `intake:${intakeId}`)])).rows[0];
  const slot = (await db.query("INSERT INTO availability(doctor_id,starts_at,ends_at,timezone,buffer_minutes) VALUES ($1,$2,$3,'UTC',5) RETURNING id", [doctor.id, new Date(now.getTime() - 86400000), new Date(now.getTime() + 259200000)])).rows[0];
  const created = await app.inject({
    method: "POST", url: "/api/v1/appointments", headers,
    payload: { requestKey: randomUUID(), intakeId: intake.id, availabilityId: slot.id, startsAt: new Date(now.getTime() + 600000).toISOString(), durationMinutes: 15, mode: "VIDEO" },
  });
  assert.equal(created.statusCode, 200, created.body);
  const stored = (await db.query("SELECT video_room_id FROM appointments WHERE id=$1", [created.json().id])).rows[0];
  assert.equal(stored.video_room_id, roomId);
  const patientToken = randomBytes(32).toString("base64url"),
    patientCsrf = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions(token_hash,actor_id,csrf,expires_at,last_seen_at) VALUES ($1,$2,$3,now()+interval '4 hours',now())", [hashToken(patientToken), patient.id, patientCsrf]);
  const patientHeaders = { origin: config.origin, "content-type": "application/json", cookie: `__Host-mmjgreen-session=${patientToken}`, "x-csrf-token": patientCsrf };
  const staffMedia = await app.inject({ url: `/api/v1/consultations/${created.json().id}/media`, headers });
  assert.equal(staffMedia.statusCode, 403, staffMedia.body);
  const media = await app.inject({ url: `/api/v1/consultations/${created.json().id}/media`, headers: patientHeaders });
  assert.equal(media.statusCode, 200, media.body);
  assert.equal(media.json().roomId, roomId);
  assert.equal(media.json().token, "synthetic-client-token");
  await db.query("UPDATE appointments SET video_room_id=NULL WHERE id=$1", [created.json().id]);
  assert.equal((await app.inject({ url: `/api/v1/consultations/${created.json().id}/media`, headers: patientHeaders })).statusCode, 409);
  assert.equal((await app.inject({ url: `/api/v1/consultations/${created.json().id}/media` })).statusCode, 401);
});
