# FadeWell

Guided medical-card evaluation and telehealth. A public marketing site and four
care workspaces, running on a single Fastify + PostgreSQL service.

This repository contains a complete, self-contained product. It is **not a fork**
— the brand, copy, design system, imagery and interface are original to
FadeWell.

---

## Repository layout

```
fadewell/
├── api/                 FadeWell API — Fastify 5 + TypeScript, PostgreSQL
│   ├── src/             server, routes, auth, delivery, migrations runner
│   ├── migrations/      28 ordered SQL migrations
│   ├── tests/           163 API tests (node:test + PGlite)
│   └── deploy/          Heroku packaging, grants, CA bundle
└── web/                 FadeWell web client — React 19 + Vite
    ├── src/pages/       public marketing pages
    ├── src/pages/care/  /patient · /portal · /staff · /admin
    ├── src/styles/      design tokens, base, components, pages, care
    ├── public/          self-hosted fonts, generated brand assets
    └── tests/browser/   Playwright suite
```

## Requirements

- Node.js 20 or newer (24.x is what CI and Heroku use)
- PostgreSQL 14+ for the API database (Supabase works; see `api/deploy/`)

---

## Local development

Two processes: the API on `3001`, the web client on `5173` proxying `/api`.

```sh
# 1. API
cd api
cp .env.example .env      # then fill in DATABASE_URL and DATA_ENCRYPTION_KEY
npm ci
npm run migrate
npm run dev               # http://127.0.0.1:3001

# 2. Web client (second terminal)
cd web
npm ci
npm run dev               # http://127.0.0.1:5173
```

Generate an encryption key with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

To exercise the care workspaces locally without a database, run the synthetic
in-memory API instead of `npm run dev` — see **Browser tests** below.

---

## Commands

### `api/`

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch-mode API server |
| `npm start` | Production API server |
| `npm run worker` | Notification delivery worker |
| `npm run migrate` | Apply pending migrations |
| `npm run provision` | Create an identity from an IdP subject |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Full API suite (163 tests, in-memory Postgres) |
| `npm run test:postgres` | Tests requiring a real PostgreSQL instance |

### `web/`

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production bundle → `web/dist` |
| `npm run preview` | Serve the production bundle |
| `npm run lint` | oxlint |
| `npm run test:e2e` | Playwright browser suite |
| `node scripts/audit-classes.mjs` | Token / class / import audit |
| `node scripts/probe-mask.mjs` | Prove the reveal technique survives IntersectionObserver |
| `node scripts/shoot.mjs` | Capture design reference screenshots |
| `node scripts/generate-assets.mjs` | Regenerate brand imagery |

---

## Architecture

### The API

A single Fastify service hosts both the public bundle and the JSON API, so the
browser only ever makes **same-origin** requests. That is a hard requirement,
not a preference: the Content-Security-Policy is `connect-src 'self'`.

**Domain.** A medical-card journey: patient intake → operations review →
clinician evaluation → availability → booking → live consultation →
state application. Every state transition is validated server-side, and every
access to a record is written to an append-only audit table.

**Security posture.**

- Sessions are HttpOnly, `SameSite=Lax` cookies (4-hour expiry, 15-minute idle
  cutoff). The browser never holds the session token.
- Every mutating request requires an `X-CSRF-Token` matching the session, and a
  matching `Origin` header.
- Workforce sign-in is username + password (Argon2id) followed by TOTP, with
  per-identity lockout after five failures.
- Patient intakes use a **guest session** — no account, no password. The
  questionnaire itself is not the authentication factor; identity proof happens
  at consultation.
- Health data is sealed with AES-256-GCM using a per-record associated-data
  string (`intake:<id>`), so a payload cannot be moved between records.
- Notification recipients are stored as HMAC digests, never as addresses.
- Prescription amounts are checked against per-jurisdiction caps, including
  rolling-period cumulative totals, and fail closed when no cap is defined.
- `/patient`, `/portal`, `/staff` and `/admin` are served `noindex`, under a
  strict CSP, and with a restrictive `Permissions-Policy` (camera and
  microphone only where a consultation actually needs them).

**Environment flags.** `INTAKE_ENABLED` and `NOTIFICATIONS_ENABLED` default to
`false`. Enabling either is an operational decision that requires
questionnaire, consent, jurisdiction and deployment review first.

