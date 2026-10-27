# Heroku and Supabase deployment

## Live repair — September 13, 2026

Current deployment: Heroku release **v26**, serving <https://mmjgreen.com>.
These observations supersede the historical staging configuration below.

- `mmjgreen-api` runs one Basic web dyno and one Basic worker dyno.
  The personal `telnyx-team-dialer-6389` app has a separate Eco web dyno; it is
  not the MmjGreen notification worker.
- The complete local frontend/API source was packaged with `deploy/heroku.ps1`.
  Origin readiness and authentication configuration passed after release.
- Migrations through `005_username_credentials.sql` are applied. The readiness
  probe requires `005_username_credentials.sql` (the latest migration).
- The worker login now inherits `mca_worker`. Worker row locks run through
  narrowly scoped `SECURITY DEFINER` functions, without granting source-row
  updates or permitting changes to clinical content, consent, or audit history.
- Cloudflare's apex `cache_everything` page rule was replaced with cache bypass;
  its forced edge/browser TTLs were removed, browser TTL was set to respect
  origin headers, and the zone cache was purged. Public pages and API responses
  now return `Cache-Control: no-store` and `CF-Cache-Status: DYNAMIC`.
- Alternate-host pages redirect to the canonical HTTPS domain. Direct API
  health checks remain available at the Heroku hostname.
- Supabase's site URL is now `https://mmjgreen.com`; its email callback
  allowlist includes the canonical domain.
- `INTAKE_ENABLED` and `NOTIFICATIONS_ENABLED` are currently true on the live
  deployment. Staging and synthetic-test defaults remain false (see below).
  These settings are not a clinical/compliance approval.
- A live synthetic guest test passed session creation, save/restore, rejection
  of staff-only access, submission, worker outbox processing, and logout.
  Both notification consents were false; no messages were sent. The synthetic
  account was disabled, sessions revoked, and intake cancelled with audit retained.

### Repeatable database preparation

With operator credentials held only in the local process environment, set
`DATABASE_URL` to the migration-owner URL, `API_DATABASE_LOGIN=mca_api`,
`WORKER_DATABASE_LOGIN=mca_worker_login`, and `NODE_EXTRA_CA_CERTS` to the
absolute path of `deploy/supabase-ca.crt`. Keep the remaining production
configuration and encryption key unchanged. From `patient-api/`, run:

```powershell
node deploy/prepare.ts
```

This runs checksummed migrations, reapplies idempotent grants and Supabase RLS
policies, grants inherited membership to the dedicated logins, and rejects
unsafe login attributes or audit-mutation privileges. Never deploy the owner
URL to either dyno. Migration 004 only adds nullable columns; a code rollback
can leave those columns in place. Do not drop columns or roll back grants to
the broken configuration.

### Remaining external verification

Namecheap sign-in is required to verify purchased mailbox provisioning, obtain
its DKIM record, and configure authenticated SMTP in both Heroku and Supabase.
Existing mail DNS still points to Namecheap forwarding; avoid switching MX
until the actual mailbox is verified. No mailbox password is stored here.
Telnyx credentials, sender status, and messaging profile were verified, but
recipient delivery and calling were not tested. The profile's callback points
to the personal dialer; do not overwrite that shared callback during API repair.
The disposable real-PostgreSQL concurrency gate remains separate from local
PGlite and live smoke checks.

Later source changes require migrations `027_scoped_join_sessions.sql` and `028_join_link_outbox.sql` before rolling the API and worker. These migrations were not part of the September 13 release described above. Reauthenticate doctor/staff accounts with TOTP after migration; verify a consented synthetic SMS-link attempt with provider evidence before relying on live delivery.

## Patient account correction — September 12, 2026

The patient route now opens a general form using an opaque, HttpOnly guest session.
Patients do not register, choose a password, or activate an account. The general
form autosaves before advancing to the questionnaire; final submission shows a
server-confirmed receipt. Existing role checks still protect staff, doctor and
admin routes. Refresh restores progress during the active session. After session
expiry, patients need staff assistance; cross-device recovery and emailed
consultation credentials are not implemented yet.

The public state selector links available jurisdictions to `/patient`.
`INTAKE_ENABLED` controls guest-session creation and intake writes.
Workforce access still requires assigned roles and MFA.

Telnyx SMS is the delivery adapter; it needs `TELNYX_API_KEY`,
`TELNYX_FROM`, and `TELNYX_MESSAGING_PROFILE_ID`. Delivery requires
`NOTIFICATIONS_ENABLED=true`, verified destinations, consent, and a separately
provisioned worker with worker database permissions. An API adapter test is not
proof of live message delivery. Email requires the documented SMTP settings.
Browser video runs on Telnyx Video Rooms (`TELNYX_API_KEY`, ~$0.002/participant/min); telephone voice and emailed consultation links remain unfinished.

## Mail

Send-as `no-reply@myfloramd.com` and reply-to `care@myfloramd.com`. SMTP
credentials must be set on Heroku locally:

