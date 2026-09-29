# FadeWell patient journey API

TypeScript on Node 24, Fastify and PostgreSQL. Extends the existing React/Vite site on `codex/backend`.

## What works in this slice

- Local username/password sign-in with TOTP for every workforce role; roles come from the database.
- Hashed opaque sessions, HttpOnly cookies, CSRF/origin checks, idle/absolute expiry, revocation and disabled-account checks.
- Encrypted, versioned intake autosave/restore, stable save retry keys, questionnaire submission, validation flags and submission receipts.
- Staff review, corrected-information requests, append-only encrypted contact/internal notes.
- Doctor-specific availability windows; transactionally booked appointments with database doctor/patient overlap constraints and buffers; cancellation before encounter start.
- Assigned-doctor encounter timer with start, pause, resume, extension, custom duration and completion. Patients receive resource-scoped SSE updates. Zero time never completes an encounter.
- Administrative account enable/revoke, protected audit history and persisted outbox visibility.
- Staff-confirmed communication destinations, revocation when contact details change, and patient consent withdrawal after submission or encounter completion.
- A separate notification worker with transactional planning, leased sends, append-only attempt records, bounded retries, and explicit ambiguous-outcome reconciliation. Telnyx SMS and TLS-only SMTP adapters are implemented; delivery is disabled by default in local configuration. Consented, verified SMS destinations receive staff-issued, encrypted-at-rest, one-use consultation links.
- Four responsive frontend workspaces: `/patient`, `/portal`, `/staff`, `/admin`.

## Not yet complete

Live provider/account verification, delivery-status webhooks, reminder scheduling, inbound opt-out synchronization, patient cross-device recovery, telephone voice transport, recurring availability/time-off, atomic rescheduling, configurable questionnaire publishing, advanced queue pagination/search, key rotation tooling, immutable off-site audit archive, production hosting/backup configuration and compliance validation remain pending. Browser video runs on Telnyx Video Rooms when `TELNYX_API_KEY` is set, billed per participant minute. Current questionnaire needs clinical review before real-patient intake. No real notifications were sent during development.

The operational intake state set is deliberately smaller than the full target journey: `DRAFT`, `REVIEW_PENDING`, `NEEDS_CORRECTION`, `VERIFIED`, `SCHEDULED`, `COMPLETED`, `CANCELLED`. Timer and appointment state are separate. See the roadmap for remaining states and transitions.

## Local development

Requirements: Node 24+, npm, and a dedicated PostgreSQL 16+ database with permission to install `btree_gist` during migration.

1. Install dependencies with `npm ci` in this directory and `web/`.
2. Create a private `.env` using `.env.example`; supply local database credentials and a random 32-byte base64 encryption key. Never reuse a test key or commit this file.
3. Run `npm run migrate` with migration-owner credentials. Migrations are checksummed and advisory-locked; changed deployed SQL is rejected.
4. Configure an exact `APP_ORIGIN` and encrypted local credentials. All workforce roles enroll TOTP at first sign-in.
5. With operator credentials, set `PROVISION_PASSWORD` and run `npm run provision -- ADMIN <username>` (or `STAFF`, `DOCTOR`). This creates a new identity and an operator audit event; it does not change existing roles.
6. After clinical, consent and environment review, set `INTAKE_ENABLED=true` for synthetic development data. Use the separate production release gates before real patient data.
7. Run `npm run dev` here; run `npm run dev` in `web/`. Open `http://localhost:5173/patient` or the relevant workforce route. Vite proxies `/api` to `127.0.0.1:3001`.

Without database/identity configuration, public entry screens remain usable and explain that access is unavailable. There are no production demo credentials or header-based role switches.

## Tests

```sh
npm test
npm run typecheck
npm run test:coverage
```

By default, tests use isolated PGlite (the PostgreSQL engine compiled to WASM), with the real migrations and `btree_gist`. Set `TEST_DATABASE_URL` to a **disposable test PostgreSQL cluster** with database-creation permission for real pool/connection tests. Each test database instance creates and removes its own randomly named database; group roles may remain on the test cluster. Tests create records, database roles and temporary failure triggers; never point them at a retained environment. CI is configured to use PostgreSQL 16. Local WASM execution does not prove real multi-connection race behavior.

`npm run test:postgres` is a separate mandatory production gate. It requires that test cluster and observes real lock contention between consent withdrawal and dispatch intent; it deliberately cannot fall back to a single-connection engine. CI runs it after the API suite.

In `web/`, run `npm run test:e2e`. This starts an isolated in-memory API, seeds synthetic session fixtures, and exercises real UI/API flows. It deliberately refuses configured database URLs or production mode. Install Playwright Chromium first, or set `PLAYWRIGHT_CHANNEL=msedge` on a Windows machine with Edge. Browser tests do not log into a real identity provider. Cryptographic OIDC responses are exercised separately in API tests with a mocked issuer transport.

## Deployment boundary

The Heroku/Supabase synthetic staging environment is configured separately. See [staging deployment and account activation](deploy/README.md) for URLs, authentication, runtime grants, and repeatable deployment commands.