### The web client

**Design language.** A flat editorial system: ivory paper, forest ink, moss for
accents and a lime highlight. No glassmorphism, no blur, no transparency
stacking — inverted sections are solid colour blocks (`.band-dark`), and every
card is an opaque surface with a hairline border. Self-hosted variable fonts
(Sora, Instrument Serif, JetBrains Mono). All colour, type, space, radius and
motion tokens live in `web/src/styles/tokens.css`.

**Motion.** Two deliberate layers:

1. **Native CSS scroll-driven animations** (`animation-timeline: view()`) drive
   continuous effects — parallax drift, the pinned horizontal journey,
   self-drawing rules, the progress rail — off the main thread.
2. **`web/src/lib/motion.js`** handles what CSS timelines cannot express:
   one-shot reveals, count-up statistics, the magnetic button, the sticky
   masthead and the horizontal-track measurement.

Reveals use a **`mask-size` wipe, not `clip-path`** — and that is load-bearing,
not a style preference. Chromium folds a target's own `clip-path` into its
IntersectionObserver rectangle, so a `clip-path: inset(0 0 100%)` reveal
collapses the observed box to zero and the element never reveals at all. A mask
is a paint effect and leaves the observed geometry untouched. Both behaviours
are measured in `web/scripts/probe-mask.mjs`; if you change the reveal, re-run it.

Everything is wrapped in `prefers-reduced-motion`, and every effect degrades to a
static, fully readable layout where scroll timelines are unsupported.

**CSP compliance.** The strict policy (`style-src 'self'; font-src 'self'`)
means no inline styles, no inline scripts and no third-party fonts. All styling
is in stylesheets, all fonts are self-hosted in `web/public/fonts`, and pointer
tracking writes CSS custom properties through the CSSOM rather than style
attributes.

**Design-token audit.** `web/scripts/audit-classes.mjs` cross-checks CSS custom
properties, JSX class names and local imports. A refactor that renames a token
or drops a stylesheet rule fails it immediately:

```sh
node web/scripts/audit-classes.mjs
```

---

## Care workspaces

| Route | Role | Purpose |
| --- | --- | --- |
| `/patient` | Patient | Intake questionnaire, appointment view, submission |
| `/portal` | Clinician | Schedule, assigned evaluations, notes, availability |
| `/staff` | Operations | Review queues, contact verification, booking, notes |
| `/admin` | Administrator | Access control, delivery readiness, audit trail |

The API and a workspace surface bind at a fixed contract; the client never
assumes a response shape it has not been given, and every panel fails
independently — a failing audit query does not blank the access panel.

---

## Browser tests

The Playwright suite boots two isolated servers: a synthetic in-memory API
(`api/tests/browser-server.ts`, port 3001) and the production bundle via
`vite preview` (port 4173). Both refuse to start under `NODE_ENV=production` or
with a real `DATABASE_URL`, so the suite can never touch live patient data.

```sh
cd web
npx playwright install chromium   # once
npm run test:e2e
```

Coverage: all 15 public routes at two viewports, link integrity, runtime-error
detection, brand-assertion (no legacy brand strings may appear), scroll
animation, the FAQ accordion, WCAG 2.1 AA scans via axe-core, and every care
workspace including role isolation and noindex headers.

Screenshots land in `web/artifacts/browser/`.

---

## Deployment

The combined app targets a single origin: Heroku or any Node host running
`api/`, serving `web/dist` via `SERVE_WEB=true`.

```sh
cd api
powershell -File deploy/heroku.ps1 -App fadewell-api
```

The packaging script typechecks the API, builds the web client, uploads an
explicit source allowlist (no credentials, no `node_modules`, no tests), then
verifies `/api/health/ready` and `/api/auth/status` on the released origin before
reporting success.

See `api/deploy/README.md` for the full runbook, credential targets and
Supabase grant setup.

---

## Privacy and clinical scope

FadeWell is an administrative and clinical-scheduling platform. It does not
issue medical cards — state registries do — and it does not guarantee approval
of any application. Evaluations are performed by independently licensed
clinicians, not by the platform. Patient information is never sold, and consent
to contact is collected separately from consent to treatment.

Before any production launch, confirm current `INTAKE_ENABLED` and
`NOTIFICATIONS_ENABLED` settings, and complete legal, clinical and compliance
review for each state served.