```powershell
heroku config:set EMAIL_FROM="no-reply@myfloramd.com" EMAIL_REPLY_TO="care@myfloramd.com" SMTP_HOST="mail.privateemail.com" SMTP_PORT=465 SMTP_USER="no-reply@myfloramd.com" --app mmjgreen-api
heroku config:set SMTP_PASSWORD="<paste dashboard password locally>" --app mmjgreen-api
heroku config:set NOTIFICATIONS_ENABLED=true --app mmjgreen-api
```

Never type the SMTP password in chat, commit it to the repo, or paste it in
issue trackers. Password rotation requires a deployment with new credentials.

## Connected services

- App: <https://mmjgreen-api.herokuapp.com>
- Heroku: `mmjgreen-api`, US region, Cedar `heroku-24`, one Basic web dyno.
- Supabase: `lsetcjhszhaobzsnqziw`, `us-east-1`, PostgreSQL 17.
- Frontend: the React/Vite production build is served by the same Fastify process. `/api` uses the same origin as the browser, including secure cookies and SSE.
- The existing Vercel marketing deployment remains separate and retains its unavailable API fallback.

This is a synthetic-data staging deployment. `INTAKE_ENABLED=false` and `NOTIFICATIONS_ENABLED=false`. Real patient intake, notification delivery, compliance approval, independent backups and restore verification are not activated by this setup.

## Authentication

Workforce sign-in is local username, password, and TOTP. `/api/auth/status`
reports `provider: 'local'`; the API contacts no external identity provider.
Sign-in screens label the login identifier **Username**. Passwords must meet
`minPasswordLength` (12). Staff, doctor, and admin access requires TOTP
verification: the first sign-in returns an enrollment setup key, and later
sign-ins require the six-digit authenticator code. Patients use opaque,
HttpOnly guest sessions and do not use workforce MFA.

To provision a workforce account, use the operator CLI with migration-owner
database credentials (never the runtime login). The CLI manages local
credentials directly; it takes no `SUPABASE_URL` and no `PROVISION_SUBJECT`:

```powershell
$env:PROVISION_PASSWORD = '<paste locally>'
npm run provision -- DOCTOR <username>
```

`PROVISION_RESET_PASSWORD='true'` resets a password,
`PROVISION_RESET_MFA='true'` clears the TOTP secret so the next sign-in
re-enrolls, and `PROVISION_ID` pins an existing identity. Supabase Auth email
links, PKCE callbacks, `SUPABASE_URL`/`SUPABASE_ANON_KEY` client settings, and
`ADMIN_LOGIN_EMAIL` aliasing do not apply to this flow. Supabase remains only
the PostgreSQL host (see Database below).

## Database

Migrations `001` through `005` have been applied. Then `runtime-grants.sql` and `supabase-grants.sql` were applied with the database owner. The `mca_api` login inherits the restricted `mca_runtime` group. All clinical tables have RLS enabled; anon, authenticated, and service-role Data API access to these tables is revoked.

Heroku uses the Supabase session pooler on port 5432 with username `mca_api.lsetcjhszhaobzsnqziw`. `DATABASE_URL` contains runtime credentials only. Configure `NODE_EXTRA_CA_CERTS=/app/deploy/supabase-ca.crt`; certificate and hostname verification remain enabled. The bundled public CA comes from <https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt>.

Operator secrets are in Windows Credential Manager, not the repository:

- `supabase/mmjgreen-api/postgres`
- `supabase/mmjgreen-api/runtime`
- `mmjgreen-api/encryption`

Back up the encryption key securely before retaining any data. Never rotate it without the corresponding data re-encryption procedure.

## Redeploy from Windows

Requires authenticated Heroku CLI, Node 24, npm, tar, curl, and installed dependencies in both application directories. Configure Heroku environment variables before deploying (see `.env.example`). Set `NODE_ENV=production`, `SERVE_WEB=true`, and the exact HTTPS `APP_ORIGIN`.

```powershell
npm --prefix patient-api test
npm --prefix web test
npm --prefix web run lint
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm --prefix web run test:e2e
powershell -File patient-api/deploy/heroku.ps1 -App mmjgreen-api
```

The deploy script typechecks, builds the frontend, packages an explicit source allowlist, submits a Heroku build, waits for success, then scales to one Basic web dyno. It does not commit or push a Git branch. Heroku bills Basic at its current monthly rate; account-credit coverage must be verified in billing.

Verify `/api/health/live`, `/api/health/ready`, `/api/auth/status`, and private-route deep links after deployment. Use synthetic identities for browser login/logout and MFA tests. Delete temporary provider identities, disable their application identities, and revoke their sessions afterward; preserve their audit history.

Local verification: 39 API tests, 39 frontend contract tests, typecheck, lint, and five browser workflow tests pass. The production dependency audit reports no known vulnerabilities. Live synthetic patient login/logout, administrator TOTP enrollment/login/logout, secure cookies, empty browser storage, and 390px layout have been exercised. Real inbox delivery and the user's MFA enrollment remain human verification steps. The PostgreSQL concurrency production gate and full clinical production release gates remain required before real patient use.
