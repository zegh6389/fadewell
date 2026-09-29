import { randomUUID, createHmac, hkdfSync } from "node:crypto";
import type { Database, Sql, Row } from "./db.ts";
import { hash, open } from "./security.ts";

// Per-recipient dedupe window: refuse to send the same template (channel + recipient) twice
// within this many ms. Hashes don't include the template because the same patient receiving
// two different notifications within seconds (e.g. intake.submitted + contact.verified in
// the same minute) is the spam pattern we're protecting against — a per-channel cap catches
// it.
const RECIPIENT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

// Per-recipient rate budget: cap sends per recipient per hour. Sibling to dedupe (catches
// "many distinct templates" rather than "same template"). Phase 9 default is 5/hour; tune per
// regulatory complaint volume.
const MAX_PER_HOUR = 5;
const RECIPIENT_RATE_WINDOW_MS = 60 * 60 * 1000;

// Domain label passed into HKDF so the derived subkey is bound to "recipient-hmac" use only.
// Bumping `v1` -> `v2` is the one-shot rotation: every existing notifications.last_recipient_hash
// row becomes invalid and the dedupe window resets across the fleet, which is the desired
// behavior when the encryption key (the IKM) itself rotates.
const RECIPIENT_HMAC_INFO = "fadewell:recipient-hmac:v1";

// Derive a 32-byte HMAC subkey from the encryption key the delivery cycle was already handed.
// HKDF-Extract+Expand with no salt (acceptable for a single-domain derivation where the IKM
// is itself high-entropy) and a domain-separated info string. Replaces the previous raw
// SHA-256("channel:recipient") which an attacker with read access to the notifications table
// could reverse-enumerate because email/phone input spaces are small.
function deriveRecipientHmacKey(encryptionKey: string): Buffer {
  const ikm = Buffer.from(encryptionKey, "base64");
  return Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      Buffer.alloc(0),
      RECIPIENT_HMAC_INFO,
      32,
    ),
  );
}

// Keyed, domain-separated HMAC over "channel:recipient". Output remains a 64-character hex
// string so the existing `last_recipient_hash` column and partial index in migration 013 work
// unchanged. With the encryption key unknown, an attacker cannot build a rainbow table for
// emails or phone numbers even if they read the column.
export function recipientHash(
  channel: "EMAIL" | "SMS",
  recipient: string,
  encryptionKey: string,
): string {
  const subkey = deriveRecipientHmacKey(encryptionKey);
  return createHmac("sha256", subkey)
    .update(`${channel}:${recipient}`)
    .digest("hex");
}

type RecipientDedupeResult =
  | { dedupe: true; priorReceipt: string }
  | { dedupe: false; deferUntil?: Date };

async function checkRecipientDedupe(
  sql: Sql,
  channel: "EMAIL" | "SMS",
  recipient: string,
  key: string,
  eventId: string,
): Promise<RecipientDedupeResult> {
  const hash = recipientHash(channel, recipient, key);
  // updated_at, not created_at: a notification that takes longer than the
  // dedupe window to deliver has its created_at already outside the window
  // at the moment its status finally becomes SENT. Measuring the window from
  // updated_at (= last successful delivery transition) is what makes the
  // "skip duplicates within X minutes" guarantee actually hold across
  // multi-minute retry-storm latency.
  const row = (
    await sql.query(
      `SELECT n.status, n.provider_receipt, n.updated_at
       FROM notifications n
       JOIN outbox_events prior_event ON prior_event.id=n.event_id
       JOIN outbox_events current_event
         ON current_event.id=$4 AND current_event.event_type=prior_event.event_type
       WHERE n.channel=$1 AND n.last_recipient_hash=$2
         AND n.status IN ('SENT','UNCERTAIN')
         AND n.updated_at > now() - ($3 * interval '1 millisecond')
       ORDER BY n.updated_at DESC LIMIT 1`,
      [channel, hash, RECIPIENT_DEDUPE_WINDOW_MS, eventId],
    )
  ).rows[0];
  if (!row) return { dedupe: false };
  if (row.status === "UNCERTAIN")
    return {
      dedupe: false,
      deferUntil: new Date(
        new Date(row.updated_at).getTime() + RECIPIENT_DEDUPE_WINDOW_MS,
      ),
    };
  return { dedupe: true, priorReceipt: String(row.provider_receipt ?? "") };
}