The marketing Vercel deployment intentionally returns 503 for `/api/*` through `web/api/[...path].js`. Do not deploy clinical records behind that fallback. Deploy the approved healthcare API and private frontend behind a same-origin gateway, replacing that fallback only as part of the reviewed environment configuration. Verify deployed deep links, no-store/noindex/CSP, TLS, Origin and SSE buffering behavior.

Use a separate migration login and runtime login. Apply `deploy/runtime-grants.sql` once, grant the `mca_runtime` group role to the API login, and verify effective privileges. Production startup rejects credentials that can mutate audit history. Production PostgreSQL uses certificate verification; configure trusted CA material through the Node runtime trust store, never `rejectUnauthorized: false` or URL SSL overrides.

The Dockerfile runs as an unprivileged user. Its image build and the GitHub workflow still require execution in their target environments. Production needs approved infrastructure, encrypted storage/backups, secure secret injection, region/vendor agreements and a restore drill. Do not treat local passing tests as a HIPAA certification.

## Operational behavior

Logs contain safe event/error codes, generated request IDs, route templates, status and latency. They exclude request bodies, query strings, cookies, patient values and provider error objects. Records, revisions and notes are encrypted with resource-bound AES-256-GCM. The initial key envelope is `v1`; retain the key securely, and implement a reviewed re-encryption migration before rotating it.

Audit/revision/note/questionnaire/attempt updates and deletion are blocked by database triggers and runtime grants. Database owners can still alter protections; independent immutable audit export is a remaining production control. Outbox entries are committed with domain changes. `/api/v1/delivery` is available to staff and administrators and distinguishes source events, notification jobs and delivery attempts. `SENT` means provider acceptance, not confirmed recipient delivery.

SSE rechecks session and record authorization every two seconds, transmits snapshots on change, and uses comments for keepalive. It does not extend idle sessions. A per-actor three-stream cap protects a single process; distributed connection/rate controls belong at the approved edge. No patient PHI is stored in browser storage.

Architecture: [`../docs/patient-journey/`](../docs/patient-journey/10-implementation-roadmap.md).

## Notification worker setup

1. Run `npm run migrate` to apply all migrations, including notification tables and audit event clocks, then apply the updated API grants.
2. Apply `deploy/worker-grants.sql` once and assign its group to a separate worker login. Worker startup rejects credentials that can rewrite audit history. The worker does not require OIDC credentials.
3. Configure an approved Telnyx account/from number/messaging profile and/or approved SMTP provider. SMTP uses implicit TLS on port 465 with certificate verification. Confirm account agreements, messaging consent/opt-out behavior and sender registration before activation.
4. Keep `NOTIFICATIONS_ENABLED=false` until account configuration and staging delivery have been validated. Set it in the API as a UI indicator and in the worker as the actual send gate.
5. Run `npm run worker` with the worker's database login, encryption key and provider secrets. API and worker must use the same `APP_ORIGIN` and data encryption key. Notification activation requires an HTTPS origin even outside production mode; HTTPS sessions always use Secure, host-only cookies.
6. Staff records destination verification only after confirming the address/number with the patient. Format validation is not ownership verification. The API never accepts an arbitrary replacement destination in that operation.
7. Inspect **Delivery follow-up** in `/staff` or **Delivery queue** in `/admin`. `BLOCKED` needs verification; `UNAVAILABLE` needs provider configuration; `RETRY` uses exponential backoff/jitter with five automatic attempts; `UNCERTAIN` requires provider reconciliation, never a blind replay.

The deployed worker also deletes idempotency records older than 24 hours on startup and hourly.
It emits `idempotency.cleanup_completed` after every successful run and
`idempotency.cleanup_failed` on errors, and records successful runs as
`IDEMPOTENCY_CLEANUP_COMPLETED` audit events. Alert if a failure event appears or no completion
event is observed for 90 minutes.

Changing contact details revokes prior verification. Consent and appointment cancellation are rechecked immediately before dispatch; messages already initiated or accepted cannot be recalled. Unsupported event types are skipped. Failed/corrupt data is surfaced rather than blocking the whole queue indefinitely. The initial worker supports fixed service templates only, not arbitrary staff-authored SMS/email or attachments.

Staff may issue a consultation link once its requested validity window reaches the appointment. The link is stored encrypted in the outbox and queued only for a patient who opted into SMS. Dispatch requires a verified current phone number, confirmed appointment, unexpired link and latest consent; reissuing invalidates older links. If SMS is unavailable or blocked, staff must use the returned link through an approved secure handoff. Apply migrations `027` and `028` before deploying this API/worker; `027` revokes previously password-only doctor and staff sessions so those users enroll TOTP.

Authorization inputs are share-locked until the `SENDING` intent commits, then released before provider I/O. Contact verification does not directly lock notification jobs; blocked/configuration-held jobs are rechecked on a one-minute schedule, avoiding inverse lock ordering between intake review and dispatch.

After a timeout/crash, the provider may already have accepted a message. A lease expires into `UNCERTAIN`, with an immutable attempt event. Use provider-side evidence and an audited operational procedure before any manual replay. Automated reconciliation and signed delivery callbacks remain a subsequent integration phase.

SMS attempts record the Telnyx message ID. SMTP attempts record the requested SMTP Message-ID with an `smtp-message:` prefix; some providers replace that header, so it is a correlation value, not a delivery receipt. SMTP acceptance is not proof that the recipient received or read the message.
