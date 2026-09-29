import nodemailer from "nodemailer";
import type {
  DeliveryMessage,
  DeliveryOutcome,
  DeliveryProvider,
} from "./delivery.ts";

const uuidPattern = /^[0-9a-f-]{36}$/i;

// ponytail: best-effort video helpers; null means unconfigured or provider refused, never throw
export async function createVideoRoom(
  env: NodeJS.ProcessEnv = process.env,
  name: string
): Promise<string | null> {
  if (!env.TELNYX_API_KEY) return null;
  try {
    const response = await fetch("https://api.telnyx.com/v2/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ unique_name: name, max_participants: 2 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { data?: { id?: string } };
    return typeof result.data?.id === "string" && uuidPattern.test(result.data.id)
      ? result.data.id
      : null;
  } catch {
    return null;
  }
}

export async function mintVideoToken(
  env: NodeJS.ProcessEnv = process.env,
  roomId: string
): Promise<string | null> {
  if (!env.TELNYX_API_KEY || !uuidPattern.test(roomId)) return null;
  try {
    const response = await fetch(
      `https://api.telnyx.com/v2/rooms/${roomId}/actions/generate_join_client_token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token_ttl_secs: 3600 }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) return null;
    const result = (await response.json()) as { data?: { token?: string } };
    return typeof result.data?.token === "string" && result.data.token.length > 0
      ? result.data.token
      : null;
  } catch {
    return null;
  }
}

export function deliveryFailure(error: unknown): DeliveryOutcome {
  const failure = error as { status?: number; responseCode?: number };
  if (
    failure?.status === 429 ||
    (failure?.responseCode &&
      failure.responseCode >= 400 &&
      failure.responseCode < 500)
  )
    return "RETRY";
  if (
    (failure?.status && failure.status >= 400 && failure.status < 500) ||
    (failure?.responseCode && failure.responseCode >= 500)
  )
    return "FAILED";
  // A timeout or provider 5xx can happen after acceptance. Reconcile before resending.
  return "UNCERTAIN";
}

export function createDeliveryProvider(env = process.env): DeliveryProvider {
  const enabled = env.NOTIFICATIONS_ENABLED === "true";
  const telnyxConfigured = Boolean(
    enabled &&
    env.TELNYX_API_KEY &&
    env.TELNYX_FROM &&
    env.TELNYX_MESSAGING_PROFILE_ID,
  );
  const emailConfigured = Boolean(
    enabled &&
    env.SMTP_HOST &&
    env.SMTP_USER &&
    env.SMTP_PASSWORD &&
    env.EMAIL_FROM,
  );
  const smtpPort = Number(env.SMTP_PORT || 465);
  if (emailConfigured && smtpPort !== 465)
    throw new Error("Private Email SMTP must use implicit TLS on port 465 only");
  const email = emailConfigured
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: smtpPort,
        secure: true,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        logger: false,
        debug: false,
      })
    : undefined;
  return {
    available: (channel) =>
      channel === "SMS" ? telnyxConfigured : channel === "EMAIL" && emailConfigured,
    async send(message: DeliveryMessage) {
      try {
        if (message.channel === "SMS" && telnyxConfigured) {
          const response = await fetch("https://api.telnyx.com/v2/messages", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.TELNYX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: env.TELNYX_FROM,
              to: message.to,
              text: message.text,
              messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok)
            return {
              outcome: deliveryFailure({ status: response.status }),
              receipt: null,
            };
          const result = (await response.json()) as { data?: { id?: string } };
          return typeof result.data?.id === "string" &&
            /^[0-9a-f-]{36}$/i.test(result.data.id)
            ? { outcome: "ACCEPTED", receipt: `telnyx:${result.data.id}` }
            : { outcome: "UNCERTAIN", receipt: null };
        }
        if (message.channel === "EMAIL" && email) {
          const messageId = `<${message.notificationId}@${new URL(env.APP_ORIGIN || "http://localhost").hostname}>`;
          const result = await email.sendMail({
            messageId,
            from: env.EMAIL_FROM,
            replyTo: env.EMAIL_REPLY_TO,
            to: message.to,
            subject: "An update from your care team",
            text: message.text,
            disableFileAccess: true,
            disableUrlAccess: true,
          });
          return {
            outcome: result.accepted.length ? "ACCEPTED" : "FAILED",
            receipt: result.accepted.length
              ? `smtp-message:${messageId}`
              : null,
          };
        }
        return { outcome: "FAILED", receipt: null };
      } catch (error) {
        return { outcome: deliveryFailure(error), receipt: null };
      }
    },
  };
}