type RateLimitResult =
  | { rateLimited: false }
  | { rateLimited: true; sentInLastHour: number };

async function checkRecipientRateLimit(
  sql: Sql,
  channel: "EMAIL" | "SMS",
  recipient: string,
  key: string,
): Promise<RateLimitResult> {
  const hash = recipientHash(channel, recipient, key);
  // See checkRecipientDedupe above for the created_at -> updated_at rationale.
  // Only SENT rows are confirmed deliveries. Live SENDING and recent UNCERTAIN
  // rows reserve capacity so concurrent or ambiguous outcomes cannot exceed the
  // budget; they are tracked separately from confirmed deliveries.
  const row = (
    await sql.query(
      `SELECT
         count(*) FILTER (WHERE status='SENT')::int AS sent,
         count(*) FILTER (WHERE status IN ('SENDING','UNCERTAIN'))::int AS reserved
       FROM notifications
       WHERE channel=$1 AND last_recipient_hash=$2
         AND status IN ('SENDING','SENT','UNCERTAIN')
         AND updated_at > now() - ($3 * interval '1 millisecond')`,
      [channel, hash, RECIPIENT_RATE_WINDOW_MS],
    )
  ).rows[0];
  const sent = Number(row?.sent ?? 0);
  const reserved = Number(row?.reserved ?? 0);
  return sent + reserved >= MAX_PER_HOUR
    ? { rateLimited: true, sentInLastHour: sent }
    : { rateLimited: false };
}

export type DeliveryOutcome = "ACCEPTED" | "RETRY" | "FAILED" | "UNCERTAIN";
export type DeliveryMessage = {
  channel: "EMAIL" | "SMS";
  to: string;
  text: string;
  notificationId: string;
};
export interface DeliveryProvider {
  available(channel: string): boolean;
  send(
    message: DeliveryMessage,
  ): Promise<{ outcome: string; receipt: string | null }>;
}
const templates: Record<string, string> = {
  "intake.submitted":
    "We received your information. Your care team will review your request and contact you about the next step.",
  "intake.verified":
    "Your information has been reviewed. Your care team will contact you about scheduling.",
  "intake.correction_requested":
    "We need to verify some information. Your care team may contact you, or you can contact the team for assistance.",
  "appointment.created":
    "Your appointment has been scheduled. Contact your care team for consultation instructions.",
  "appointment.cancelled":
    "Your appointment has been cancelled. Contact your care team about the next step.",
  "appointment.join_link_issued": "Your secure consultation link:",
};
async function workerAudit(
  sql: Sql,
  action: string,
  id: string,
  resource = "notification",
) {
  await sql.query(
    "INSERT INTO audit_events(actor_role,action,resource_type,resource_id,request_id) VALUES ('WORKER',$1,$2,$3,$4)",
    [action, resource, id, randomUUID()],
  );
}

