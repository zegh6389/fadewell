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

### Opening it on your local network

```sh
cd web
npm run build      # once, or after any change
npm run lan
```

It prints something like:

```
  On this machine : http://127.0.0.1:4173
  On your network : http://192.168.2.47:4173
```

Open the second address on a phone or another laptop on the same Wi-Fi. It uses
the synthetic in-memory API, so the care workspaces are fully usable but nothing
is persisted and no real patient data is involved.

Two things are deliberate here:

- **The API stays bound to `127.0.0.1`.** Only `vite preview` listens on
  `0.0.0.0`; Vite proxies `/api` to the API server-side. Nothing but your own
  machine can reach the API port, so exposing the site does not expose the
  workspaces' backend.
- **`APP_ORIGIN` has to match the address you actually type.** The API refuses
  any state-changing request whose `Origin` it does not recognise, and it
  matches exactly — not by subnet, so `http://192.168.2.99:4173` is refused even
  though `http://192.168.2.47:4173` is allowed. Get this wrong and the failure is
  confusing rather than loud: the site loads, and then nothing you click works.
  `serve-lan.mjs` therefore sets the loopback origin as canonical and passes the
  LAN address in `APP_ORIGINS`, so one build serves both.

To allow a second address, add it to `APP_ORIGINS` rather than widening the
check — a comma-separated list of exact origins, e.g.
`APP_ORIGINS="http://192.168.2.47:4173,http://192.168.2.48:4173"`. In production
every allowed origin must be HTTPS.

Verify the LAN path actually works — loading the site proves little, since only
writes are origin-checked:

```sh
PROBE_URL=http://192.168.2.47:4173 node scripts/probe-lan.mjs
```

If a phone cannot connect at all, the block is almost always the Windows
firewall rather than the app.

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
| `npm run lan` | Serve on the local network so a phone can open it (see below) |
| `npm run lint` | oxlint |
| `npm run test:e2e` | Playwright browser suite |
| `node scripts/audit-classes.mjs` | Token / class / import audit |
| `node scripts/deep-audit.mjs` | Full-route browser audit (see below) |
| `node scripts/probe-mask.mjs` | Prove the reveal technique survives IntersectionObserver |
| `node scripts/shoot-journey.mjs` | Assert the pinned journey travels and lands on the column |
| `node scripts/probe-journey-fallbacks.mjs` | Assert every step stays reachable without motion |
| `node scripts/probe-journey-range.mjs` | Compare the published pinned range against the live layout |
| `npm run probe:lan` | Prove the LAN address loads **and accepts writes** (needs `PROBE_URL`) |
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

1. **Native CSS scroll-driven animations** drive continuous effects — parallax
   drift, self-drawing rules — off the main thread via `animation-timeline: view()`.
2. **`web/src/lib/motion.js`** handles what CSS timelines cannot express:
   one-shot reveals, count-up statistics, the magnetic button, the sticky
   masthead, and the measurements behind the pinned journey.

Reveals use a **`mask-size` wipe, not `clip-path`** — and that is load-bearing,
not a style preference. Chromium folds a target's own `clip-path` into its
IntersectionObserver rectangle, so a `clip-path: inset(0 0 100%)` reveal
collapses the observed box to zero and the element never reveals at all. A mask
is a paint effect and leaves the observed geometry untouched. Both behaviours
are measured in `web/scripts/probe-mask.mjs`; if you change the reveal, re-run it.

**The pinned journey is measured, not derived.** The five steps scroll
horizontally while the section stays stuck. Three things about that cannot be
guessed, and each was found by measuring it:

- The track cannot take a `view()` timeline from itself. It lives inside a
  sticky pin that never leaves the viewport, so its own progress never changes
  and the animation freezes.
- Nor can it take one from the tall section. A view timeline maps its own
  `cover`/`contain` ranges onto the subject, and Chromium's mapping does not
  land on the window the pin is actually stuck for — measured, it starts about
  88px early, so the track is already part-way across when the pin engages.
- The track's viewport is full-bleed, so the track has to supply the content
  gutter itself, or the first and last cards lose their rounded corners to the
  screen edge at exactly the two moments the reader looks at them.

So `useTrackOverflow` measures all three — the travel distance, the gutter off
the real content column, and the pin's stuck window — and publishes them as
custom properties. A root scroll timeline consumes the window as absolute
offsets, with no range mapping to get wrong. `web/scripts/shoot-journey.mjs`
asserts the result: the track starts untranslated, finishes exactly at the
measured travel, and both end panels land on the same column as the heading and
the progress rule.

Everything is wrapped in `prefers-reduced-motion`, and every effect degrades to a
static, fully readable layout where scroll timelines are unsupported. Note that
reduced motion has to **dismantle** the pinned journey rather than freeze it:
collapsing the animation duration to ~0 makes a scroll-driven animation jump to
its *final* keyframe, which would park the track at the far end and hide steps
1–3 permanently. Both non-pinned fallbacks — reduced motion and narrow
viewports — un-pin the section and hand the overflow to a native horizontal
scroller, asserted by `web/scripts/probe-journey-fallbacks.mjs`.

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

### Deep audit

`web/scripts/deep-audit.mjs` goes beyond "does the route render". It walks
every route at both viewports and checks the things the suite does not:

- **No glassmorphism** — fails if any element computes a `backdrop-filter` or
  a `filter`. The brief was flat, and "looks glassy" was an explicit
  rejection, so this is asserted rather than eyeballed.
- **Reveals actually fire** — scrolls the whole document and reports any
  `[data-reveal]` still without `.is-in`. An unrevealed element is
  `opacity: 0`, i.e. permanently invisible content.
- **Real horizontal overflow** — tests whether the page can actually scroll
  sideways, rather than comparing `scrollWidth` to `clientWidth` (with
  `overflow-x: clip` those disagree on a perfectly healthy page).
- Broken images, rendered-text brand leakage, failed requests, and a
  WCAG 2.1 AA scan **with every reveal forced visible** — otherwise axe
  skips hidden content, which is exactly where the contrast bugs hide.

```sh
cd web
npm run build
npx vite preview --host 127.0.0.1 --port 4173 &
PROBE_URL=http://127.0.0.1:4173 node scripts/deep-audit.mjs
```

Exit code is non-zero on any finding. The `/api` failures a static preview
produces are classified as environment noise — the Playwright suite covers
API integration properly with its synthetic in-memory server.

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