export async function runDeliveryCycle(
  db: Database,
  key: string,
  origin: string,
  provider: DeliveryProvider,
): Promise<boolean> {
  const planned = await db.transaction(async (sql) => {
    const event = (
      await sql.query(
        "SELECT * FROM outbox_events WHERE status='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!event) return false;
    let intake: Row | undefined;
    if (templates[event.event_type]) {
      intake = event.event_type.startsWith("intake.")
        ? (
            await sql.query("SELECT * FROM intakes WHERE id=$1", [
              event.resource_id,
            ])
          ).rows[0]
        : (
            await sql.query(
              "SELECT i.* FROM intakes i JOIN appointments a ON a.intake_id=i.id WHERE a.id=$1",
              [event.resource_id],
            )
          ).rows[0];
    }
    if (intake) {
      let data;
      try {
        data = open(intake.encrypted_payload, key, `intake:${intake.id}`);
      } catch {
        await sql.query(
          "UPDATE outbox_events SET status='FAILED' WHERE id=$1",
          [event.id],
        );
        await workerAudit(sql, "DELIVERY_DATA_UNREADABLE", event.id, "outbox");
        return true;
      }
      for (const [channel, consent] of [
        ["EMAIL", data.emailConsent],
        ["SMS", data.smsConsent],
      ]) {
        if (consent === true && (event.event_type !== 'appointment.join_link_issued' || channel === 'SMS'))
          await sql.query(
            "INSERT INTO notifications(event_id,intake_id,channel) VALUES ($1,$2,$3) ON CONFLICT (event_id,channel) DO NOTHING",
            [event.id, intake.id, channel],
          );
      }
    }
    await sql.query("UPDATE outbox_events SET status=$1 WHERE id=$2", [
      intake ? "PROCESSED" : "SKIPPED",
      event.id,
    ]);
    await workerAudit(sql, "OUTBOX_PROCESSED", event.id, "outbox");
    return true;
  });

  const job = await db.transaction(async (sql) => {
    // A crashed send may already have reached the provider. Never blindly replay it.
    const expired = (
      await sql.query(
        "UPDATE notifications SET status='UNCERTAIN', updated_at=now() WHERE status='SENDING' AND lease_until<now() RETURNING id,attempts",
      )
    ).rows;
    for (const row of expired) {
      await sql.query(
        "INSERT INTO notification_attempts(notification_id,attempt,outcome) VALUES ($1,$2,'UNCERTAIN') ON CONFLICT DO NOTHING",
        [row.id, row.attempts],
      );
      await workerAudit(sql, "DELIVERY_RECONCILIATION_REQUIRED", row.id);
    }
    const cappedRetries = (
      await sql.query(
        "UPDATE notifications SET status='DLQ',last_error=COALESCE(last_error,'attempt cap reached before claim'),updated_at=now() WHERE status='RETRY' AND attempts>=5 RETURNING id",
      )
    ).rows;
    for (const row of cappedRetries)
      await workerAudit(sql, "DELIVERY_RETRY_CAP_REACHED", row.id);
    const selected = (
      await sql.query(
        // RATE_LIMITED is selectable: the cycle marks the notification
        // RATE_LIMITED with available_at = now + 1h, and the same cycle
        // (or any worker process) must re-evaluate it after that window
        // expires. Without it here, a rate-limited notification would be
        // stranded forever once its available_at passed.
        "SELECT n.*, e.event_type, e.resource_id, e.encrypted_payload FROM notifications n JOIN outbox_events e ON e.id=n.event_id WHERE n.status IN ('QUEUED','BLOCKED','UNAVAILABLE','RETRY','RATE_LIMITED') AND n.attempts<5 AND n.available_at<=now() ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!selected) return undefined;
    await sql.query("SELECT public.mca_worker_lock_intake_patient($1)", [
      selected.intake_id,
    ]);
    const intake = (
      await sql.query(
        "SELECT i.* FROM intakes i JOIN identities p ON p.id=i.patient_id WHERE i.id=$1 AND p.enabled=true",
        [selected.intake_id],
      )
    ).rows[0];
    // Lock authorization inputs until the send intent commits, never across provider I/O.
    let appointment: Row | undefined;
    if (selected.event_type.startsWith("appointment.")) {
      await sql.query("SELECT public.mca_worker_lock_appointment($1)", [
        selected.resource_id,
      ]);
      appointment = (
        await sql.query("SELECT status, patient_join_token_hash, patient_join_token_expires_at FROM appointments WHERE id=$1", [
          selected.resource_id,
        ])
      ).rows[0];
    }
    if (intake)
      await sql.query("SELECT public.mca_worker_lock_latest_intake($1)", [
        intake.patient_id,
      ]);
    const latest = intake
      ? (
          await sql.query(
            "SELECT * FROM intakes WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1",
            [intake.patient_id],
          )
        ).rows[0]
      : null;
    let data: Record<string, unknown> | null = null;
    try {
      data = latest
        ? open(latest.encrypted_payload, key, `intake:${latest.id}`)
        : null;
    } catch {
      await sql.query(
        "UPDATE notifications SET status='FAILED',updated_at=now() WHERE id=$1",
        [selected.id],
      );
      await workerAudit(sql, "DELIVERY_DATA_UNREADABLE", selected.id);
      return undefined;
    }
    const normalized = data?.normalized as
      { email?: string; phone?: string } | undefined;
    const consent =
      selected.channel === "EMAIL" ? data?.emailConsent : data?.smsConsent;
    let blocked: string | undefined;
    if (!intake || consent !== true || !templates[selected.event_type])
      blocked = "SKIPPED";
    if (selected.event_type.startsWith("appointment.")) {
      if (
        !appointment ||
        (selected.event_type === "appointment.created" &&
          appointment.status !== "CONFIRMED") ||
        (selected.event_type === "appointment.join_link_issued" &&
          appointment.status !== "CONFIRMED") ||
        (selected.event_type === "appointment.cancelled" &&
          appointment.status !== "CANCELLED")
      )
        blocked = "SKIPPED";
    }
    let joinUrl: string | undefined;
    if (selected.event_type === 'appointment.join_link_issued' && !blocked) {
      try {
        const link = open<{ token: string; expiresAt: string }>(selected.encrypted_payload, key, `outbox:${selected.event_id}`);
        if (selected.channel !== 'SMS' || !/^[A-Za-z0-9_-]{43}$/.test(link.token) ||
          !appointment?.patient_join_token_hash || hash(link.token) !== appointment.patient_join_token_hash ||
          new Date(link.expiresAt).getTime() <= Date.now() + 60000 ||
          new Date(appointment.patient_join_token_expires_at).getTime() <= Date.now() + 60000)
          blocked = 'SKIPPED';
        else joinUrl = `${origin}/patient?view=appointments#join=${link.token}`;
      } catch {
        await sql.query("UPDATE notifications SET status='FAILED',updated_at=now() WHERE id=$1", [selected.id]);
        await workerAudit(sql, 'DELIVERY_DATA_UNREADABLE', selected.id);
        return undefined;
      }
    }
    await sql.query("SELECT public.mca_worker_lock_contact_verification($1,$2)", [
      selected.intake_id,
      selected.channel,
    ]);
    const verification = (
      await sql.query(
        "SELECT * FROM contact_verifications WHERE intake_id=$1 AND channel=$2 AND revoked_at IS NULL",
        [selected.intake_id, selected.channel],
      )
    ).rows[0];
    let destination: string | null = null;
    try {
      destination = verification
        ? open<string>(
            verification.encrypted_destination,
            key,
            `contact:${verification.id}`,
          )
        : null;
    } catch {
      await sql.query(
        "UPDATE notifications SET status='FAILED',updated_at=now() WHERE id=$1",
        [selected.id],
      );
      await workerAudit(sql, "DELIVERY_DATA_UNREADABLE", selected.id);
      return undefined;
    }
    if (
      !blocked &&
      (!destination ||
        destination !==
          (selected.channel === "EMAIL"
            ? normalized?.email
            : normalized?.phone))
    )
      blocked = "BLOCKED";
    if (!blocked && !provider.available(selected.channel))
      blocked = "UNAVAILABLE";
    if (blocked) {
      await sql.query(
        "UPDATE notifications SET status=$1,available_at=now()+interval '1 minute',updated_at=now() WHERE id=$2",
        [blocked, selected.id],
      );
      await workerAudit(sql, `DELIVERY_${blocked}`, selected.id);
      return undefined;
    }
    // Atomic reservation for the recipient's budget slot. pg_advisory_xact_lock
    // serializes concurrent worker cycles for the same (channel, recipient)
    // until this transaction commits, so the dedupe check, rate-limit check,
    // and the SENDING transition below are observed as one operation by every
    // other worker. Without this lock, two cycles picking different events for
    // the same recipient could both pass the rate check and both reach
    // provider.send(), exceeding the hourly budget by the concurrency factor.
    // hashtext -> int maps to the 2-arg form of pg_advisory_xact_lock, scoping
    // by channel so EMAIL and SMS budgets lock independently.
    const recipientHashHex = recipientHash(selected.channel, destination!, key)
    await sql.query(
      "SELECT pg_advisory_xact_lock(hashtext($1)::int, hashtext($2)::int)",
      [selected.channel, recipientHashHex]
    )
    // Phase 8 (OC2): per-recipient dedupe window. If we've sent the same template to the same
    // destination within RECIPIENT_DEDUPE_WINDOW_MS, skip the actual send and record a
    // DEDUPLICATED attempt that cites the prior receipt. DEDUPLICATED leaves the work queue without
    // falsely counting the skipped provider call as a confirmed delivery.
    // ponytail: reissuing revokes prior link; never dedupe the new link against a dead one.
    const dedupe = selected.event_type === 'appointment.join_link_issued'
      ? { dedupe: false as const }
      : await checkRecipientDedupe(sql, selected.channel, destination!, key, selected.event_id);
    if (dedupe.dedupe) {
      const dedupeReceipt = `dedupe:skip:${dedupe.priorReceipt}`;
      const hash = recipientHash(selected.channel, destination!, key);
      const attempt = selected.attempts + 1;
      // Persist last_recipient_hash for audit/search without treating this
      // skipped provider call as SENT or extending the delivery window.
      await sql.query(
        "UPDATE notifications SET status='DEDUPLICATED',attempts=$1,provider_receipt=$2,last_recipient_hash=$3,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$4",
        [attempt, dedupeReceipt, hash, selected.id],
      );
      await sql.query(
        `INSERT INTO notification_attempts(notification_id, attempt, outcome, provider_receipt, recipient_hash)
         VALUES ($1, $2, 'DEDUPLICATED', $3, $4)`,
        [selected.id, attempt, dedupeReceipt, hash],
      );
      await workerAudit(sql, "DELIVERY_DEDUPE_SKIPPED", selected.id);
      return undefined;
    }
    if (dedupe.deferUntil) {
      const hash = recipientHash(selected.channel, destination!, key);
      await sql.query(
        "UPDATE notifications SET status='RETRY',last_recipient_hash=$1,last_error='RECIPIENT_UNCERTAIN',available_at=$2,updated_at=now() WHERE id=$3",
        [hash, dedupe.deferUntil, selected.id],
      );
      await workerAudit(sql, "DELIVERY_UNCERTAIN_DEFERRED", selected.id);
      return undefined;
    }
    // Phase 9: per-recipient rate budget. Catches "many distinct templates to the same victim".
    // Dedupe already handled "same template within 5 min"; this catches slower drain across
    // different templates. The notification is held in RATE_LIMITED with available_at = now + 1
    // hour so the cycle picks it up again after the window resets.
    const rate = await checkRecipientRateLimit(sql, selected.channel, destination!, key);
    if (rate.rateLimited) {
      const hash = recipientHash(selected.channel, destination!, key);
      // last_error is built as a single parameter — never interpolated into
      // the SQL string — so the OpenGrep / ast-grep SQL-injection flag is
      // resolved and any future code path that passes user-influenced data
      // into the message cannot introduce an injection vector here.
      await sql.query(
        "UPDATE notifications SET status='RATE_LIMITED',last_recipient_hash=$1,last_error=$2,available_at=now() + interval '1 hour',updated_at=now() WHERE id=$3",
        [hash, `RECIPIENT_RATE_LIMITED sentInLastHour=${rate.sentInLastHour}`, selected.id],
      );
      await workerAudit(sql, "DELIVERY_RATE_LIMITED", selected.id);
      return undefined;
    }
    const lease = randomUUID(),
      attempt = selected.attempts + 1;
    await sql.query(
      "UPDATE notifications SET status='SENDING',attempts=$1,lease_id=$2,lease_until=now()+interval '2 minutes',last_recipient_hash=$3,updated_at=now() WHERE id=$4",
      [attempt, lease, recipientHashHex, selected.id],
    );
    await sql.query(
      "INSERT INTO notification_attempts(notification_id,attempt,outcome,recipient_hash) VALUES ($1,$2,'STARTED',$3)",
      [selected.id, attempt, recipientHashHex],
    );
    await workerAudit(sql, "DELIVERY_STARTED", selected.id);
    return {
      id: selected.id,
      channel: selected.channel,
      to: destination!,
      lease,
      attempt,
      text: `${templates[selected.event_type]} ${joinUrl || new URL("/contact", origin).href}`,
    };
  });
  if (!job) return planned;
  let result: { outcome: string; receipt: string | null };
  try {
    result = await provider.send({
      channel: job.channel,
      to: job.to,
      text: job.text,
      notificationId: job.id,
    });
  } catch {
    result = { outcome: "UNCERTAIN", receipt: null };
  }
  if (!["ACCEPTED", "RETRY", "FAILED", "UNCERTAIN"].includes(result.outcome))
    result = { outcome: "UNCERTAIN", receipt: null };
  // Definitive non-acceptance reaches DLQ at the attempt cap. UNCERTAIN must retain its
  // reconciliation state because the provider may already have accepted the message.
  const terminal =
    result.outcome !== "ACCEPTED" &&
    result.outcome !== "UNCERTAIN" &&
    job.attempt >= 5;
  const status = terminal
    ? "DLQ"
    : result.outcome === "ACCEPTED"
      ? "SENT"
      : result.outcome;
  const retrySeconds =
    Math.min(3600, 30 * 2 ** job.attempt) + Math.floor(Math.random() * 15);
  await db.transaction(async (sql) => {
    const current = (
      await sql.query(
        `UPDATE notifications SET status=$1,provider_receipt=$2,lease_id=NULL,lease_until=NULL,
           available_at=now()+($3 * interval '1 second'),updated_at=now(),
           last_error=CASE WHEN $1='DLQ' THEN $6 WHEN $1='SENT' THEN NULL ELSE last_error END
         WHERE id=$4 AND lease_id=$5 AND status='SENDING' RETURNING id`,
        [
          status,
          result.receipt,
          retrySeconds,
          job.id,
          job.lease,
          `outcome=${result.outcome} attempt=${job.attempt}`,
        ],
      )
    ).rows[0];
    if (!current) return;
    await sql.query(
      "INSERT INTO notification_attempts(notification_id,attempt,outcome,provider_receipt,recipient_hash) VALUES ($1,$2,$3,$4,$5)",
      [job.id, job.attempt, result.outcome, result.receipt, recipientHash(job.channel, job.to, key)],
    );
    await sql.query(
      "UPDATE notifications SET last_recipient_hash=$1, updated_at=now() WHERE id=$2",
      [recipientHash(job.channel, job.to, key), job.id],
    );
    await workerAudit(
      sql,
      status === "SENT"
        ? "DELIVERY_ACCEPTED"
        : status === "UNCERTAIN"
          ? "DELIVERY_RECONCILIATION_REQUIRED"
          : "DELIVERY_ATTEMPT_FINISHED",
      job.id,
    );
  });
  return true;
}
