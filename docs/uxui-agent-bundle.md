# PRC Ops — UX/UI Redesign Brief + Source Bundle

> **You have NO access to the repo or local files.** Everything you need is
> inline in this document. Do not ask to "open" or "read" files — they are
> pasted below under `===== FILE: <path> =====` markers. When you propose
> edits, return full file contents or precise diffs against what is pasted here.

## Who you are

Senior product designer + frontend engineer redesigning **PRC Ops**: a
Thai-first, sunlight-readable **PWA** for construction/project operations,
used primarily on a **phone, outdoors**, by field operators and PMs. The
**work package (WP)** is the center of all information — its identity is never
truncated; scope/time/resource always map against it.

## Hard constraints (non-negotiable)

- Thai-first UI — Thai is primary, not a translation layer.
- Sunlight/outdoor readability: high contrast, large tap targets.
- PWA on phone is the primary device. Mobile-first, then scale up.
- WP-centric: WP identity always full and primary on its screens.
- Tailwind 4 + shadcn-style primitives. Theme through tokens in
  `src/app/globals.css` — never hardcode colors in components.

## Process rules (project policy)

- Any nav OR design change updates `docs/ui-conventions.md` AND
  `docs/site-map.md` in the SAME change.
- Match existing code style: comment density, naming, idiom.

## Your task this session

1. Read the DOCS section → give me a 10-bullet summary of the app.
2. Read the DESIGN CANON → tell me the current visual language in your words.
3. Produce an ordered redesign plan: token changes first (globals.css), then
   shell components (highest leverage — touch every screen), then a
   component-by-component pass. Before/after intent per item.
4. WAIT for my approval before producing code.

The full component surface is 47 files; only the shell-level ones are pasted
(they gate the look of every screen). The rest are listed in the MANIFEST at
the end — ask me for any by name and I will paste it.

---

# PART 1 — DOCS (understand the system)

===== FILE: CLAUDE.md =====

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Before writing routing, caching, server action, or middleware code, web-search the current Next.js App Router docs. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Project rules

- This project uses TDD. For any new feature, write a failing test first, then make it pass. No production code without a test.
- **When writing new feature code, your first message in the unit must be the failing test, not the implementation. State explicitly: "Writing failing test first."** Implementation written before the test is rejected in review.
- Database is Postgres via Supabase. Every table has Row Level Security enabled. No exceptions.
- The audit_log table is append-only. Never UPDATE or DELETE rows in audit_log.
- DC entries and photo_logs are append-only. Edits happen via supersede (new row pointing at old via `superseded_by` FK), never UPDATE.
- Photos are stored unmodified. Watermarks are rendered on demand server-side. Never overwrite the original file.
- All status fields use Postgres enums, never free-text strings.
- Foreign keys are typed and validated. No mixed-content reference columns.
- TypeScript: use `unknown` and narrow. Never widen with `any`.
- Server Components by default. Adding `'use client'` requires justification in the PR description.
- Before implementing any feature, scan the ADR index `/docs/decisions/README.md` and read in full the ADRs that touch the area you're changing. Architecture decisions there override defaults. (You do not need to read all of them every time — target the relevant ones.)
- Before changing the database, schema, Storage, or DB roles, read `/docs/policies/change-management.md` — binding. All such changes go through a migration + reviewed PR + `supabase db push`; never the dashboard SQL editor or toggles.
- Commit messages follow Conventional Commits (feat:, fix:, test:, docs:, refactor:, chore:).

## Scope discipline

- **Implement exactly what the spec requests. Do not add fields, helpers, error handlers, validation, or "while I'm here" improvements.** Out-of-scope additions are rejected in review regardless of perceived value.
- If you spot something worth doing that's out of scope, list it in the progress tracker's "open questions" section. Do not implement it.
- Discovering a missing requirement mid-unit is not permission to expand the spec. Stop, surface it, write a follow-up spec.

## Library and architecture discipline

- Do NOT silently swap libraries, frameworks, or fundamental approaches when implementing a spec.
- If a library named in the spec proves unworkable, STOP and report the blocker. Do not implement a fallback unless explicitly approved.
- "It was simpler with X" is not a reason. The spec specifies the library because the spec specifies the question being answered.
- Architectural choices that are not in the spec must be raised before implementation, not after.
- This rule applies equally to spikes and production code.

## When blocked

Do not improvise. Output:

1. What you tried
2. What failed and why
3. What you'd do next if approved
4. Confidence percentage on the proposed next step

Then wait. Do not proceed without explicit acknowledgement.

## Communication

- When clarification is required, ask one question at a time. Address what you can first.
- State confidence as a percentage when guessing.
- Do not list 10 questions. The one that most blocks progress comes first.

## Feature workflow

Every feature unit follows this loop:

1. **Spec.** Read the numbered spec at `/docs/feature-specs/NN-name.md` in full (find it via the index `/docs/feature-specs/README.md`). If no spec exists, stop — ask for one. Implement exactly what the spec says.
2. **Progress tracker.** Update `/docs/progress-tracker.md`: mark the unit as in progress, note the start time.
3. **Test first.** Write the failing test. State "Writing failing test first."
4. **Implement.** Make the test pass. Nothing more.
5. **Verify.** Run the spec's verification checklist. Run `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
6. **Update tracker.** Mark unit complete in `/docs/progress-tracker.md`. Note decisions made, open questions surfaced.
7. **Stop.** Do not start the next unit in the same session.

## Roles

The `users.role` enum contains 10 values — 9 PRC roles plus a `visitor` default state for new signups:

- `site_admin` (SA) — v1 ✅
- `project_manager` (PM) — v1 ✅
- `super_admin` — v1 ✅ — full-access operator role; admitted to every v1 surface, lands on `/pm`
- `project_coordinator` (PC) — v2
- `procurement` — v1 ✅ — onboarded onto the purchasing worklist (`/requests`) in spec 70
- `technician` — v2 or v3
- `hr` — v3
- `subcon_manager` — v3
- `accounting` — v3
- `visitor` — v1 — default for new signups; awaits manual promotion to a real role (see ADR 0010)

Do not add or remove enum values without an ADR. After LINE login, `roleHome()` (`src/lib/auth/role-home.ts`) routes by role: `site_admin`→`/sa`, `project_manager`/`super_admin`→`/pm`, `procurement`→`/requests`; every other role (incl. `visitor`) → `/coming-soon`, a static page that acknowledges the account exists and says tools for that role are not yet live. v2 work removes the redirect for whichever role is being served.

## Operating environment

- The operator is non-developer, working from cloud PC and mobile.
- Merges to `main` and `git push` are laptop-only operations. Do not propose them from sessions that may be mobile.
- Never auto-authenticate `gh`. Never push without explicit confirmation.
- PRs are opened manually in the browser.
- After merge: pull main locally, delete merged branches.

## Skills, agents, and hooks

- Skills at `.claude/skills/` provide procedural knowledge. Currently installed: `supersede-pattern`. Load them when touching matching areas.
- Hooks at `.claude/hooks/` enforce constraints automatically. Currently installed: `protect-audit-log.js` (blocks edits to audit_log migrations unless `CLAUDE_ALLOW_AUDIT_LOG_EDIT=1` is set). Do not attempt to bypass.
- Subagents are not yet installed. Add when a recurring specialized review need emerges (e.g., RLS reviews across many tables).

## Commands

Package manager is **pnpm** (`pnpm@10.x`, Node 22+). All commands run from the repo root.

| Command                       | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `pnpm dev`                    | Next.js dev server (localhost:3000)                    |
| `pnpm build`                  | Production build                                       |
| `pnpm lint` / `pnpm lint:fix` | ESLint                                                 |
| `pnpm typecheck`              | `tsc --noEmit` — strict; run before pushing            |
| `pnpm test`                   | Vitest run — `tests/unit/` + `tests/integration/` only |
| `pnpm test:watch`             | Vitest watch mode                                      |
| `pnpm test:e2e`               | Playwright E2E (auto-starts `pnpm dev`)                |
| `pnpm db:test`                | pgTAP database tests against the linked remote DB      |
| `pnpm format`                 | Prettier write                                         |

**Run a single unit test:** `pnpm test tests/unit/env.test.ts`, or filter by name with `pnpm exec vitest run -t "rejects invalid"`.

**CI** (`.github/workflows/ci.yml`) runs only `lint`, `typecheck`, and `test`. It does **not** run `test:e2e`, `db:test`, or the spike suite — run those locally when touching the relevant code. A husky pre-commit hook runs `lint-staged` (eslint + prettier on staged files).

### Database workflow

The local Supabase Docker stack is not used (see ADR 0006). Work against the linked remote project:

1. `pnpm db:link` — link the CLI to the Supabase project (one time per machine; requires `supabase login`).
2. Add a migration file under `supabase/migrations/` (timestamp-prefixed `.sql`).
3. `pnpm db:push` — apply migrations to the remote DB.
4. `pnpm db:types` — regenerate `src/lib/db/database.types.ts` from the live schema.
5. `pnpm db:test` — run pgTAP tests.

## Architecture

A single **Next.js 16 App Router** application serving two audiences from one codebase: site admins (PWA-optimised routes) and project managers (standard web routes). Backend is **Supabase** — Postgres, Auth (LINE OAuth), and Storage. Domain: construction project operations — progress photos, work-package approval, PDF reports. See `README.md` and ADR 0005 for v1 scope.

### Supabase clients — pick the right one

Three clients in `src/lib/db/`; choosing wrong is a security bug:

- `browser.ts` — `createBrowserClient`, anon key. Client Components.
- `server.ts` — `createServerClient` wired to async `cookies()`, anon key. Server Components / route handlers. Respects the user's RLS context. **Async** — `await createClient()`.
- `admin.ts` — service-role key, **bypasses RLS**. `server-only`. Use only for trusted server-side operations that genuinely need to skip RLS; never from anything reaching the browser bundle.

### Environment variables

Env validation is split so client bundles never include or validate server secrets:

- `src/lib/env.ts` — client-safe schema (`NEXT_PUBLIC_*` only). Exports `clientEnv` and `parseClientEnv`. Importable anywhere, including Client Components.
- `src/lib/env.server.ts` — server-only schema. Starts with `import "server-only"` so any client-side import fails the build. Exports `serverEnv` and `parseServerEnv`. Import only from server code (Route Handlers, Server Components, `proxy.ts`, server-only utility modules).

Both modules validate via Zod at import time and **throw on missing/invalid vars** — a misconfigured env fails fast at boot. Server code that needs both client and server vars (e.g. `src/lib/db/admin.ts`) imports both: `clientEnv` from `@/lib/env` for `NEXT_PUBLIC_*` values, `serverEnv` from `@/lib/env.server` for secrets. Never read `process.env` directly. Copy `.env.example` to `.env.local` for local dev.

### Database schema & immutability

Core tables (see `docs/specs/v1-entities.md` for the original five, and the ADRs for the rest): `projects`, `work_packages`, `photo_logs`, `users`, `audit_log`, `approvals`, `reports`, `deliverables` (ADR 0016), `purchase_requests` (ADR 0022/0025 — also writable by the `appsheet_writer` DB role). Schema lives in `supabase/migrations/`.

- **`users`** — `id` is both PK and FK to `auth.users(id)`. A trigger on `auth.users` insert auto-creates a `public.users` row (role defaults to `visitor`). See ADR 0007 and ADR 0010.
- **`audit_log`** — append-only, enforced in three layers: REVOKEd UPDATE/DELETE privileges, RLS with no UPDATE/DELETE policies, and a `BEFORE UPDATE/DELETE/TRUNCATE` trigger that raises `P0001`. See ADR 0004.
- **Supersede pattern** — `photo_logs` (and future `dc_entries`) are append-only; a logical edit inserts a new row with `superseded_by` pointing at the row being replaced. The replaced row is never modified. Current-state queries use an anti-join (`WHERE NOT EXISTS (... newer.superseded_by = pl.id)`), not `IS NULL`. See ADR 0004 (write pattern) and ADR 0009 (read pattern correction).

### Database testing (pgTAP)

Tests are pgTAP `.sql` files in `supabase/tests/database/`, run via `scripts/run-pgtap.ts` (`pnpm db:test`) against the linked remote DB — no Docker. Each file is standard pgTAP form (`begin; select plan(N); … select * from finish(); rollback;`). The runner rewrites assertion `select`s into a temp collector table (the Management API returns only the last result set) and **refuses any file containing `COMMIT` or missing a closing `ROLLBACK`** so no test data persists. Read ADR 0006 before extending the runner. Requires a linked CLI session — `pnpm db:link` first.

### Tests

- `tests/unit/`, `tests/integration/` — Vitest, jsdom env (`vitest.config.ts`). The default `pnpm test` suite.
- `tests/e2e/` — Playwright (`playwright.config.ts`), chromium/firefox/webkit.
- `supabase/tests/database/` — pgTAP (above).
- `spikes/` — time-boxed experiments validating one ADR question each. Separate config (`vitest.spike.config.ts`, `pnpm spike:test`), **excluded from `pnpm test` and CI** by design — validated once, then frozen.

### Conventions

- Path alias `@/*` → `src/*`.
- `src/components/ui/` — shadcn/ui primitives only (new-york style, lucide icons). `src/components/features/` — feature components.
- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`.

### Architecture Decision Records

`docs/decisions/` holds the ADRs — they override defaults. **The full, current list with one-line titles is `docs/decisions/README.md`** (40 ADRs, numbered through 0043 — 0023, 0024, 0029 were never authored). Scan that index and read the ones relevant to your change in full; don't rely on memory of the numbering.

===== FILE: README.md =====

# prc-ops

Construction project operations platform for PRC site admins and project managers. The UI is Thai-first (spec 14) — users are Thai construction-site staff.

- **Site admins** upload progress photos, track work packages (grouped by deliverable), and raise purchase requests from the field.
- **Project managers** review and approve work packages, decide purchase requests, and generate PDF reports.
- **Procurement (back office)** records purchases and deliveries — now an in-app role that signs in and works the purchasing worklist at `/requests` (spec 70, ADR 0034/0038). Writing directly to the database via the restricted AppSheet Postgres role (ADR 0018/0025) is a coexisting legacy path being retired by atrophy (ADR 0034).

Built with Next.js 16 App Router, Supabase (Postgres + Auth via LINE Login + Storage), Tailwind CSS v4, and shadcn/ui. A separate worker (`worker/`, deployed on Railway) generates the PDF reports.

## Local Setup

**Prerequisites:** Node.js 22+, pnpm 10+

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Commands

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm dev`           | Start development server                |
| `pnpm build`         | Build for production                    |
| `pnpm lint`          | Run ESLint                              |
| `pnpm typecheck`     | Run TypeScript type-check               |
| `pnpm test`          | Run unit and integration tests (Vitest) |
| `pnpm test:watch`    | Run tests in watch mode                 |
| `pnpm test:coverage` | Run tests with coverage report          |
| `pnpm test:e2e`      | Run E2E tests (Playwright)              |
| `pnpm format`        | Format all files with Prettier          |

## Running Tests

```bash
# Unit and integration tests
pnpm test

# E2E tests (requires dev server or built app)
pnpm test:e2e
```

## Project Structure

```
src/
  app/                  Next.js App Router pages and layouts
  components/
    ui/                 shadcn/ui primitives only
    features/           Feature-level components
  lib/                  Shared utilities (i18n labels, status colors, domain helpers)
  lib/db/               Database clients (browser / server / admin) and generated types
supabase/
  migrations/           Schema (timestamped SQL; the only write path to the DB)
  tests/database/       pgTAP tests (`pnpm db:test`)
worker/                 PDF report worker (isolated subproject, Railway)
tests/
  unit/                 Vitest unit tests
  integration/          Vitest integration tests
  e2e/                  Playwright E2E tests
docs/
  decisions/            Architecture Decision Records (ADRs) — binding
  feature-specs/        Numbered, locked feature specs
```

## Where to start reading

1. [`CLAUDE.md`](CLAUDE.md) — project rules, workflow, architecture invariants (binding).
2. [`docs/v2-handoff.md`](docs/v2-handoff.md) — the start-here context bridge.
3. [`docs/decisions/README.md`](docs/decisions/README.md) — the ADR index (one-line titles, 0001 through the latest); read the ADRs relevant to your change before implementing. The directory is the source of truth.
4. [`docs/feature-specs/README.md`](docs/feature-specs/README.md) — the feature-spec index (find the numbered spec for the unit you're building).
5. The tail of [`docs/progress-tracker.md`](docs/progress-tracker.md) — the most recent unit's state and its open-questions queue (older history archived in [`docs/progress-archive.md`](docs/progress-archive.md)).

===== FILE: docs/sdd-2026-06.md =====

# Software Design Description — prc-ops (June 2026, post-spec-65)

**Purpose of this document.** A single, comprehensive statement of how the
system is designed and why — written 2026-06-13 so a human can RECHECK the
working understanding the build sessions operate on. Where this document and
an ADR/spec disagree, the ADR/spec wins and this document is the bug; §11
lists the points most worth a human eye. Pointers go to binding docs rather
than duplicating them.

---

## 1. System context

**Domain.** Construction project operations for a Thai contractor. Field
evidence (progress photos), work-package approval, PDF reporting, purchasing
(request → approve → purchase → ship → deliver), daily labor capture,
contractor/supplier masters.

**Actors.**

| Actor                             | Access                                                                                                                           | Surface                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Site admin (SA)                   | LINE login, role `site_admin`                                                                                                    | PWA-optimised routes (`/sa/...`), photo capture, request creation   |
| Project manager (PM)              | LINE login, `project_manager`                                                                                                    | Review queue `/pm`, decisions, reports, hold toggle, labor view     |
| super_admin                       | LINE login                                                                                                                       | Every PM surface + PM tab set; lands on `/pm`                       |
| Back office (procurement)         | **Not yet reachable in-app** (recorded seam) — works via AppSheet (`appsheet_writer` DB role) during the ADR-0034 atrophy window | purchase/delivery fact entry                                        |
| Subcontractor crews / technicians | **No logins, by doctrine** (ADR 0033, spec 46 C4)                                                                                | evidence enters via SA's phone; capability links are a future probe |
| Visitor                           | default role at signup (ADR 0010)                                                                                                | `/coming-soon` until promoted (manual SQL today)                    |

**External systems.** LINE (OAuth login; Messaging API push via outbox — env-gated,
not yet activated), Vercel (hosting, `main` auto-deploys), Supabase
(Postgres + Auth + Storage + pg_cron/pg_net + Vault), Railway (frozen legacy
PDF worker — optional since ADR 0040, pause-safe), AppSheet (back-office
write path being retired by atrophy, ADR 0034), GitHub (source; push from
cloud PC is a standing instruction).

**Tenancy.** Instance-per-customer (ADR 0035). Binding "tenant-clean" rule:
no customer literals in `src/` — names/codes are data. Runbook gets written
during the first real clone.

## 2. Stack and repo shape

Next.js 16 App Router + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) + Tailwind v4 + Supabase JS v2. pnpm. Vitest
(jsdom) for unit/integration, Playwright for e2e, pgTAP for DB. Husky +
lint-staged pre-commit. CI runs lint/typecheck/unit only.

```
src/app          routes (App Router; server components by default)
src/lib          domain + infrastructure modules (see §6)
src/components   ui/ = shadcn primitives (input, textarea, skeleton)
                 features/ = all feature components
supabase/        migrations (timestamped SQL), pgTAP tests, config
tests/           unit/ integration/ e2e/ helpers/
worker/          FROZEN Railway PDF worker (byte-untouched fallback)
docs/            ADRs (decisions/), feature specs, tracker, conventions
```

Path alias `@/*` → `src/*`. The `worker/` package is excluded from the root
tsconfig and deliberately never edited (touching it redeploys Railway).

## 3. Core data doctrine (the product's foundation)

1. **WP-centric.** The work package is the center of information; scope,
   time, resource all map against it. New features surface on WP detail
   first; list pages are secondary entry points (operator principle,
   recorded 2026-06-13; spec 57 no-truncation rules protect WP identity).
2. **Append-only evidence.** `photo_logs`, `labor_logs`, `photo_markups`,
   `purchase_request_attachments` are never UPDATEd. A logical edit = new row
   with `superseded_by` → old row; a logical removal = tombstone row (payload
   NULL + `superseded_by`, ADR 0015). Current-state reads use the anti-join
   (ADR 0009), **never `superseded_by IS NULL`**, plus a tombstone filter.
   Newer tables read via DB-side `_current` views (photo_markups,
   pr-attachments); the two older in-memory filters live in
   `current-photos.ts` / `current-logs.ts`.
3. **audit_log is append-only at three layers**: REVOKEd UPDATE/DELETE, RLS
   with no such policies, and a BEFORE trigger raising P0001 (ADR 0004).
4. **Photos are stored unmodified** — watermarks render on demand
   server-side; spec 34's client downscale (2000px / JPEG 0.8) happens
   _before_ upload, so the downscaled file IS the original by ADR 0036
   decision. Markup (spec 51) is an overlay table (`photo_markups`, strokes
   normalized 0..1 + comments); photo bytes are never touched.
5. **Statuses are Postgres enums; FKs typed; no mixed-reference columns.**
6. **Deliberately mutable exceptions** (each with an ADR): `work_packages`
   owner/contractor metadata (ADR 0032/0033), `notification_outbox` (outbox
   semantics, ADR 0037), `login_handoffs` (handshake state, ADR 0041),
   project name/status via RPC (ADR 0042), `reports` rows, worker/supplier/
   contractor masters.

## 4. Security model

**Auth.** LINE OAuth → Supabase Auth. `auth.users` insert trigger creates
`public.users` (role `visitor`). JWT claims verified locally (ADR 0021,
`getClaims`). Two login paths: the browser flow, and the PWA device-code
handoff (ADR 0041; specs 42–45 arc): `login_handoffs` table (zero-access
outbox posture, 10-min TTL), `POST /auth/handoff/start` + `/poll` (atomic
claim, session minted ONTO the poll response so `sb-*` cookies land in the
standalone PWA's cookie jar), device_code resumed from localStorage because
iOS kills backgrounded PWAs (spec 44), same-window navigation because
standalone PWAs have no tab model (spec 45).

**Three Supabase clients** (`src/lib/db/`), all typed with `<Database>`:
`browser.ts` (anon, Client Components), `server.ts` (anon + cookies, RLS
context, async), `admin.ts` (service-role, `server-only`, bypasses RLS —
only for trusted server-side ops like signed-URL minting).

**Env split**: `env.ts` (client-safe `NEXT_PUBLIC_*`) / `env.server.ts`
(`server-only`, throws at import on bad config; `optionalNonEmpty` treats
empty string as absent). Never read `process.env` directly (one recorded
exception: `sw-register` reads `NODE_ENV`).

**RLS everywhere**; role logic centralized: `requireRole()` page gate,
`roleHome()`/`projectHubHref()` landing logic, and (spec 65) the canonical
`PM_ROLES` / `SITE_STAFF_ROLES` arrays — all in `src/lib/auth/`. Server
actions gate via `getActionUser()` (spec 65, `action-gate.ts`).

**Privilege-sensitive writes go through SECURITY DEFINER RPCs**, not direct
table grants: `update_my_display_name`, `set_work_package_contractor`,
`record_purchase` / `record_shipment` (coalesce semantics — omitted facts
preserved), `log_labor_day` (advisory-lock uniqueness), `correct_labor_log`,
`create_worker`/`update_worker`/`set_worker_day_rate`,
`update_project_settings` (name+status only; code immutable per ADR 0014),
`claim_next_report` (FIFO + SKIP LOCKED). Purchase-request fact columns are
column-scope-granted away from `authenticated` entirely (migration 20260616000400) — app roles can only reach them via RPC; `appsheet_writer`
keeps its frozen column set.

**Confidentiality split that matters:** worker rate columns have ZERO
authenticated grant (spec 46 C3) because sa/pm share the `authenticated` DB
role — rates are readable only via the admin client behind
`requireRole(pm/super)`. Any future money column (billing amounts) inherits
this posture.

**Storage**: 3 private buckets (`photos`, `pr-attachments`, `reports`).
Reads happen ONLY via service-role-minted 120s signed URLs (generic core in
`storage/signed-urls.ts` since spec 65); the application-layer authorization
is the row-level SELECT RLS the caller already passed.

## 5. Key runtime flows

**Photo upload (SA, three uploaders: phase / delivery-confirmation /
request-attachment).** Client downscale (spec 34; every failure falls back to
original passthrough) → IDB-backed offline queue (spec 35/37: survives
crash/close; `QueuedUpload` discriminated union dispatches per kind;
foreign-user items are skipped AND read-only in the discard UI — shared-device
guard) → idempotent replay end-to-end: storage 409 tolerated, DB 23505 replay
verified identity-complete (id+wp+phase+path; spec 65 extracted
`findLandedAttachment` for the attachment flavor), replay-confirm runs BEFORE
status gates so decided parents can't wedge items. First During photo flips
WP `not_started → in_progress` (spec 52; deliberately does NOT release
`on_hold`); first After photo flips to `pending_approval` (v1 core).

**Approval.** PM reviews `/pm/work-packages/[id]` → decision row appended
(supersede pattern) → WP status derived. Hold toggle = PM/super, USER-session
client (RLS already admits), release re-derives from current During photos.

**Purchasing.** SA/PM raise request (WP-embedded form, spec 29) → PM decides
→ back office records purchase/shipment via RPC (in-app forms, spec 33) or
AppSheet (atrophy window) → on_route + confirmation photo auto-delivers via
SECURITY DEFINER trigger (spec 24). Cancellation + PR numbers (spec 27).
Status is DERIVED from facts (purchased_at, shipped_at, delivered_at) — the
stepper renders facts, not a hand-set status.

**Reports.** PM clicks generate → row inserted (`requested`) → the page
itself claims via `claim_next_report` RPC and builds in-request (spec 39 fast
path, pdfkit + base64 Sarabun, pinned ^0.17.2) → signed download URL with
Bangkok-dated filename; blob/share-sheet flow because `window.open` after
await dies in standalone PWAs (spec 60). `reap_stale_reports` cron (\*/5)
flips stale `processing` AND stale `requested` → failed — wedge-proof and
makes pausing Railway safe. Railway worker = frozen fallback that ignores
`reports.params` (recorded risk window). Report content control via
`reports.params` jsonb (spec 61, `parseReportParams` never throws).

**Notifications (built, dark).** 4 failure-swallowing SECURITY DEFINER
capture triggers → `notification_outbox` (zero user access) → pg_cron minute
schedule pings `/api/notifications/drain` (Vault-stored URL+secret;
timingSafeEqual; 503 until env set) → LINE Messaging API push. Claim/reclaim
via `sending` status. Activation = operator checklist §8.

**Navigation contract** (`docs/site-map.md` — nav changes must update it
same-unit): `/sa/projects/[id]` is THE project page for every role; back
affordances return to the entering hub (`projectHubHref`); bottom tabs by
role; `/workers` reachable by URL only (recorded seam).

## 6. Module map (src/lib, post-spec-65)

| Area                        | Modules                                                                                                                                                                                           | Notes                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------- |
| Shared primitives (spec 65) | `validate/uuid`, `dates` (bangkokTodayIso, ISO_DATE_REGEX), `storage/buckets`, `storage/signed-urls` (generic core), `db/enums` (canonical enum aliases), `auth/action-gate`                      | older homes re-export for compat                                                                                   |
| Auth                        | `auth/require-role`, `auth/role-home` (+ PM_ROLES/SITE_STAFF_ROLES), `auth/line-*`, `auth/handoff-flow`, `auth/verify-line-id-token`                                                              | role doctrine lives in role-home                                                                                   |
| DB                          | `db/browser                                                                                                                                                                                       | server                                                                                                             | admin`, `db/database.types` (generated — regen then prettier then diff; regen drops semicolons) | all typed `<Database>` |
| Photos                      | `path` (exts, storage path, PHOTO_ACCEPT_MIME), `downscale`, `phases`, `current-photos`, `phase-progress`, `signed-urls`, `tombstone`, `transitions`, `upload-queue` (+`-idb`), `validate-markup` |                                                                                                                    |
| Purchasing                  | `validate-purchase-request`, `validate-record-purchase`, `columns` (PR_LIST_COLUMNS), `attachment-*`, `back-office`, `pending-order`, `units`                                                     |                                                                                                                    |
| Labor                       | `actions` (server actions live in lib here), `validate`, `dates` (re-export), `current-logs`, `fetch-zone-data`, `group-workers`, `types`                                                         | rates = admin-client-only                                                                                          |
| Reports                     | `build-pdf`, `run-report-job`, `params`, `predicates`, `file-name`, `sarabun-font` (base64; fs reads die in serverless)                                                                           | pdfkit pinned                                                                                                      |
| Notifications               | `compose-notification`, `drain-policy`, `line-push`, `payload`, `resolve-recipients`                                                                                                              |                                                                                                                    |
| UI                          | `ui/classes` (canonical chrome constants, byte-pinned by test), `ui/page-width` (PAGE_MAX_W), `status-colors`, `i18n/labels` (Thai labels, Buddhist-era dates, Bangkok-pinned)                    |                                                                                                                    |
| Other                       | `approvals/*`, `deliverables/*`, `work-packages/hold                                                                                                                                              | list-filter`, `projects/validate-settings`, `users/display-names`, `wp-import/parse`, `env`, `env.server`, `utils` |                                                                                                 |

## 7. UI design system (binding: `docs/ui-conventions.md`)

Thai-first single-language UI (spec 14); Sarabun 400/500/600; sun-readable
light theme (spec 20): zinc-50 wash, white rounded-xl cards, ink zinc-900,
links blue-700 only, primary fills slate-900, amber brand accent, solid
status pills identifiable by hue at arm's length. 44px tap minimum.

Structural invariants: every route renders **PageShell** — body is LOCKED
(`h-full overflow-hidden`) and the shell's `<main>` is the only scroller
(spec 64, the iOS-PWA bounce fix; hand-rolled `<main>` = review reject).
Detail pages render **DetailHeader** (spec 63). One **PAGE_MAX_W** token on
every content page (spec 41; type-enforced via component props; exceptions
login/profile/coming-soon `max-w-md`). Chrome class strings come from
**classes.ts** (spec 63 + 65; copying inline = review reject; all values
byte-pinned in `ui-classes-spec65.test.ts`). Z-stack: headers 20 < queue
banner 30 < tab bar 40 < scrims 50. WP names never truncate on detail (full
wrap), `line-clamp-2` in lists (spec 57).

## 8. Testing strategy

| Suite                                                                                              | Where                             | Count (2026-06-13) | Runs                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------ | --------------------- |
| Unit/integration (Vitest, jsdom; `server-only` neutralized once via resolve.alias stub — spec 65)  | `tests/unit`, `tests/integration` | 541 in 75 files    | `pnpm test`, CI       |
| E2E (Playwright, 3 browsers, auto-starts dev)                                                      | `tests/e2e`                       | 27                 | local only            |
| pgTAP against the LINKED REMOTE DB (no Docker, ADR 0006; runner refuses COMMIT / missing ROLLBACK) | `supabase/tests/database`         | 739                | `pnpm db:test`, local |
| Spikes (frozen one-time validations)                                                               | `spikes/`                         | —                  | excluded by design    |

TDD is binding: failing test first for any new behavior. Refactors lean on
the existing suites as behavior pins (spec 65's contract). Recurring lesson
bank: grep ALL pgTAP pins when an enum/posture changes; PDF tests need
`@vitest-environment node`; component tests rendering server-action importers
needed `vi.mock("server-only")` — obsolete since the spec-65 global stub.

## 9. Operations

- **Deploy**: commit to `main` → push → Vercel auto-deploy. Standing operator
  instruction (2026-06-11): commit AND push without asking; confirm before
  risky pushes (schema migrations, worker changes). DB changes:
  migration file → `pnpm db:push` → `db:types` → `db:test`
  (`docs/policies/change-management.md` is binding; never the dashboard).
- **Crons** (Supabase pg_cron): notification drain (every minute, silent
  no-op until §8 activation), `reap_stale_reports` (\*/5). Railway cron =
  legacy fallback, safe to pause.
- **AppSheet posture** (ADR 0034 amended): retirement by atrophy — dual-write
  window; demote when audit principal split shows in-app ≥80–90% for weeks or
  on a forcing event. Column set frozen; 3 operator console TODOs deferred
  indefinitely (broken AppSheet saves on touched columns = accepted risk —
  recorded decision, do not re-raise).
- **Operator-owed queue** (live as of 2026-06-13): LINE activation (§8), one
  outdoor phone pass (specs 34/35/37), eyeball specs 53–65 on deploy, report
  try-out, bounce re-test, optional Railway pause.
- **Known gaps with no ADR yet**: PITR/Storage backup verification +
  migration rehearsal stage (architecture-revision §3.5) — top of the CEO
  review's now-list.

## 10. Recorded seams and deferred work (the honest backlog)

From the tracker tail + spec 65: procurement role unreachable; `/sa` vs
`/pm/projects` dual hubs; `/workers` has no nav entry; labor P2 (cost freeze,
PM cost view, variance strip) + billing status; photo captions column (needs
operator word); PWA themeColor seam; dialog a11y; pagination; DB CHECK length
caps; dark-mode toggle decision; real logo asset; markup-in-PDF; LINE notify
on markup comment; lightbox preload. Spec-65 deferred refactors: uploader
pipeline extraction (+`uploadPhotoIdempotent`; component tests FIRST),
ConfirmActionButton trio, ProjectListSection hub merge, PageSkeleton→PageShell
(visual — operator sign-off), parseRequestsSearchParams, requireSessionProfile,
serverEnv test-mock dedup, e2e parametrization, `Pick<Row>` prop types, test
gaps (run-report-job, labor error mapping, stager/runner/roster), one found
byte-match (purchase-request-form unit select = FIELD_SELECT).

## 11. Points a human should recheck (highest-value verification)

1. **ADR 0036 reading**: this doc states the downscaled upload IS the stored
   original (no full-res copy kept). Confirm that matches intent.
2. **Hold semantics** (spec 52): first During photo does NOT release
   `on_hold`; release re-derives from current photos. Confirm that is still
   the wanted behavior.
3. **AppSheet TODOs**: treated here as "accepted risk, do not re-raise."
   Confirm the deferral still stands.
4. **Billing granularity** (CEO review #2): per-WP or per-deliverable
   (งวดงาน)? This single answer shapes the next domain table.
5. **Backup posture** (§9 last bullet): nothing in the repo proves PITR tier
   or photo-bucket backups exist. If you have verified them outside the
   repo, record it; if not, it is the most important hour on the board.
6. **Procurement user**: is there a real person to onboard, and do they
   accept working in-app instead of AppSheet?
7. **Railway**: cron pause is recorded as safe-anytime. Confirm whether you
   want it paused now (one console click) ahead of the deletion spec.

===== FILE: docs/app-workflows-and-roles.md =====

# PRC Ops — Workflows & Role Permissions

> Generated reference, 2026-06-13. Maps every end-to-end workflow in the app and the
> full role/RLS permission surface. Sourced from route guards (`src/app/**`), server
> actions, `src/lib/**`, and the RLS migrations under `supabase/migrations/`. Where a
> claim cites a file, that file is authoritative — re-read it before relying on a detail
> for a code change.

---

## Contents

- [Part 0 — How access is enforced](#part-0--how-access-is-enforced)
- [Part 1 — Workflows](#part-1--workflows)
  - [1. Authentication & session](#1-authentication--session)
  - [2. Work packages & approvals](#2-work-packages--approvals)
  - [3. Photos, markups & reports](#3-photos-markups--reports)
  - [4. Purchasing (purchase requests)](#4-purchasing-purchase-requests)
  - [5. Labor & payroll](#5-labor--payroll)
  - [6. Projects, clients, team, profile & notes](#6-projects-clients-team-profile--notes)
  - [7. Notifications (LINE)](#7-notifications-line)
- [Part 2 — Role permission tables](#part-2--role-permission-tables)
  - [Roles legend](#roles-legend)
  - [A. Route / surface access](#a-route--surface-access)
  - [B. Action capability matrix](#b-action-capability-matrix)
  - [C. Table-level RLS matrix (authoritative)](#c-table-level-rls-matrix-authoritative)
  - [D. Storage buckets](#d-storage-buckets)
  - [E. Special principals & RPCs](#e-special-principals--rpcs)

---

## Part 0 — How access is enforced

Three independent layers gate every action. A request must pass all that apply:

1. **Route guard** — each protected page calls `requireRole([...])`
   ([require-role.ts](src/lib/auth/require-role.ts)). Wrong role → redirect to the
   caller's `roleHome()`. `/profile` and `/coming-soon` are the exceptions: auth-only
   (any logged-in role), no role gate.
2. **RLS at the database** — every table has Row Level Security. Policies read the
   caller's role through the `public.current_user_role()` SECURITY DEFINER helper
   (ADR 0011, [fix_users_rls_recursion](supabase/migrations/20260523213246_fix_users_rls_recursion.sql)),
   never a self-join (which once caused infinite recursion). Role is the **only**
   granularity in v1 (ADR 0013) — there is no per-project or per-WP membership gate,
   except the few explicit own-row cases noted below.
3. **Append-only triple enforcement** — for `audit_log`, `photo_logs`, `labor_logs`,
   `photo_markups`, `purchase_request_attachments`: (a) UPDATE/DELETE privileges
   REVOKED from `authenticated`, (b) no UPDATE/DELETE RLS policies, (c) a `BEFORE
UPDATE/DELETE/TRUNCATE` trigger raises `P0001` — which catches even the
   service-role bypass. Edits happen by **supersede**: insert a new row whose
   `superseded_by` points at the old one; a removal is a _tombstone_ (payload NULL +
   `superseded_by` set). Current-state reads use an anti-join, not `IS NULL` (ADR 0009).

**Money isolation.** Rate/cost columns (`workers.day_rate`,
`labor_logs.day_rate_snapshot`, `wp_labor_costs.own_cost/dc_cost`,
`projects.budget_amount_thb`) have **zero** `authenticated` SELECT grant. They are read
only by server code behind a `requireRole(PM/super)` gate using the service-role admin
client, and written only through role-gated SECURITY DEFINER RPCs. Field roles can never
see money even with a hand-crafted query.

**`roleHome()` landing** ([role-home.ts](src/lib/auth/role-home.ts)):
`site_admin → /sa`, `project_manager`/`super_admin → /pm`, `procurement → /requests`,
everyone else (`visitor` default, `project_coordinator`, `technician`, `hr`,
`subcon_manager`, `accounting`) → `/coming-soon`.

---

## Part 1 — Workflows

### 1. Authentication & session

Custom LINE OAuth flow (ADR 0012); no Supabase social provider. Two login paths share
one callback.

**1.1 Browser LINE login**

- Trigger: user taps login in a browser tab.
- `GET /auth/line/start` → mints a CSRF `state` cookie, 302 to LINE authorize.
- LINE → `GET /auth/line/callback?code&state` → validates state cookie (single-use),
  exchanges `code` for an `id_token`, verifies the HS256 signature locally with
  `LINE_CHANNEL_SECRET`, asserts `iss/aud/exp/sub`.
- Admin client `createUser` on synthetic email `line_<sub>@line.local` (idempotent); a
  trigger auto-creates `public.users` with role `visitor` (ADR 0007/0010). Magic-link +
  `verifyOtp` mints the `sb-*` session cookies.
- NULL-only profile write (`line_user_id`, `full_name`), avatar refresh, then 302 by role.
- Files: [auth/line/start](src/app/auth/line/start/route.ts), [auth/line/callback](src/app/auth/line/callback/route.ts), [line-token-exchange.ts](src/lib/auth/line-token-exchange.ts), [verify-line-id-token.ts](src/lib/auth/verify-line-id-token.ts).

**1.2 PWA device-code handoff login** (ADR 0041)

- Trigger: login from an installed iOS PWA (cookies can't survive the LINE round-trip in standalone mode).
- `POST /auth/handoff/start` inserts a `login_handoffs` row (`pending`, 10-min expiry),
  returns `{device_code, authorize_url}`; PWA opens the URL in the **system browser**.
- The callback runs in the _browser's_ cookie jar with no state cookie → it falls back to
  matching a `pending` handoff row, marks it `approved`, redirects to `/login?handoff=approved`.
- PWA polls `POST /auth/handoff/poll {device_code}`; on `approved` it atomically claims
  the row (`approved → consumed`), mints the session **in the PWA context**, returns the
  role's home.
- Files: [auth/handoff/start](src/app/auth/handoff/start/route.ts), [auth/handoff/poll](src/app/auth/handoff/poll/route.ts), [handoff-flow.ts](src/lib/auth/handoff-flow.ts).

**1.3 Routing & logout**

- `proxy.ts` middleware runs `getUser()` once per request to refresh the session and
  bounces unauthenticated users to `/login` (except `PUBLIC_PATHS`). Page render uses the
  faster `getClaims()` local JWT verify (ADR 0021).
- `/login` shortcuts already-authenticated users to `roleHome()`.
- Logout: `POST /auth/logout` → `signOut()` → 303 to `/`.

### 2. Work packages & approvals

Work packages (WPs) are the unit of work — ~80 per project. ADR 0013: role-level access,
archive-never-delete.

**2.1 WP import (CSV)** — operator-run, local only.

- `pnpm import:wp <PROJECT_CODE> <file.csv>`; pure validator
  ([wp-import/parse.ts](src/lib/wp-import)) checks blank/duplicate/existing codes (fail-all,
  nothing inserted on any error); admin client (service-role, bypasses RLS) batch-inserts
  rows at status `not_started`. No edit-on-import (ADR 0014).

**2.2 WP view & filter** (SA/PM/super)

- `/sa/projects/[id]` lists WPs; client `WorkPackageList` offers a segmented control:
  งานค้าง (on_hold) · รอตรวจ (pending_approval) · เสร็จแล้ว (complete) · ทั้งหมด (all).
- If the project has deliverables, WPs group under collapsible deliverable headers with a
  progress bar; counts derive from the **unfiltered** list (spec 11/12/56).

**2.3 Photo-driven status transition**

- First **"after"** photo on a WP in `{not_started, in_progress, on_hold}` →
  `pending_approval` (admin-client UPDATE with a SQL status guard; idempotent, never
  regresses). First **"during"** photo: `not_started → in_progress` only (never releases a hold).
- File: [photos/transitions.ts](src/lib/photos/transitions.ts).

**2.4 PM approval / review** (decision: PM/super only)

- `/pm` lists `pending_approval` WPs oldest-first → `/pm/work-packages/[id]` review screen
  (photos by phase, decision history, labor cost, on-hold toggle).
- PM picks `approved | needs_revision | rejected`; a comment is **required** for
  needs_revision/rejected (DB CHECK rejects whitespace-only). `recordDecision` inserts an
  append-only `approvals` row; `approved` flips the WP to `complete` (guarded), otherwise
  status stays `pending_approval`.
- **SA can read approvals** (to see revision comments) but **cannot insert** — SAs upload,
  PMs decide. This split is load-bearing.

**WP status enum:** `not_started → in_progress → pending_approval → complete`, plus
`on_hold` (manual, spec 52). `needs_revision`/`rejected` are approval decisions, not WP
statuses — they leave the WP at `pending_approval`.

**2.5 Contractor assignment** (SA/PM/super; ADR 0033)

- WP detail → `WpAssignmentPanel`: pick or inline-create a contractor (outsider crew, no
  login), then assign. SA has no `work_packages` UPDATE policy, so assignment goes through
  the `set_work_package_contractor` SECURITY DEFINER RPC (writes `contractor_id` only).
- `owner_id` + `work_package_members` (ADR 0032) remain in the schema but **dormant** —
  cleanup candidates at v2.

### 3. Photos, markups & reports

**3.1 Photo capture & upload** (SA/PM/super; offline-tolerant, ADR 0039)

- Client downscales to ≤2000px / JPEG 0.8 (ADR 0036; passthrough on failure), assigns a
  UUID, builds path `{project}/{wp}/{photo}.{ext}`, queues the item in **IndexedDB**.
- Uploads bytes to the private `photos` bucket, then server action `addPhoto` inserts the
  `photo_logs` metadata row; only then is the queue item removed. A runner replays the
  queue on load and every 5 s with exponential backoff — survives reload/crash/offline,
  idempotent (409 = already there).

**3.2 Photo edit / remove (tombstone)** — append-only.

- `removePhoto` inserts a tombstone (`storage_path NULL`, `superseded_by = target`); the
  Storage object is left in place (v2 orphan cleanup). Reads filter tombstones +
  superseded rows via anti-join. Files: [photos/tombstone.ts](src/lib/photos), [photos/current-photos.ts](src/lib/photos).

**3.3 Photo markup** (SA/PM/super; spec 51)

- Strokes (normalized 0..1 coords) + optional comment, validated and stored in
  `photo_markups`. Removal is a tombstone; **creator-only** (RLS pins the tombstone target
  to your own rows). The `photo_markups_current` view applies the anti-join.

**3.4 Deliverable progress** — pure derivation

- `deriveDeliverableProgress` over the _unfiltered_ member-WP statuses → `{count, percent,
status}` where `complete` iff all members complete; used by headers and (future) PDF grouping.

**3.5 PDF report generation** (PM/super; ADR 0040, on-demand)

- `generateReport` checks no in-flight report for the project, parses params
  (scope `complete|all`, photos `after|all_phases|none`; spec 61), inserts a `reports` row
  at `requested`.
- **Fast path:** the same request calls `claim_next_report()` (atomic `FOR UPDATE SKIP
LOCKED`); if it claims the row it builds the PDF synchronously (PDFKit + Sarabun),
  uploads to the `reports` bucket, marks `complete`. On error → `failed`.
- **Fallbacks:** the Railway worker also polls `claim_next_report()`; a `reap_stale_reports`
  cron (every 5 min) fails rows stuck `processing` > 15 min so the duplicate guard clears.
- **Status enum:** `requested → processing → complete | failed`.

**3.6 Report download** (PM/super)

- `getReportDownloadUrl` validates `complete` + storage path, mints a 120 s service-role
  signed URL (`{code}-report-{YYYYMMDD}.pdf`, Asia/Bangkok). The `reports` bucket has no
  authenticated SELECT — all reads go through server-minted signed URLs.

### 4. Purchasing (purchase requests)

The largest workflow. One mutable `purchase_requests` row per requisition carries the full
lifecycle; **status is auto-derived by triggers** from fact columns, and every transition
writes an `audit_log` row + a `notification_outbox` row. Files:
[requests/actions.ts](src/app/requests/actions.ts), [lib/purchasing](src/lib/purchasing),
[create_purchase_requests](supabase/migrations/20260608120000_create_purchase_requests.sql).

**Status state machine**

```
                 (record purchase)      (record shipment)     (delivery-confirmation photo)
requested ──► approved ──────────► purchased ──────────► on_route ──────────────────────► delivered
   │             │   (PM/super)      (PM/proc/super)       (PM/proc/super)                 (SA/PM/super upload)
   │             └─► cancelled  (PM/super)
   └─► rejected  (PM/super)

site_purchased  ◄── born terminal via record_site_purchase RPC (SA/PM/super), PM/super acknowledge
```

| Transition                         | Who               | Mechanism                                                                 |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| → `requested`                      | SA / PM / super   | `createPurchaseRequest` (session INSERT, `source='app'`)                  |
| `requested → approved \| rejected` | PM / super        | `decidePurchaseRequest` (reject needs comment; two-layer guard)           |
| `requested → ` (no purchase)       | —                 | n/a                                                                       |
| `approved → purchased`             | PM / proc / super | `record_purchase` RPC (supplier, order_ref, amount, eta) → derive trigger |
| `approved → cancelled`             | PM / super        | `cancelPurchaseRequest`                                                   |
| `purchased → on_route`             | PM / proc / super | `record_shipment` RPC → derive trigger                                    |
| `on_route → delivered`             | SA / PM / super   | upload `delivery_confirmation` photo → completion trigger                 |
| → `site_purchased` (terminal)      | SA / PM / super   | `record_site_purchase` RPC (cash buy on site, ADR 0043)                   |
| acknowledge site purchase          | PM / super        | `acknowledge_site_purchase` RPC (stamps ack, no status change)            |

- **Invoice/receipt upload** (SA/PM/super/**proc**): `addInvoiceAttachment` into
  `purchase_request_attachments` (purpose `invoice`) while status ∈
  `{purchased, on_route, delivered, site_purchased}`. Does **not** auto-complete delivery —
  only a `delivery_confirmation` photo does.
- **Back-office fact writes** historically came from the `appsheet_writer` DB role (ADR
  0025); the in-app RPC path (ADR 0038) is now primary and AppSheet is being sunset
  (ADR 0034). `appsheet_writer` still has column-scoped UPDATE on fact columns for rows in
  `{approved, purchased, on_route, delivered}`.
- **Notes:** `purchase_requests.notes` editable by the requester or PM/proc/super (spec 48/72/73).

### 5. Labor & payroll

Two worker types: **own-crew** (salaried technicians, presence only) and **DC** (outsourced
subcontractors, daily-logged for payroll). All writes go through SECURITY DEFINER RPCs;
all money is server-side only.

**5.1 Worker roster** (PM/super) — `/workers`

- Add/edit worker (name, type, day_rate, contractor for DC, note) via `create_worker` /
  `update_worker` / `set_worker_day_rate` RPCs (each role-gated, audited). No delete —
  retirement via `active=false`.

**5.2 Log labor** (SA/PM/super)

- WP detail labor zone: pick date (≤ today), workers, fraction (full/half), optional note.
  `log_labor_day` RPC takes an advisory lock on `(wp, worker, date)`, enforces one current
  entry, **snapshots** rate/name/type/contractor at entry time, inserts (append-only).
  `self_logged = (entered_by == worker.user_id)`.

**5.3 Correct labor** (SA/PM/super) — supersede

- `correct_labor_log` RPC inserts a new row (`superseded_by = original`); change fraction or
  tombstone (remove). Reason required. Original is never mutated. Tombstones can't be corrected.

**5.4 View / freeze cost** (PM/super)

- `aggregateLaborCost` over current rows: `cost = fraction × rate_snapshot`, own vs DC split,
  per-worker breakdown, cross-WP over-allocation surfaced (never blocked).
- Auto-freeze on WP → `complete`; manual **re-freeze** via `freeze_wp_labor_cost` RPC when
  drift is shown. `wp_labor_costs` is **deliberately mutable** (one row/WP, UPSERT); the
  audit log is the change history (spec 46).

**5.5 Payroll export** (PM/super) — `/pm/payroll`

- DC workers only. Period picker (defaults to current Bangkok month) → grouped summary;
  `/pm/payroll/export` returns CSV (UTF-8 BOM for Excel Thai). Page + export share the
  fetch/aggregate so figures can't disagree.

### 6. Projects, clients, team, profile & notes

**6.1 Project settings** (PM/super) — `/sa/projects/[id]/settings`

- Edit name, status, notes, address, dates, type, lead, budget, client. Read via
  authenticated client; `budget_amount_thb` + clients/staff read via admin client (budget
  SELECT revoked from authenticated). Write via `update_project_settings` RPC (role-checked
  inside, re-validates, maps `22023` to Thai errors). `contract_reference` is read-only.
  Spec 79, ADR 0042.

**6.2 Project team** (PM/super; spec 80)

- Add/remove `project_members` (idempotent add; `added_by` pinned). Team names show on the
  project detail header. Membership is **display metadata only — not an access gate** (ADR 0013).

**6.3 Client master** (PM/super create/edit, SA read; spec 79)

- Inline "เพิ่มลูกค้าใหม่" create + select; `set_project_client` RPC assigns/clears the FK.
  Client name shows on the project header and `/pm/projects` list.

**6.4 Profile self-edit** (all authenticated) — `/profile`

- Edit display name; `update_my_display_name` SECURITY DEFINER RPC (≤80 chars, audited).
  No role gate — anyone can edit **their own** name. Direct `users` UPDATE is revoked from
  authenticated (ADR 0019); this RPC is the only self-write path.

**6.5 Notes** — shared `NotesField` (spec 72)

- `work_package.notes` (SA read / PM-super write), `purchase_requests.notes`
  (requester or PM/proc/super), `project.notes` (PM/super). Trim → NULL on blank, ≤1000 chars.
  Written via the `set_work_package_notes` / `set_purchase_request_notes` RPCs.

### 7. Notifications (LINE)

Async outbox, never blocks the originating write.

**7.1 Event capture** — SECURITY DEFINER triggers insert `notification_outbox` rows and
swallow their own errors (`RAISE WARNING`, return NEW):

- `wp_pending_approval` (WP → pending_approval) → all PMs
- `wp_decision` (approvals INSERT) → uploaders
- `pr_created` (PR INSERT, status requested) → PMs
- `pr_decision` / `pr_progress` / `pr_cancelled` (PR status changes) → requester

**7.2 Outbox drain** — `pg_cron` (every minute) → `invoke_notification_drain()` → pg_net
POST to `/api/notifications/drain` with `x-drain-secret`:

- Reclaim `sending` > 10 min → `pending`; expire `pending` > 24 h → `expired`.
- Claim 50 oldest `pending` → `sending`; resolve recipients, compose Thai text, push to LINE
  Messaging API per recipient (`line_user_id`).
- Per row: any success or zero recipients → `sent`; else `attempts++`, → `failed` at 3.
- **Status enum:** `pending → sending → sent | failed | expired`.
- Table is service-role-only: zero authenticated/anon access, inserts only by the triggers.

---

## Part 2 — Role permission tables

### Roles legend

`users.role` is a 10-value enum. v1-live roles reach real surfaces; the rest land on `/coming-soon`.

| Role                | Code                       | v1?                     | Lands on                                 |
| ------------------- | -------------------------- | ----------------------- | ---------------------------------------- |
| Site admin          | `site_admin` (SA)          | ✅                      | `/sa`                                    |
| Project manager     | `project_manager` (PM)     | ✅                      | `/pm`                                    |
| Super admin         | `super_admin`              | ✅ full-access operator | `/pm` (+ operator hub on `/coming-soon`) |
| Procurement         | `procurement` (PROC)       | ✅ back-office          | `/requests`                              |
| Project coordinator | `project_coordinator` (PC) | v2                      | `/coming-soon`                           |
| Technician          | `technician`               | v2/3                    | `/coming-soon`                           |
| HR                  | `hr`                       | v3                      | `/coming-soon`                           |
| Subcon manager      | `subcon_manager`           | v3                      | `/coming-soon`                           |
| Accounting          | `accounting`               | v3                      | `/coming-soon`                           |
| Visitor             | `visitor`                  | v1 default (new signup) | `/coming-soon`                           |

Below, **"Others"** = visitor + all v2/v3 roles (no live surface). Legend: ✅ allowed · — denied
· 🔑 only via role-gated SECURITY DEFINER RPC · 👁 read-only / column-restricted · ⛔ no one (blocked for all).

### A. Route / surface access

Enforced by `requireRole` unless noted. Wrong role → redirect to `roleHome()`.

| Route                                                              |   SA    |   PM    |    Super     |     Proc     |     Others      |
| ------------------------------------------------------------------ | :-----: | :-----: | :----------: | :----------: | :-------------: |
| `/login`, `/auth/*` (public)                                       |   ✅    |   ✅    |      ✅      |      ✅      |       ✅        |
| `/` (home)                                                         | →`/sa`  | →`/pm`  |    →`/pm`    | →`/requests` | →`/coming-soon` |
| `/profile` (auth-only, no role gate)                               |   ✅    |   ✅    |      ✅      |      ✅      |       ✅        |
| `/coming-soon`                                                     | bounced | bounced | operator hub |   bounced    |  ✅ wait page   |
| `/sa`, `/sa/projects/[id]`, `/sa/projects/[id]/work-packages/[id]` |   ✅    |   ✅    |      ✅      |      —       |        —        |
| `/sa/projects/[id]/settings`                                       |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm`, `/pm/projects`, `/pm/work-packages/[id]`                    |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm/payroll`, `/pm/payroll/export`                                |    —    |   ✅    |      ✅      |      —       |        —        |
| `/pm/projects/[id]/reports`                                        |    —    |   ✅    |      ✅      |      —       |        —        |
| `/workers`                                                         |    —    |   ✅    |      ✅      |      —       |        —        |
| `/requests`, `/requests/[id]`                                      |   ✅    |   ✅    |      ✅      |     ✅¹      |        —        |

¹ Procurement reaches `/requests` but the create form is hidden (`canCreateRequests = role !== 'procurement'`) — they process, not requisition.

Nav UI: `BottomTabBar` (mobile) and `HubNav` (desktop ≥sm) render per role — `SA_TABS`,
`PM_TABS`, `PROCUREMENT_TABS`; null for Others (no bar). See [bottom-tab-bar.tsx](src/components/features/bottom-tab-bar.tsx), [hub-nav.tsx](src/components/features/hub-nav.tsx).

### B. Action capability matrix

| Action                                   | SA  | PM  | Super |     Proc      | Enforced at                                               |
| ---------------------------------------- | :-: | :-: | :---: | :-----------: | --------------------------------------------------------- |
| Create purchase request                  | ✅  | ✅  |  ✅   |       —       | RLS INSERT (WP-reader, `source='app'`) + UI hide for proc |
| Approve / reject PR                      |  —  | ✅  |  ✅   |       —       | RLS UPDATE + action guard                                 |
| Cancel approved PR                       |  —  | ✅  |  ✅   |       —       | action guard + RLS                                        |
| Record purchase / shipment               |  —  | ✅  |  ✅   |      ✅       | `record_purchase` / `record_shipment` RPC                 |
| Record on-site cash purchase             | ✅  | ✅  |  ✅   |       —       | `record_site_purchase` RPC                                |
| Acknowledge site purchase                |  —  | ✅  |  ✅   |       —       | `acknowledge_site_purchase` RPC                           |
| Upload delivery-confirmation photo       | ✅  | ✅  |  ✅   |       —       | RLS INSERT on attachments                                 |
| Upload invoice/receipt                   | ✅  | ✅  |  ✅   |      ✅       | RLS INSERT (widened spec 70)                              |
| Create / edit supplier                   |  —  | ✅  |  ✅   |      ✅       | RLS (back-office; SA excluded)                            |
| Upload / remove progress photo           | ✅  | ✅  |  ✅   |       —       | RLS INSERT on `photo_logs`                                |
| Add / remove photo markup                | ✅  | ✅  |  ✅   |       —       | RLS (remove = own only)                                   |
| Approve WP (insert decision)             |  —  | ✅  |  ✅   |       —       | RLS — **SA uploads, can't approve**                       |
| Assign contractor to WP                  | ✅  | ✅  |  ✅   |       —       | `set_work_package_contractor` RPC                         |
| Create / edit contractor                 | ✅  | ✅  |  ✅   |       —       | RLS (widened spec 31)                                     |
| Create project                           |  —  |  —  |  ✅   |       —       | RLS INSERT (super only)                                   |
| Edit project settings / team / client    |  —  | ✅  |  ✅   |       —       | `update_project_settings` etc. RPCs                       |
| Manage workers / set rates / freeze cost |  —  | ✅  |  ✅   |       —       | worker/freeze RPCs (money)                                |
| Log / correct labor                      | ✅  | ✅  |  ✅   |       —       | `log_labor_day` / `correct_labor_log` RPC                 |
| View labor cost / payroll                |  —  | ✅  |  ✅   |       —       | route guard + admin-client read (money)                   |
| Generate / download PDF report           |  —  | ✅  |  ✅   |       —       | RLS + action guard                                        |
| Edit own display name                    | ✅  | ✅  |  ✅   | ✅ (all auth) | `update_my_display_name` RPC                              |

### C. Table-level RLS matrix (authoritative)

Roles listed are `authenticated` app roles unless marked. ⛔ = no policy/privilege for anyone
(service-role context only). Append-only tables (✱) reject UPDATE/DELETE via triple enforcement.

| Table                                 | SELECT                                   | INSERT                                 | UPDATE                                                           | DELETE     |
| ------------------------------------- | ---------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | ---------- |
| `projects`                            | SA · PM · super                          | super                                  | super (PM via `update_project_settings` RPC)                     | ⛔         |
| &nbsp;&nbsp;↳ `budget_amount_thb` col | PM · super (admin client only)           | —                                      | via RPC                                                          | —          |
| `clients`                             | SA · PM · super                          | PM · super                             | PM · super                                                       | ⛔         |
| `project_members`                     | SA · PM · super                          | PM · super                             | —                                                                | PM · super |
| `work_packages`                       | SA · PM · **proc** · super               | PM · super                             | PM · super (SA→`contractor_id` via RPC)                          | ⛔         |
| `deliverables`                        | SA · PM · super                          | PM · super                             | PM · super                                                       | ⛔         |
| `contractors`                         | SA · PM · super                          | SA · PM · super                        | SA · PM · super (name/phone)                                     | ⛔         |
| `work_package_members` (dormant)      | SA · PM · super                          | PM · super                             | —                                                                | PM · super |
| `photo_logs` ✱                        | SA · PM · super                          | SA · PM · super (+tombstone)           | ⛔                                                               | ⛔         |
| `photo_markups` ✱                     | SA · PM · super                          | SA · PM · super (tombstone = own only) | ⛔                                                               | ⛔         |
| `approvals` ✱                         | SA · PM · super                          | **PM · super** (not SA)                | ⛔                                                               | ⛔         |
| `reports`                             | PM · super                               | PM · super                             | service_role only                                                | ⛔         |
| `purchase_requests`                   | own-row · SA · PM · proc · super         | SA · PM · super (`source='app'`)       | PM · super (status/decision cols); `appsheet_writer` (fact cols) | ⛔         |
| `purchase_request_attachments` ✱      | via readable parent                      | SA · PM · super · proc                 | ⛔                                                               | ⛔         |
| `purchase_request_attachment_tokens`  | ⛔ (service_role)                        | trigger only                           | ⛔                                                               | —          |
| `suppliers`                           | SA · PM · proc · super                   | PM · proc · super                      | PM · proc · super                                                | ⛔         |
| `workers`                             | SA · PM · proc · super (no `day_rate`)   | PM · super (RPC)                       | PM · super (RPC)                                                 | ⛔         |
| `labor_logs` ✱                        | SA · PM · super (no `day_rate_snapshot`) | SA · PM · super (RPC)                  | ⛔ (correct via RPC)                                             | ⛔         |
| `wp_labor_costs`                      | ⛔ (service_role / admin client)         | freeze RPC (PM·super)                  | freeze RPC (UPSERT)                                              | —          |
| `users`                               | own row (all auth); super = all          | (trigger on signup)                    | own `full_name` via RPC; super via admin client                  | ⛔         |
| `audit_log` ✱                         | all authenticated                        | authenticated                          | ⛔                                                               | ⛔         |
| `notification_outbox`                 | ⛔ (drainer)                             | triggers only                          | ⛔ (drainer)                                                     | —          |

Notes:

- **Own-row reads:** `purchase_requests` SELECT also matches `requested_by = auth.uid()`; SA
  was widened to see all rows ([widen_select](supabase/migrations/20260613100050_widen_purchase_requests_select_site_admin.sql)).
- **`appsheet_writer`** sees only `{approved, purchased, on_route, delivered}` rows and can
  UPDATE a fixed set of fact columns; it never calls `current_user_role()` (returns NULL for
  that DB role) — it has its own `TO appsheet_writer` policies.
- **`super_admin`** has a full-access policy on `users`; for writing other users' roles it
  needs the admin client (authenticated UPDATE on `users` is revoked).

### D. Storage buckets

All private; downloads only via service-role-minted signed URLs (TTL 120 s).

| Bucket           | Upload                 | Download                  | Notes                                                                      |
| ---------------- | ---------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `photos`         | SA · PM · super        | service_role (signed URL) | `{project}/{wp}/{photo}.{ext}`, ≤25 MiB, image MIME only                   |
| `pr-attachments` | SA · PM · super · proc | service_role (signed URL) | dual-gate: reference (own + requested) or confirmation/invoice (by status) |
| `reports`        | service_role (worker)  | service_role (signed URL) | PDFs only, ≤50 MiB                                                         |

### E. Special principals & RPCs

- **`authenticated`** — any logged-in user; RLS + `current_user_role()` decide everything.
- **`appsheet_writer`** — dedicated DB role (direct Postgres auth, no JWT) for back-office
  purchase-fact writes (ADR 0018/0025). Being sunset in favor of the in-app RPC path (ADR
  0034/0038).
- **`service_role`** — admin client ([admin.ts](src/lib/db/admin.ts), `server-only`); bypasses
  RLS. Used by: WP import, report worker/fast-path, signed-URL minting, notification drain,
  and money-column reads behind a `requireRole` gate.
- **SECURITY DEFINER RPCs** (role-gated inside, raise `42501` on wrong role): `record_purchase`,
  `record_shipment`, `record_site_purchase`, `acknowledge_site_purchase`,
  `set_work_package_contractor`, `create_worker`, `update_worker`, `set_worker_day_rate`,
  `log_labor_day`, `correct_labor_log`, `freeze_wp_labor_cost`, `update_project_settings`,
  `set_project_client`, `set_work_package_notes`, `set_purchase_request_notes`,
  `update_my_display_name`, `claim_next_report`, `reap_stale_reports`,
  `invoke_notification_drain`, plus `current_user_role()` (the RLS helper).
- **SECURITY DEFINER triggers** — purchase-status derive + audit, delivery completion,
  WP-status helpers, and the four `notify_*` capture functions.

===== FILE: docs/site-map.md =====

# Site map

Audited 2026-06-13 (current through spec 70). Every route, its gate, how
users arrive, and where "back" goes. **Nav changes must update this doc in
the same unit** (same contract as ui-conventions.md).

Principle: the WP list at `/projects/[id]` is THE project page for
every role (WP-centric doctrine). Round-trip rule: entering a detail
surface from a hub, the back affordance returns to that same hub.

Spec 82 (in progress): the URL names the surface, not the viewer's role.
Unit 1 moved the project detail surfaces `/sa/projects/*` → `/projects/*`;
Unit 2 moved reports `/pm/projects/[id]/reports` → `/projects/[id]/reports`;
Unit 3 folded the two project hubs (`/sa`, `/pm/projects`) into one `/projects`
hub (role only decides the chrome) and retired `projectHubHref`; Unit 4 moved
the remaining role-named surfaces — `/pm` → `/review`, `/pm/work-packages` →
`/review/work-packages`, `/pm/payroll` → `/payroll`, `/pm/contacts` →
`/contacts` (307 redirects keep old deep links resolving). Only Unit 5 (promote
307s → permanent, drop dead rules) remains. The lone survivor under `/pm` is the
spec-19 `/pm/requests` → `/requests` legacy 308 (out of scope; Unit 5 candidate).

## Entry and auth

| Route                                       | Gate        | Notes                                                  |
| ------------------------------------------- | ----------- | ------------------------------------------------------ |
| `/`                                         | public      | redirects: session → `roleHome(role)`, none → `/login` |
| `/login`                                    | public      | LINE login; standalone PWA uses device-code handoff    |
| `/auth/line/start`, `/auth/line/callback`   | public      | LINE OAuth start + return (browser + handoff flows)    |
| `/auth/handoff/start`, `/auth/handoff/poll` | public POST | ADR 0041 device-code handoff                           |
| `/auth/logout`                              | session     | clears the session, returns to `/login`                |
| `/coming-soon`                              | session     | unserved roles' landing (`roleHome`)                   |
| `/profile`                                  | session     | display name, avatar, logout (PWA's logout home)       |

`roleHome`: site_admin → `/projects` · pm/super → `/review` · procurement →
`/requests` (spec 70) · others → `/coming-soon`. (spec 82)

## Bottom tabs (phones)

- SA: โครงการ `/projects` · คำขอซื้อ `/requests` · โปรไฟล์ `/profile`
- PM/super: รอตรวจ `/review` · โครงการ `/projects` · คำขอซื้อ `/requests` · ติดต่อ
  `/contacts` (spec 81) · โปรไฟล์ `/profile`
- procurement (spec 70): คำขอซื้อ `/requests` · โปรไฟล์ `/profile` (no project
  hub, not a decider)

## Project surfaces

| Route                                                                     | Gate        | Rows / actions →                                                               | Back →                                                       |
| ------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `/projects` (THE project hub, folded) (spec 82 Unit 3)                    | sa/pm/super | project → `/projects/[id]`; role only sets the kicker + desktop HubNav set     | — (hub)                                                      |
| `/projects/[id]` — **THE project page** (WP list, view filter) (spec 82)  | sa/pm/super | WP → WP detail · รายงาน chip (pm/super) → reports · gear (pm/super) → settings | `/projects` (single hub; projectHubHref retired)             |
| `/projects/[id]/work-packages/[id]` — WP detail (photos, requests, labor) | sa/pm/super | photos/requests/labor zones · request card → `/requests/[id]`                  | `/projects/[id]`                                             |
| `/projects/[id]/settings`                                                 | pm/super    | name/status form (ADR 0042)                                                    | `/projects/[id]`                                             |
| `/projects/[id]/reports` (spec 82 Unit 2)                                 | pm/super    | generate/download PDFs                                                         | back chip → `/projects/[id]` (spec 60; the link row is gone) |

## Review surfaces

| Route                                                                         | Gate     | Rows / actions →                                    | Back →                              |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ----------------------------------- |
| `/review` (review queue) (spec 82 Unit 4)                                     | pm/super | WP → `/review/work-packages/[id]`                   | — (hub)                             |
| `/review/work-packages/[id]` — PM WP review (photos, decision, hold toggle)   | pm/super | decision form · สร้างคำขอซื้อ → `/requests?wp=`     | `/review` (queue is the entry)      |
| `/payroll` — DC payroll rollup + CSV export (money, spec 69) (spec 82 Unit 4) | pm/super | period rollup of DC days by contractor · CSV export | — (desktop PM HubNav ค่าจ้าง entry) |

## Purchasing surfaces

`PURCHASING_ROLES` = sa/pm/super **+ procurement** (spec 70). Procurement is a
back-office processor: it records purchases/shipments and files invoices +
delivery photos, but sees NO create-request section and NO decision/cancel
controls, and its WP reference is plain text (the WP detail route bounces it).

| Route            | Gate             | Rows / actions →                                                                                                              | Back →      |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `/requests`      | PURCHASING_ROLES | card → `/requests/[id]` · create form (hidden for procurement)                                                                | — (hub/tab) |
| `/requests/[id]` | PURCHASING_ROLES | decision/cancel (pm/super) · record/ship + invoice/delivery upload (back office) · WP line → WP detail (text for procurement) | `/requests` |

## Other

| Route       | Gate     | Notes                                                                                                                                                                                                                      |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/workers`  | pm/super | labor roster (spec 46). **No nav entry yet** — reachable by URL only; recorded seam.                                                                                                                                       |
| `/contacts` | pm/super | contacts management (spec 81; spec 82 Unit 4 route): clients / suppliers / contractors via a segmented control; add + per-row edit + note. In the desktop PM HubNav (รายชื่อติดต่อ) AND the phone bottom-tab bar (ติดต่อ). |

## Known seams (recorded, not defects)

- `/workers` nav entry pending its own small spec.
- `/payroll` (ค่าจ้าง) is in the desktop PM HubNav (`hub-nav.tsx`) only — the
  phone bottom-tab bar has no entry for it yet (same gap as `/workers`).
- procurement is onboarded onto the purchasing worklist (spec 70) but has no
  project hub (`projects` SELECT deferred) and no desktop HubNav — recorded
  seams for later units. The `/contacts` supplier screen (spec 81) is
  PM-gated; procurement (a supplier writer at the data layer) does not reach it
  yet — its own widening unit.
- SA quick-adds a contractor inline on WP assignment (spec 31) but does not
  reach `/contacts` to curate contacts — recorded seam.

===== FILE: docs/progress-tracker.md =====

# Progress tracker

Tracks feature units per the workflow in `CLAUDE.md`. One section per unit.

> **Older history is archived.** Units before Spec 21 live in [`progress-archive.md`](progress-archive.md), kept out of this file to save context. This file holds Spec 21 onward.

---

## Spec 21 - urgency segmented control (2026-06-11)

Status: COMPLETE. Priority select replaced with a fieldset of 3 native radios styled as h-11 segmented buttons (sr-only inputs, label-as-button). Selected-only coloring: normal=zinc-700, urgent=amber-500, critical=red-600; unselected stay neutral outline. Same priority state, no validator/enum/DB change. Test-first: tests/unit/purchase-request-form-priority.test.tsx (default normal checked; selecting critical unchecks rest). lint/typecheck/test all green (265 tests). Also shipped same-day, pre-spec: mobile stacking fix for date/priority row (5bdacf7) and appearance-none on the date input to stop iOS width overflow (d28816a). Open question: request list ships pills already; consider same segmented control on any future edit form.

## Spec 22 - order tracking stepper + on_route status (2026-06-11)

Status: COMPLETE. Part A (DB): on_route enum value (after purchased) + shipped_at fact column granted to appsheet_writer; derive trigger maps purchased+shipped_at => on_route, delivery guard widened to purchased|on_route (skip stays legal per ADR 0027); audit: purchased->on_route as action 'update' with transition payload (no new audit_action value); RLS stage gates widened - WITHOUT this the derive transition violates WITH CHECK (caught pre-push). pgTAP file 19 (16 asserts) + file 17 enum pin updated; suite 444 asserts green post-push. Types regenerated. Part B (UI): PurchaseRequestTracker server component (5 stages, rejected red terminal + muted rest, skipped on_route renders done-without-date, ETA under delivery stage while undelivered), mounted on every /requests card; on_route label + sky-700 pill. 271 unit tests green. OPERATOR TODO: expose shipped_at editable in AppSheet column config + re-run Tier-2 smoke ritual (appsheet_writer_p2.sql). Open question: requester-visible courier/tracking-no fields (future spec).

## Spec 23 - delivery-confirmation photos (2026-06-11)

Status: COMPLETE. DB: shipped the locked spec-16 P2 attachments architecture (table + checks + composite FK + token side table + triple-enforced append-only + \_current/\_appsheet security_invoker views + private pr-attachments bucket with path-bound upload policy) PLUS the ADR 0028 purpose discriminator and delivery-confirmation branches (table INSERT policy + storage policy). Fix-forward during pgTAP: the tombstone-target subquery self-referenced the table inside its own policy -> 42P17 recursion; cured with SECURITY DEFINER helper pr_attachment_tombstone_target_ok (20260614100300), ADR 0011 precedent. pgTAP files 20 (52 asserts incl role-sim) + 21 (bucket); suite 503 asserts green. UI: DeliveryPhotoUploader on delivered cards (direct-to-bucket upload + metadata action addDeliveryConfirmationPhoto), creator-only tombstone removal (AttachmentRemoveButton + removePurchaseRequestAttachment), signed-URL thumbnails via mintSignedUrlsForAttachments, ZoomablePhoto reuse. Pure modules attachment-path + validate-attachment test-first. 277 unit tests green. NOTE: spec-16 P2 reference-attachment UI is now app-code-only (DB shipped here); P3 bridge ADR renumbered 0029. OPERATOR TODO: re-run Tier-2 smoke (script updated for on_route [2c] probe this session); spec-16 P2 operator fixture protocol applies when reference UI ships. Open question: pgTAP storage positive-path upload probe is owned by the smoke ritual, not pgTAP (runner has no storage API).

## Spec 16 P2 UI - reference attachments (2026-06-11)

Status: COMPLETE (DB shipped under spec 23). New action addPurchaseRequestAttachment (per-kind validation, server-rebuilt path, purpose=reference). PurchaseRequestAttachmentStager: deferred mode in the create form (staged chips -> flush(prId) after createPurchaseRequest; failures keep chips with retry + amber note beside the saved confirmation; flushedIdRef enables post-flush retry) and immediate mode in the เพิ่มรูปหรือลิงก์ details-expander on own requested cards. /requests cards render รูปอ้างอิง thumbnails + ลิงก์อ้างอิง anchors (noopener noreferrer nofollow, truncated) for every status; creator-only ลบ while requested. One attachments query for ALL visible requests split by purpose/kind; single signed-URL batch. Form gains required projectId prop (priority test updated). 277 unit green; no schema change. NEXT: P3 AppSheet image bridge (ADR 0029) is now unblocked end-to-end. Verified-by-checklist posture per spec 16 §7 for stager/action wiring (pure seams carry the tests).

## super_admin navigation fix (2026-06-11)

Status: COMPLETE. Operator report: 'superadmin has a weird navigation'. Root cause: roleHome() only knew site_admin/project_manager, so super_admin fell into the /coming-soon default — post-login redirect (LINE callback, /login, /), the /profile back link, and the bare /requests back link all bounced a fully-privileged role to the 'tools not ready' page. Fix: super_admin → /pm (consistent with the tab bar giving super the PM set, spec 19). Test-first: tests/unit/role-home.test.ts pins all served + unserved roles. 279 unit tests green.

## Incident: AppSheet EMAXCONNSESSION (2026-06-11)

Operator screenshot: AppSheet app failed to load — 'max clients reached in session mode, pool_size: 48' on projects + users reads. Diagnosis: AppSheet data source pointed at the SESSION pooler (5432, per go-live checklist Step 2 wording); Supavisor session pools are per-DB-user with a 48-client cap, and AppSheet's parallel sync burst exhausted appsheet_writer's pool. pg_stat_activity showed ZERO held appsheet_writer backends at diagnosis time — burst, not a leak; nothing to terminate; no prod change made. Fix: operator repoints AppSheet to the TRANSACTION pooler (6543). Checklist Step 2 now documents the port split (5432 = smoke ritual only). Raising session pool_size is not viable (already near the compute tier's max_connections). Open question: if AppSheet misbehaves on transaction mode (prepared-statement quirks), revisit — fallback is a dedicated session pool budget discussion.

## PM work-package visibility (2026-06-11)

Status: COMPLETE (option 1 of 2). Operator: 'why PM cannot see WP?' Root cause: navigation gap, not RLS — the PM journey went project list -> reports directly; WPs only reached PMs via the รอตรวจ queue. Fix: the reports page nav strip gains a รายการงาน link to /sa/projects/{id} (already PM-authorized; already the WP review screen's spec-12 back-target). Verified-by-checklist (page link; no pure seam). 279 tests green. Open question: option 2 (a real /pm/projects/{id} hub with WP list + reports tab) if the operator wants PM-styled WP browsing later.

## Spec 24 - photo receipt completes delivery (2026-06-11)

Status: COMPLETE. Operator: 'when status is on_route, users on site can attach images, then we know delivery is complete.' ADR 0030 (amends 0028's delivered-only gate): confirmation-photo INSERT + storage branches widened to on_route|delivered; new AFTER INSERT SECURITY DEFINER trigger purchase_request_attachments_complete_delivery sets delivered_at + received_by (users.full_name) on an on_route parent — existing derive trigger advances status, existing audit trigger writes purchase_request_delivery (principal 'authenticator' = app path, recorded in ADR 0030). purchased rows still deny confirmation photos (flow starts at on_route; open question whether skip-path needs app-side completion). pgTAP 20 plan 52->60; suite 511 green. UI: uploader + photo section on on_route cards; footer copy rewritten (photo confirmation sentence; removed the now-false 'cannot edit in app' claim for delivery). 279 unit green.

## Nav coherence fixes (2026-06-11)

Status: COMPLETE. Operator reports: (1) tab highlight disappears inside tab details — root cause: PM/super on /sa/\* cross-surface paths matched no PM tab (spec 19 accepted this; now reversed by operator). Fix: TabItem gains optional match[] prefixes; PM โครงการ claims /sa; longest-prefix-wins still guarantees exactly one lit tab. bottom-tab-bar test updated (named UPDATE: cross-surface pin flipped) + 2 new cases. (2) Tab roots showed กลับ on mobile where the tabs ARE the nav — /profile back link and the bare /requests back strip are now desktop-only (pinned /requests keeps its contextual spec-12 back-bar everywhere). Audit found no other offenders (other back affordances are contextual: กลับไปหน้ารายการงาน, โครงการทั้งหมด). 281 unit green. Noted, not changed: reports-page nav strip duplicates the รอตรวจ tab destination on mobile — harmless, contextual.

## Spec 25 - WP-inline purchase status, own-row badge, on_route upload fix (2026-06-11)

Status: COMPLETE. Three operator items: (1) BUG: photo upload at on_route failed — addDeliveryConfirmationPhoto's status check still demanded 'delivered' (outlived the ADR 0030 policy widening; bytes uploaded, metadata insert refused). Widened to on_route|delivered. Lesson: when a policy gate widens, grep ALL layers (policy, storage policy, action, UI render condition) — the action layer was missed. (2) WP detail screen now renders คำขอซื้อของงานนี้ — its purchase requests with pill + tracker inline + link to /requests?wp= (operator: status must show inside the WP). (3) Site-wide /requests rows carry a ของฉัน badge when requested_by = viewer. Page-level changes verified-by-checklist; 281 unit green.

## Spec 26 - request card slimming (2026-06-11)

Status: COMPLETE. Operator: card takes too much space. Audit: the stepper (spec 22) already encodes stage dates + ETA, so the standalone อนุมัติเมื่อ / คาดว่าจะได้รับของ / สั่งซื้อเมื่อ / ได้รับของเมื่อ lines were pure duplication (up to 4 text lines per decided card). Removed; supplier + receiver (facts the tracker does NOT carry) fold into one compact line; ขอเมื่อ drops to date-only. Kept: rejection block, needed_by, delivery note, attachments. 281 unit green. Separate-DB question answered in chat (assessment: NO — same-DB; schema gaps listed as iteration queue: cancellation status, PR running number, suppliers table, line items, partial deliveries, courier fields).

## Spec 27 - cancellation + PR running number (2026-06-11)

Status: COMPLETE. ADR 0031. DB: cancelled enum value (after rejected, own migration); cancelled_at/by/reason facts + pr_cancel_shape CHECK; pr_number bigint sequence-fed, backfilled chronologically (requested_at order), NOT NULL+UNIQUE+default; cancellation audit trigger (action 'update', transition payload — third no-new-audit-action use). pgTAP file 22 (15 asserts incl. PM cancel lives / SA statement affects 0 rows / audit payload); enum pins updated in files 17 AND 19 (19's pin was missed first run — lesson: grep ALL enum_has_labels pins when adding a value). Suite 526 green. App: ยกเลิกแล้ว label, muted pill, tracker cancelled state (approve stays green, rest muted — administrative close, test-first), cancelPurchaseRequest action (decide-pattern two-layer guard), ยกเลิกคำขอ button on approved cards (decider-only), PR-XXXX mono prefix on /requests + WP-inline cards. 283 unit green. OPERATOR TODO (BLOCKING for AppSheet saves): mark pr_number, cancelled_at, cancelled_by, cancellation_reason READ-ONLY in AppSheet column config, then re-run Tier-2 smoke. Open seam: requester self-cancel RPC; cancellation-reason UI prompt.

## Spec 28 - WP detail redesign: owner/team, attention strip, responsive IA (2026-06-11)

Status: COMPLETE. ADR 0032 (extends ADR 0013 - membership is display metadata, NEVER an access gate; first deliberately-mutable domain table, justification recorded). Part A DB: work_packages.owner_id + work_package_members (PK wp+user, RLS: staff read / PM+super write with added_by pin; real DELETEs); pgTAP file 23 (15 asserts); suite 541 green; types regenerated. Part A UI: fetchAssignableStaff (admin client, names only; users has NO email column - uuid-head fallback), 3 assignment actions (RLS-relay pattern), WpAssignmentPanel (PM/super details-expander: owner select + member add/remove), header chips ผู้รับผิดชอบ + ทีม (4 names + overflow count). Part B: header summary line (รูป X/3 ช่วง + คำขอซื้อ Y ค้าง), attention strip under header (latest needs_revision=amber / rejected=red w/ comment+decider+date - the SA could never see WHY work bounced on this page before), description details-block (column existed, never shown). Part C: md+ two-column grid (photos 1.6fr left; description/purchasing/history right rail; phone keeps single column photos-first), approval history details (all decisions, pills + comments + names). 283 unit green. Telegram icon convention also adopted this session (memory). Open question: งานของฉัน WP-list filter now one query away.

## Spec 29 - create-form embeds in WP detail (2026-06-11)

Status: COMPLETE. Operator: two WP links (สร้างคำขอซื้อ + ดูรายละเอียดคำขอซื้อทั้งหมด) pointed at the SAME URL (/requests?wp=X) and creating a request teleported users out of the โครงการ tab. Site map drawn in chat. Fix: PurchaseRequestForm now mounts inside the WP detail right rail as a สร้างคำขอซื้อ details-expander (component already took workPackage+projectId props — zero form changes); duplicate header link removed; list link renamed ดูในแท็บคำขอซื้อ → plain /requests (explicit tab switch). /requests?wp= pinned mode remains functional but NO in-app link produces it — recorded seam (candidate for removal in a future cleanup spec). 283 unit green.

## Spec 30 (partial) - WP page zone headers + link removal (2026-06-11)

Status: items 1+2 COMPLETE; item 3 (contractor owners) awaiting operator decision. 1) ดูในแท็บคำขอซื้อ link removed (operator). 2) WP detail gets three zone headers (icon + bold + heavy underline rule): รูปถ่ายงาน (Camera) / คำขอซื้อ (ShoppingCart: create expander + list) / ข้อมูลงาน (FileText: description + approval history) — fixes 'everything looks like the same category'. คำขอซื้อของงานนี้ h2 absorbed into the zone header. 283 unit green. PENDING DECISION (item 3): operator says มอบหมายงาน should assign WP OWNERS = outsiders (subcontractor crews) — needs contractors master table; question asked whether spec-28 internal owner/team stays alongside or is replaced.

## Spec 31 - contractor WP owners (2026-06-11)

Status: COMPLETE. ADR 0033 (supersedes ADR 0032's user-owner UI; operator decision 'Replace' — WPs are executed by outsider crews without logins). DB: contractors master (name nonblank CHECK, phone, created_by pin; PM/super insert+update, NO delete policy — referenced contractors stay forever) + work_packages.contractor_id; pgTAP 24 (12 asserts), suite 553 green; types regenerated. App: assignment-actions reworked (createContractor + setWorkPackageContractor), WpAssignmentPanel reworked (contractor select + inline เพิ่มผู้รับเหมาใหม่ create-and-assign), header line ผู้รับเหมา {name · tel-link}; spec-28 user-owner UI removed — owner_id + work_package_members DORMANT (cleanup candidates at v2, ADR 0033); fetchAssignableStaff now unused by pages (kept — future user pickers). 283 unit green.

## Spec 31 amendment + layout fixes (2026-06-11)

Status: COMPLETE. Operator screenshot (desktop): 1) WP page wasted side space — header/attention/grid wrappers gain lg:max-w-6xl (+ lg:gap-8). 2) SA could not add/assign ผู้รับเหมา — contractors INSERT/UPDATE policies widened to staff (sa/pm/super); assignment moved to SECURITY DEFINER RPC set_work_package_contractor (writes contractor_id ONLY — widening the WP UPDATE policy would hand SA every column); p_contractor_id DEFAULT NULL fix-forward so typegen marks it optional (clearing = omit arg). pgTAP 24 rewritten (14 asserts incl. visitor 42501 + SA-direct-update-still-filtered); suite 555 green. 3) Form cramped in the narrow right rail — date/priority row sm:flex-row removed (viewport variants lie about CONTAINER width; the form's primary home is the rail since spec 29). Lesson: prefer container-relative layout for components that move between containers. 283 unit green.

## Unit: architecture revision doc — entrepreneur lens (2026-06-11)

- **Status:** COMPLETE (doc-only, advisory). Operator brief: "revise the architecture of this app; think like an entrepreneur, not just technical."
- **Deliverable:** [`docs/architecture-revision-2026-06.md`](./architecture-revision-2026-06.md) — strategic assessment of the whole system by business criteria (cost/month, ops burden per change, engagement, sellability, moat).

### Key positions taken (all pending operator sign-off — §6 of the doc)

1. **AppSheet = rented ground.** Stop investing: cancel the unwritten ADR 0029 image bridge, build the in-app procurement surface + suppliers table instead (derive triggers are already writer-agnostic per ADR 0025; `procurement` role waits in the enum), demote AppSheet to read-only, then retire. Kills the per-schema-change operator tax, the Tier-2 write smoke, the EMAXCONNSESSION incident class, and the licence line.
2. **LINE notification outbox promoted to next feature slot** — audit triggers already detect every hand-off event; they just don't deliver. Outbox table + drainer + LINE Messaging API channel.
3. **Railway retired when touched** — PDF on-demand (route handler spike first) or Edge Function; end-state two platforms.
4. **Tenancy decided on purpose:** instance-per-customer for now + tenant-clean discipline + spin-up runbook; multi-tenant schema deferred until customer #2 is real.
5. Migration rehearsal stage (preview branch/scratch project) before destructive pushes; photo client-side downscale question raised; crew capability-URL uploads parked as v2 differentiator; dormant owner_id/work_package_members cleanup listed.

### Open questions

- The four §6 operator decisions (AppSheet sunset, notifications next, tenancy posture, photo downscale).
- No code/schema/test change this unit; suites untouched (555 pgTAP / 283 unit as of a42f083).

## Spec 32 - LINE notification outbox (2026-06-11)

Status: COMPLETE (operator activation pending — checklist §8). Operator granted decision authority ("you are allowed to make the calls"); ADRs 0034 (AppSheet sunset, ADR-0029 bridge CANCELLED), 0035 (instance-per-customer tenancy + tenant-clean rule), 0036 (client downscale becomes the stored original — implementation spec later) recorded the four §6 calls, then the architecture-revision §3.2 priority shipped as spec 32 + ADR 0037.

DB (3c46e22 + 5f4b8be): notification_event_type + notification_status enums, notification_outbox (deliberately mutable delivery state; privileges revoked + RLS with zero policies), four SECURITY DEFINER capture triggers (WP→pending_approval, approvals INSERT, PR INSERT, PR status transitions incl. derive-driven) — failure-SWALLOWING by design (RAISE WARNING; notifications must never block a photo/decision/AppSheet write — recorded divergence from audit triggers). Drain schedule: pg_cron + pg_net every minute → invoke_notification_drain() reads notification_drain_url/secret from Vault, silent no-op until configured. In-build adversarial finding: minute-cron overlap could double-send → claim state (pending→sending + claimed_at, status-guarded UPDATE; 10-min reclaim pass) shipped as spec amendment, enum value in its own migration (spec-27 precedent). pgTAP file 25 (26 asserts incl. role-sim capture paths, derive-driven transition, WHEN-guard negative, cron-job pin); suite 581 green post-push; types regenerated.

App: pure modules test-first (payload narrow, compose-notification Thai copy via central label maps + PR-padding, resolve-recipients with actor-exclusion/no-self-notify + dedupe, drain-policy expiry/reclaim/attempt outcomes, line-push wrapper) — 27 new unit tests, suite 310 green. Drain route handler POST /api/notifications/drain: x-drain-secret gate, 503 not_configured until env set (verified LIVE on dev server: 503 + {"error":"not_configured"}), reclaim→expire→claim→enrich (batched: WP codes, PM pool, photo uploaders, line ids)→compose→per-recipient push→outcome writes. env.server.ts gains LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NOTIFICATION_DRAIN_SECRET (both optional ON PURPOSE — deploys boot unconfigured); .env.example documented. Queued-item pulled forward as dependency: admin.ts gains <Database> generic (typed outbox queries) — surfaced exactly one stale cast (addPhoto .in() as-unknown-as removed). browser.ts typing still queued.

OPERATOR TODO (activation, checklist §8): create LINE Messaging API channel (separate from Login channel), long-lived token → Vercel env ×2 + redeploy, Vault secrets ×2, users friend the OA (QR), acceptance probe (After photo → PM LINE push ≤1 min).

Open questions / seams: per-user notification preferences/opt-out; Flex message formatting; drain-on-write fast path; Web Push fallback; notification history UI; LINE OA message-quota plan choice (operator); failed-row resend tooling. Carried queue unchanged (tap targets, length caps, browser client typing, pending-band ordering test, pagination, ของฉัน band label, real logo, LINE-notification unit NOW DONE, skeleton width). NEXT per ADR 0034: in-app procurement surface + suppliers table (AppSheet write parity → demote to read-only).

### Spec 32 adversarial verification (3-lens workflow) — fixes landed pre-commit

- **Blast-radius + discipline lens — MAJOR, fixed:** `.env.example` shipped the two optional vars as empty assignments; dotenv loads `VAR=` as "" and `.optional()` rejects "" → every fresh "copy .env.example" local boot (and a blank Vercel value) would crash env validation at import time. Fixed both ends: `optionalNonEmpty` preprocess (empty→absent) in env.server.ts + lines commented out in .env.example + 3 new env.test.ts cases (the existing per-var missing/empty pattern now covers the new vars).
- **Blast-radius minors, fixed:** photo_logs uploader enrichment included tombstone rows (uploaded_by = REMOVER per ADR 0015) → `.not("storage_path","is",null)`; no maxDuration on a 50×N-push route → `export const maxDuration = 60`; PostgREST 1000-row cap on the uploader query → loud warn when hit (pilot volumes far below).
- **Security minors, fixed:** drain secret now compared via sha256+timingSafeEqual; LINE 5000-char text limit enforced by truncation in pushLineMessage (an oversized user comment was a deterministic 400 → burned all 3 attempts → actor-controlled notification suppression) + unit test; pgTAP file 25 hardened +11 asserts (plan 37): authenticated UPDATE/DELETE denial, anon denial, policies_are ZERO, EXECUTE denial on invoke_notification_drain for anon+authenticated (PostgREST RPC exposure pin), all four capture functions SECURITY DEFINER + pinned search_path, pr_created WHEN-guard negative, and the headline failure-swallowing posture PROVEN (outbox renamed away inside the transaction → WP write still lands, zero rows captured).
- **Discipline:** payload.ts (5th pure module) had no tests → notification-payload.test.ts added (key mapping, type-narrowing drops, malformed input); recorded here as declared addition alongside the admin.ts typing pull-in. pr_cancelled trigger breadth (any→cancelled vs spec's approved→cancelled) recorded in ADR 0037 as deliberate, with the audit-widening caveat for any future self-cancel unit.

Final suite state: 318 unit / 592 pgTAP / 27 e2e, typecheck+lint clean, drain endpoint live-probed 503 not_configured pre-activation.

## ADR 0034 amendment - atrophy model (2026-06-11)

Operator asked for hybrid pros/cons before AppSheet retirement; evidence pass (2-agent inventory) found the hybrid sounder than the architecture-revision urgency credited: AppSheet write surface = 9 fact columns on ONE table (decide/cancel/create/delivery-by-photo already in-app), derive/audit/notification triggers writer-agnostic, grid bulk-entry value unquantifiable yet (operator: "cannot determine"). ADR 0034 amended: parity build proceeds (in-app purchase/shipment form + suppliers still NEXT) but parity does NOT auto-demote — both paths coexist; demotion when audit_log principal split shows in-app carrying >80-90% of fact-writes for several weeks, or on forcing event (customer #2 / next AppSheet outage). Column freeze + 3 open TODOs unchanged. Volume question converted to measurement (audit principal field) instead of a bet.

## Spec 33 - in-app purchase/shipment recording + suppliers master (2026-06-11)

Status: COMPLETE. ADR 0038 (amends ADR 0025 sole-writer + ADR 0026 eta-AppSheet-only). The ADR-0034-amendment parallel path: AppSheet untouched, zero AppSheet config needed; audit principal now measures which surface back office uses (atrophy model).

DB (4844963 + review-fix commit): suppliers master (contractors mirror — nonblank name, created_by pin, staff read incl. procurement, back-office write pm/procurement/super, NO delete) + purchase_requests.supplier_id FK (analytics link; supplier text stays as RPC-written name snapshot for display/AppSheet continuity). record_purchase + record_shipment SECURITY DEFINER RPCs (role gate, stage guards approved+unpurchased / purchased+unshipped, supplier-name snapshot, amount>0, order_ref<=80). Existing derive/audit/spec-32-notify triggers do ALL the rest — zero new triggers; pgTAP 26 proves end-to-end chain (approved→purchased→on_route walk, purchase audit row, shipment transition audit row, 2 pr_progress outbox rows).

App: validate-record-purchase + isBackOfficeRole pure modules test-first (RED confirmed pre-impl); createSupplier/recordPurchase/recordShipment actions (RPC relays, decide-pattern error unions, 42501/P0001 Thai mapping); PurchaseRecordForm (supplier select + inline เพิ่มผู้ขายใหม่ create-and-pick, order_ref/amount/eta) on approved cards; PurchaseRequestShip (confirm) on purchased cards; both gated isBackOffice; footer copy now names both paths. 325 unit green.

### Adversarial verification (3-lens) — fixes landed pre-commit

- Security: table-level INSERT/UPDATE grants let SA set supplier_id at INSERT and PM desync the supplier snapshot via direct UPDATE → migration 20260616000400 column-scopes authenticated to exactly the create/decide/cancel column sets; fact columns are now RPC/AppSheet-only at the privilege layer. pgTAP pins both denial paths + RPC secdef/search_path + anon EXECUTE denials.
- Blast radius: record_purchase wiped AppSheet-pre-set order_ref/amount/eta when params omitted (eta wipe audit-INVISIBLE — purchase payload has no eta) → migration 20260616000300 coalesce semantics + pgTAP preserved-eta probe. Form: supplier duplicate after revalidate (dedupe), silent amount loss on badInput (validity check).
- Discipline (FAIL → fixed): procurement role cannot reach /requests (requireRole excludes; roleHome → /coming-soon) — recorded as deferred seam in spec+ADR, NOT silently widened (needs requireRole+roleHome+tab-set spec together); record_shipment role gate + shipment audit row were untested (added); createSupplier missing phone-length server check (added); this tracker entry itself (was missing at review time).

Suite state: 325 unit / 27 e2e / pgTAP 26 files (34 asserts in file 26) — db:test rerun after the two review-fix migrations push. Open seams: procurement-role onboarding spec, in-app fact corrections (audited RPC), bulk/grid mode (usage-data-driven), supplier merge/dedup, spend analytics, AppSheet supplier_id backfill. OPERATOR: nothing required — feature is live for PM/super on next deploy; AppSheet keeps working unchanged.

### Spec 33 post-push fix-forward

File 17 G.7/G.8 pinned the superseded spec-16 P1 posture (table-level eta UPDATE grant) and failed against the column-scope migration — rewritten as named UPDATE-tests asserting the ADR 0038 reversal (super_admin direct eta UPDATE now 42501; no case-3 diff from a denied write; appsheet eta-audit coverage lives on in file 18 + smoke [4a]). File 26 plan corrected to 35. Final suite: 627 pgTAP / 325 unit / 27 e2e, all green. Lesson re-learned from spec 27: when a posture flips, grep ALL pgTAP files that PIN the old posture, not just enum pins.

## Spec 34 - client photo downscale (2026-06-11)

Status: COMPLETE (operator phone pass = acceptance, spec §3). Implements ADR 0036: the downscaled file IS the original; max 2000px long edge, JPEG 0.8; downscale is an optimization NEVER a gate — every failure path (HEIC on non-Safari, decode/encode errors, toBlob null) uploads the original unchanged; small files pass through with EXIF intact (orientation correct either way: re-encode bakes orientation via createImageBitmap imageOrientation:'from-image', passthrough keeps EXIF).

Built: src/lib/photos/downscale.ts (computeDownscaleTarget PURE + preparePhotoForUpload browser seam) + photoExtToMime in path.ts — RED confirmed pre-impl, 11 unit tests. Integrated in ALL THREE uploaders at the ext-derivation point (ext flips to jpeg on re-encode BEFORE path building): phase-uploader (PendingUpload now stores prepared blob + lastModifiedMs scalar — no raw File in state; retries reuse prepared bytes), attachment stager, delivery uploader. No DB/storage diff.

### Adversarial verification (2-lens) — fixes landed pre-commit

- Transparent PNG/WebP over the cap re-encoded onto a BLACK background (canvas default substrate under toBlob jpeg) → white fill before drawImage.
- REAL race (stager deferred mode): awaiting prepare BEFORE staging the chip meant a create-form submit during a slow phone decode flushed without the in-flight photo — orphaned 'staged' chip, and a SECOND submission would have attached it to the WRONG purchase request. Fix: chips stage synchronously as 'preparing' (new status + กำลังเตรียมรูป… display), prepare jobs tracked in a ref, flush() awaits outstanding prepares THEN reads a fresh items ref (the closure's items is stale after an await — itemsRef pattern).
- createImageBitmap orientation made explicit (imageOrientation:'from-image' — old Firefox/WebViews don't default to it); ext! assertions narrowed; stager header comment de-drifted; rounding test now exercises a genuinely fractional edge (3000×1000 → 667).

Suite: 336 unit / 27 e2e green; pgTAP untouched (627). OPERATOR (acceptance): fresh camera photo on a test-safe WP → renders correctly oriented; Storage object ~hundreds of KB not MB (dashboard read-only check). Open seams: Web Worker offload (with the offline-queue spec), HEIC polyfill, quality/size UI, retroactive processing (never — append-only).

## Spec 35 - offline-tolerant upload queue, WP phase photos (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance: airplane mode -> photo -> banner -> close browser -> signal -> reopen -> photo lands). ADR 0039. A selected phase photo is never lost: persisted to IndexedDB at selection (survives crash/close/navigation, iOS + Android — NO Background Sync dependency), uploads live exactly as before on good signal, global UploadQueueRunner (root layout; banner รอส่งรูป N รูป only when items wait) drains leftovers on mount/online/visibility/event/backoff (5s·2^n cap 5min).

Architecture: replay is IDEMPOTENT end-to-end so live-path/runner/multi-tab overlap is harmless BY DESIGN — bytes 409 ⇒ alreadyExists ⇒ advance; addPhoto gains a 23505 replay path. Pure core (processQueue/QueueStore/classify/backoff) test-first vs in-memory store — 15 unit tests; IDB store + runner are browser seams (house posture). Items NEVER auto-dropped (evidence); attempts only widen backoff.

### Adversarial verification (2-lens, verdict FAIL -> all fixed pre-commit)

- MAJOR (security): the 23505 verify originally checked id-exists only — photo ids are readable role-wide, so a forged replay with a foreign photo id (e.g. a before-photo id + phase='after') would return ok AND flip the WP to pending_approval with zero after photos. Verify now requires the FULL replayed identity (id + work_package_id + phase + canonical storage_path).
- MAJOR (shared device): queue items now carry userId; the runner SKIPS foreign/ownerless items (uploaded_by is append-only — misattribution is uncorrectable). Post-logout blob persistence recorded in ADR 0039 as an accepted tradeoff; discard UI = seam.
- MAJOR (live-path resilience): addPhoto invocation throw (the exact flaky-signal case) stuck the tile and ABORTED the multi-file loop (remaining files never queued — silent loss) -> try/catch in insertOne + per-iteration isolation in handleFiles. Queue I/O (quota/private-mode IDB) wrapped non-fatal — the safety net can't break the live pipeline.
- MAJOR (idempotency gap): live uploadOne wasn't 409-tolerant — a runner/live overlap left a permanently-failing retry tile; now classifies alreadyExists and proceeds.
- Minors: banner staleness (notify after live remove; lock-unavailable branch refreshes count + short retry), pass-failure now reschedules (30s) instead of freezing, dead nowMs dep removed, projectId dropped from the persisted item (fileName kept for the discard seam, recorded), header lifecycle comment updated.

Suites: 349 unit / 27 e2e green; pgTAP untouched (627); no DB schema diff (addPhoto change is app-layer only). Open seams: reference/delivery photo queueing, manual discard UI, SW Background Sync, Web Worker downscale. OPERATOR: phone acceptance pass for specs 34+35 together (one outdoor session covers both).

## Spec 36 - iteration-9 debt batch (2026-06-12)

Status: COMPLETE. Six carried items closed, one resolved-as-stale, zero schema diff. (1) browser.ts <Database> generic — ALL three Supabase clients now typed; surfaced nothing. (2) Server-side length caps in validateCreatePurchaseRequest (item_description 500 / unit 40, test-first; the iteration-8 security minor) — DB CHECKs still queued pending a prod data-length check. (3) comparePendingRequests extracted to src/lib/purchasing/pending-order.ts + 3 pinning tests (/requests sort path now byte-equivalent but tested). (4) Tap targets: retry button min-h-11; remove button rebuilt as 44px transparent hit square around the 28px disc INSIDE tile bounds — reviewer caught that the first attempt (after:-inset-2) was clipped by the tile's overflow-hidden; lesson: hit-area pseudo-element tricks die under overflow-hidden ancestors. (5) Spinner className variant; white track on the red button (~1.8:1 -> fixed). (6) ZoomablePhoto focus-visible:ring-inset (ring was fully clipped). Stale: reports breadcrumb links already min-h-11 since nav-coherence. Suites: 354 unit / 27 e2e green. Still queued: DB CHECK caps, dark toggle (operator), real logo (asset), dialog a11y foundation, pagination.

## Spec 37 - offline queue for all photo kinds + manual discard (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance, spec §2). Closes both ADR 0039 seams: the loss-proof queue now covers reference attachments and delivery-confirmation photos (not just WP phase photos), and the รอส่งรูป banner expands into a per-item list with confirm-guarded ลบ — the ONLY way an item leaves the queue without landing.

Architecture: QueuedPhoto generalized to discriminated QueuedUpload (phase_photo | reference_attachment | delivery_photo); bucket + metadata action follow the kind; the pure core stays kind-agnostic (runner's insertMeta dispatches). Legacy spec-35 items normalize to phase_photo on read (IDB schemaless — no version bump). Both attachment actions gained the identity-complete 23505 replay (id + parent + kind + purpose + canonical path). Stager queues at runItem time (flush covers deferred mode once the parent exists); userId threaded through PurchaseRequestForm at both hosts. Test-first: 5 new core tests (mixed-kind dispatch, normalization, bucket map, discard race).

### Adversarial verification (2-lens, FAIL -> all fixed pre-commit)

- MAJOR: addPurchaseRequestAttachment's status gate ran before the 23505 verify, so a replay whose insert LANDED but whose response was lost could never confirm after the PM decided — the queue item retried forever for a photo that was already live. Fixed: decided-parent path runs the identity-complete existence check first (read-only); never-landed items on decided parents are refusable BY DESIGN — the reference window closes at decision time (recorded in spec + ADR; discard is the designed out).
- Discard raced an in-flight pass: processQueue's put-backs could resurrect (or send) a just-discarded item. Fixed: QueueStore.has() re-checks before every put-back (pinned by unit test); confirm copy now promises only un-sent deletion.
- Shared-device hole in the NEW surface: the discard list let any device holder (incl. logged-out on /login) see and delete other users' un-sent evidence — contradicting the ADR 0039 skip-foreign stance. Fixed: foreign items render read-only without fileName (รูปของผู้ใช้อื่น — รอเจ้าของเข้าสู่ระบบ).
- Deferred-mode queueing was dead code (userId never threaded to the create form) — silent loss on flush-with-bad-signal survived. Fixed: userId through PurchaseRequestForm at /requests + WP page.
- Delivery failure copy said "ลองใหม่" which would make users re-pick under a NEW uuid → duplicate rows when both landed. Copy now says queued-will-auto-send. a11y: role=status moved off the details element onto the count span (live region must not swallow disclosure semantics/buttons); summary marker restored.

Suites: 359 unit / 27 e2e green; pgTAP untouched (627); no schema diff. OPERATOR: the specs 34+35 phone pass extends to 37 (airplane-mode delivery photo -> banner -> reopen -> lands + auto-completes delivery per ADR 0030). Open seams: SW Background Sync, Web-Worker downscale, link-attachment queueing (deliberately out).

## Spec 38 - re-skin: Refined Utility + brand band (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance). Operator brief: "app looks very generated, buttons/blocks look like an old app"; direction picked under delegated authority from /design-preview options = ก (refined utility) + ข's brand band. Diagnosis doc: docs/design-directions-2026-06.md; spec: 38-reskin-refined-utility.md (the locked class map IS the spec).

Shipped: AppHeader becomes the one dark surface — slate-900 brand band with PRC Ops wordmark (amber accent) + kicker + white heading; LogoutButton gains dark variant (light default untouched on profile/coming-soon). Page sweep (3 parallel agents, disjoint sets, 25 files): zinc-50 page wash under white rounded-xl shadow-sm cards, rounded-lg controls with shadow-xs, border-zinc-300→200 on cards/panels, primary buttons gain shadow + active:translate-y-px. Untouched by design: status pills (sun identity), BottomTabBar, login, scrims, manifest/theme. /design-preview + proxy entry deleted (was temporary). Agents' skip-notes reviewed — all judicious (blue/red-semantic buttons, radio labels, chip rows left alone).

Adversarial lens (computed oklch→WCAG ratios): band pairings all pass big (white/slate-900 17.8:1, amber-400 wordmark 10.4:1, dark logout 14.7:1); ONE regression caught and fixed pre-commit — sweep rule 7 dropped form-field borders to zinc-300 (1.48:1 boundary, 1.4.11 + sun lineage) → 15 field borders restored to zinc-400 via field-only markers (min-w-0/appearance-none); secondary buttons keep zinc-300 (label-identified). Locked-behavior check: zero href/copy/aria/structure changes; pins survived untouched (status-colors/tab-bar/manifest). INFO noted for a future spec: white PWA themeColor now seams against the slate band in installed view.

Suites: 359 unit / 27 e2e green; no DB diff. Lesson: tag-scoped regex dies on JSX arrow-function attributes (onChange={(e) => …} contains '>') — use class-combination markers for element-scoped sweeps. OPERATOR: look at the live deploy (any page) — this is the acceptance pass; say "darker/lighter/rounder/flatter" and adjustment rounds are cheap.

## Spec 39 - on-demand report generation + stale-report reaper (2026-06-12)

Status: COMPLETE (operator acceptance: click สร้างรายงาน -> พร้อมดาวน์โหลด in seconds; Railway logs keep saying "No jobs"). ADR 0040 — revision-doc §3.3 executed in the ADR-0034 atrophy shape: fast path ships alongside the worker; Railway retires by finding nothing.

DB (9a85bfb + amendment): reap_stale_reports() + pg_cron report-reaper \*/5 — closes the documented v1 wedge (stuck 'processing' blocked a project's reports forever). Review amendment (20260617000200): reaper ALSO flips stale 'requested' (>15 min = nothing is processing the queue) — without this, pausing the Railway cron would re-open the wedge for rows the fast path failed to claim; WITH it, pausing Railway is safe any time. pgTAP file 27 (13 asserts: security pins, both stale kinds reaped with distinguishing messages, fresh/terminal untouched, cron pin).

App: worker pipeline PORTED (worker/ byte-untouched — Railway Watch Path + it stays the fallback): build-pdf.ts (same locked layout; Sarabun as a base64 server-only module — fs reads don't survive serverless bundling), run-report-job.ts (claim-assumed runner; every error marks failed + full stack to server log, worker parity). generateReport fast path: insert (unchanged) -> admin claim_next_report (same atomic RPC = app+worker can never double-build) -> runReportJob; every failure mode degrades to the sweeper/reaper. pdfkit pinned ^0.17.2 (review: 0.19 layout drift vs the fallback would make fast-path/worker PDFs differ) + serverExternalPackages. maxDuration=60 on the reports page; button catch degrades a platform timeout to a soft message (reaper recovers server-side). Production build green.

Recorded deviations + decisions: after-photos filter REUSES src/lib/photos/current-photos.ts instead of porting the worker's duplicate (equivalent semantics — worker only adds the phase filter, applied at the call site here; covered by current-photos.test.ts); spec checklist amended accordingly. Known accepted shape: claim_next_report is global FIFO, so a PM's click may build an older queued report from another project first — correct (FIFO) and invisible at pilot volume; their own row is claimed by the next click/sweep. Page copy updated (ไม่กี่วินาที). PDF smoke test runs under @vitest-environment node (fontkit Buffer checks fail across the jsdom realm) and pins the embedded Sarabun by name (PDFKit subsets glyphs, so size is no pin). Suites: 362 unit / 27 e2e / pgTAP 640 expected post-push. OPERATOR: try a report; MAY pause the Railway cron whenever — it is now safe; deleting the service + worker/ dir = future cleanup spec.

## Spec 40 - re-skin round 2, operator feedback (2026-06-12)

Status: COMPLETE (acceptance = operator eye on deploy). Feedback: width unused on most pages, blue buttons unprofessional, deliverable/WP hierarchy unreadable. Fixes: (1) desktop width pass — lg:max-w-5xl across hub/list pages (header/nav/content move together), WP detail to xl:max-w-7xl, card lists go lg:grid-cols-2 (width buys DENSITY not stretched cards); AppHeader/HubNav prop unions widened. (2) Primary fills bg-blue-700 → bg-slate-900 brand dark (hover slate-800), blue outlines → slate, /requests chips + hide-completed toggle follow; links/rings/tab-accent/login/pills deliberately stay. Contrast UP (17:1 vs 6.8:1). (3) work-package-list: deliverable group = one elevated card, header = amber-bar + slate-50 band + bold slate-900 name, WP rows divided+contained inside (ring-inset focus, 56px targets); flat mode keeps cards. Reviewer pass clean. 362 unit / 27 e2e. Note for next rounds: operator look-feedback loop is the acceptance mechanism — keep rounds small and shippable.

## Spec 41 - page width unification (2026-06-12) + SESSION CLOSE

Status: COMPLETE. One canonical PAGE_MAX_W (src/lib/ui/page-width.ts, the WP-detail scale) across every content page's header/nav/content; AppHeader/HubNav prop = typeof PAGE_MAX_W — drift is now a TYPE ERROR. Exceptions recorded: login/profile/coming-soon stay max-w-md (single-card forms). Named UPDATEs: hub-nav + app-shell-primitives test pins. 362 unit / 27 e2e.

### Session 2026-06-11 -> 06-12 summary (architecture-revision sprint)

Shipped: revision doc + ADRs 0034-0040 + specs 32-41 (LINE notification infra, in-app purchasing + suppliers, photo downscale, offline queue x2, debt batch, re-skin x3 + width canon, on-demand reports + reaper). Suites end-state: 362 unit / 640 pgTAP / 27 e2e, all green; prod build green. Revision scoreboard: AppSheet atrophy LIVE, notifications BUILT, Railway OPTIONAL (pause-safe), brand identity established. OPERATOR QUEUE at close: re-skin eyeball rounds (feedback loop = design acceptance), LINE activation (checklist §8, ~15 min), 3 AppSheet column TODOs (saves break until done), ONE outdoor phone pass (specs 34+35+37), try an instant report, optional Railway cron pause. NEXT-SESSION CANDIDATES: more look-feedback rounds, procurement-role onboarding (needs a real user), Railway/worker deletion cleanup (after fast-path history), partial deliveries/line items (on demand), queued smalls (DB CHECK caps, dark toggle, real logo asset, dialog a11y, pagination, PWA themeColor seam).

## Spec 42 - PWA standalone LINE re-login, iOS (2026-06-12)

Status: COMPLETE (operator iPhone pass = acceptance). Operator report: installed PWA loses login after logout; LINE re-login bounces through the LINE app to the system browser, session lands in the wrong cookie jar (iOS standalone jar is separate; CSRF state cookie also splits, so the browser-side callback dies oauth_failed). Fix per spec 42: disable_auto_login=true on the authorize URL for iOS standalone launches (verified against LINE Login v2.1 docs — keeps the whole flow in the PWA's in-app overlay via LINE web login), CSS-toggled standalone login anchor (?standalone=1, display-mode arbitrary variants, no 'use client' — ADR 0012 plain-anchor shape preserved), header logout CSS-hidden in standalone (profile-page logout stays, reachable via bottom tab). Android untested — flag is iOS-UA-gated to avoid regressing the shared-jar WebAPK flow.

Test-first: 3 new route tests (tests/unit/line-start-route.test.ts — env.server mocked at module level since serverEnv validates at import), 2 LoginButton tests, 1 AppHeader logout-wrapper pin. Playwright note: role-based locators ignore the display-hidden second anchor (a11y tree), so the existing e2e href pin survives untouched — 8/8 auth e2e green on chromium. Suites: 368 unit / lint / typecheck green; no DB diff.

Recorded limitation + seam: LINE accounts with no registered email/password cannot complete the web login form (mitigation: browser login -> reinstall PWA; site data copies into the container at install). Real fix if it bites = one-time handoff code minting the session in the PWA via the existing generateLink/verifyOtp machinery (spec 42 out-of-scope section). Supabase inactivity timeout must stay "never" (operator check, no code). OPERATOR: iPhone acceptance pass — install PWA, logout, log back in via LINE web login without leaving the app.

## Spec 43 - device-code handoff login for the installed PWA (2026-06-12)

Status: COMPLETE (operator iPhone pass = acceptance). Shipped 398f8da + types reconcile 1fd8df2 (typegen also caught up reap_stale_reports from spec 39); migration 20260618000100 applied via db push (dry-run showed zero drift first); pgTAP 656/656 (640 + file 28's 16). Operator hit spec 42's recorded limitation within minutes (LINE web login = QR or email/password; both unusable). ADR 0041: device-code handoff. PWA login tap -> POST /auth/handoff/start issues {state, device_code} row (login_handoffs, 10-min TTL, outbox zero-access posture) -> LINE auth with auto-login RESTORED (one-tap in LINE app) -> callback validates state against the DB row instead of the cookie (resolveCallbackFlow precedence: valid cookie always wins = browser path byte-equivalent), binds user_email + claims stash, status approved, shows return-to-app notice -> PWA polls /auth/handoff/poll, which atomically claims (approved->consumed) and mints the session onto the poll response via the ADR 0012 generateLink/verifyOtp pair - sb-\* cookies land in the PWA's own jar. Profile write parity (NULL-only + avatar refresh) runs at poll time from the stashed claims. Spec 42 items 1-2 reverted (disable_auto_login + ?standalone=1 anchor dead); logout hiding stands.

New surfaces: migration 20260618000100 + pgTAP file 28 (16 asserts), src/lib/auth/{line-authorize-url,line-token-exchange,handoff-flow}.ts (exchange/verify extracted - both callback paths verify identically), /auth/handoff/{start,poll} routes, StandaloneLoginButton ('use client' justified: fetch + window.open + poll orchestration; useSyncExternalStore for sessionStorage resume - react-hooks/set-state-in-effect rejects the mount-setState pattern, lesson banked), login page handoff=approved notice, proxy PUBLIC_PATHS +2. database.types.ts hand-extended pre-push; reconcile with pnpm db:types post-push. Suites: 395 unit / auth e2e 8/8 / prod build green / pgTAP 656. Security notes recorded in ADR 0041: device_code never in URLs, single-use via atomic claim, claim-before-mint burn tradeoff, uniform expired answers, device-grant phishing class accepted for internal user base (confirm-tap = hardening seam). Seams: poll rate limiting, Android pass.

## Spec 44 - handoff resume hardening, iOS process death (2026-06-12)

Status: COMPLETE (operator iPhone re-test = acceptance). First spec-43 field test failed: row reached approved (browser success page shown) but PWA never claimed - iOS killed the backgrounded PWA during the LINE/Safari excursion and sessionStorage died with it (no resume, no poll, idle button). Client-only fix in StandaloneLoginButton: (1) localStorage + expiry stamp (line_handoff_device_code / line_handoff_expires_at, 600s = server TTL; stale stamp reads as nothing-stored in the useSyncExternalStore snapshot, clearing only in handlers - no side effects in render), (2) popup opened SYNCHRONOUSLY in the tap gesture (window.open after await can fall outside iOS transient user activation), opener nulled, navigated after the start POST; blocked popup -> same-window fallback (safe now that the code persists), start failure closes the orphan popup. Server untouched - approved rows wait the full TTL for a late claimer by design. 8 component tests (popup contract, resume, stale-stamp idle, fallback). Suites: 398 unit / auth e2e 8/8. Lesson banked: iOS standalone PWA storage assumptions - sessionStorage NEVER survives the app-switch kill; any cross-app handshake state must live in localStorage with its own TTL.

## Spec 45 - handoff opens LINE in same window, no popup (2026-06-12)

Status: COMPLETE (operator iPhone re-test = acceptance). Spec-44 field test: home app went ALL WHITE on tap - iOS standalone PWAs have NO tab model; the spec-44 synchronous window.open('', '\_blank') swaps the visible view to a dead about:blank and the later popup navigation never reaches the user. Fix (client-only, third round on ADR 0041): popup path deleted; tap -> start POST -> store code (spec-44 localStorage+expiry) -> SAME-WINDOW navigation to LINE (no transient-activation concern). Return trip = spec 44's resume: PWA resumes (user closes out-of-scope top-bar view) or relaunches cold at start_url; any LoginButton page resumes the poll. Cancel pin caught a REAL bug: cancel from a resumed waiting state mutated only storage (no React state delta) so useSyncExternalStore never re-read - storage mutations now emit to subscribers (proper external store, not the noop-subscribe shortcut). Suites: 397 unit / auth e2e 8/8. Lessons banked: (1) standalone PWA = never window.open, same-window nav + persistent resume state is the pattern; (2) noop-subscribe useSyncExternalStore is a trap whenever mutations can happen without an accompanying state change.

### Specs 43-45 operator acceptance (2026-06-12)

Operator iPhone pass CONFIRMED: installed-PWA LINE login via device-code handoff works end-to-end (tap -> LINE app one-tap -> return -> auto signed in). The spec-42/43/44/45 arc is closed; PWA re-login is no longer a blocker for field rollout. Remaining handoff seams unchanged (poll rate limiting, confirm-tap hardening, Android pass when a device exists).

### Operator decision 2026-06-12: AppSheet config edits DEFERRED

Operator: 'Keep all appsheet edit as pending, we can edit later.' The 3 outstanding AppSheet console TODOs (mark pr_number + cancelled_at/by/reason read-only, shipped_at editable column) stay pending indefinitely. Accepted consequence: AppSheet saves can break on rows touching those columns until done - consistent with ADR 0034 atrophy posture (in-app is the primary write path; AppSheet usage winding down).

## Spec 46 P1 - daily labor capture (2026-06-12)

Status: COMPLETE (operator phone pass = acceptance). Shipped be0cd4c + pgTAP pin update 4b6b6a1; 3 migrations applied (dry-run showed exactly the 3, zero drift); pgTAP 696/696 after the named enum-pin updates in files 03+18 (the spec-33 "grep ALL pins when an enum grows" lesson struck again — worker_change broke both full-label-set pins, caught post-apply, fixed same session). db:types regen byte-identical to the hand-written extension. Head Tech surplus-share pilot needs labor cost per WP; system captured zero labor data (largest model gap; DC logged days double as payroll). Operator stress-test round resolved C1-C7 pre-spec (no variance view existed; supersede kills unique indexes -> advisory-lock RPC; column grants can't split sa/pm because both are authenticated -> rate columns get ZERO authenticated grant, service-role-only reads behind requireRole(pm/super); techs get NO access change - C4 operator call: verbal report, SA/back-office enters).

Shipped P1: migrations 20260619000100-300 (worker_change audit action; workers master w/ own|dc + contractor FK + user link + zero-grant day_rate + create/update/set-rate RPCs pm/super; labor_logs append-only supersede table w/ zero-grant day_rate_snapshot, snapshots frozen at entry, self_logged computed server-side, log_labor_day + correct_labor_log RPCs sa/pm/super under pg_advisory_xact_lock per (wp,worker,date) - duplicate/inactive/complete-WP refusals, tombstone removals, reason-required corrections). pgTAP file 29 (40 asserts incl. money-posture 42501 pins, append-only triple layer, re-log-after-tombstone). App: lib/labor (validate w/ 14-day backdate gate for SA, current-logs anti-join filter, group-workers, bangkok dates, actions w/ per-worker failure aggregation), LaborLogZone on SA+PM WP pages (presence-only props, fraction toggles, correction dialog, self-log badge PM-only), /workers roster page (pm/super, admin-client rate reads, RPC-only writes). database.types hand-extended. Suites: 422 unit (27 new) / lint / typecheck / build / auth e2e 8/8 green; pgTAP pending push.

Open (P2, same spec): wp_labor_costs freeze at complete, PM cost view w/ >1.0 worker-date surfacing, photo-vs-log variance strip (>=2 day symmetric difference default). Open question recorded: /workers has no nav entry yet (reachable by URL; nav-set change = own small spec); offline = simple retry by design (operator-approved).

## Spec 47 - purchase request detail page (2026-06-12)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator brief: "Clicking should open into order details." New route /requests/[requestId] (same requireRole gate as /requests; non-UUID or RLS-invisible id -> Thai 404, the ?wp= convention); detail screen carries everything the fat card held - tracker, facts, rejection comment, supplier/receiver/note, reference attachments + stager (own x requested), delivery confirmations + uploader (on_route/delivered), and the four role-gated action zones byte-same gates (decision, record-purchase w/ suppliers fetched only then, ship, cancel). List card extracted to PurchaseRequestCard (server-presentational, whole-card Link, chevron, hover wash + ring-inset focus per spec-40 row convention) keeping the at-a-glance set: WP line, PR number, item, qty, requester + Thai badge, needed-by, pills, tracker. List page dropped its attachments/suppliers fetches (lighter query set). Header WP line on detail links to the WP screen. Recorded consequence: PM decisions + back-office recording are one tap deeper - accepted, list is scannable now. Test-first: purchase-request-card.test.tsx (4 asserts: link href, PR/status content, own-badge toggle, NO form/button - slimness is the contract) RED then GREEN. Suites: 426 unit / lint / typecheck / prod build (route registered) / auth e2e 8/8. No DB diff.

### Spec 47 amendment - WP-detail rows clickable too (2026-06-12)

Operator clarified the brief came from the WP detail page. Its khamkhosue zone now renders PurchaseRequestCard per row (workPackage prop null - zone IS the WP context); tap opens /requests/[id] from both surfaces. Page select widened to the card prop set; requester ids unioned into the existing approval-history display-name lookup (still one query). Zone gains priority pill + needed-by + own-badge as a side effect of card reuse - recorded, consistent with /requests. PM review page has no request zone (verified) - SA WP route is the only other surface. Covered by the existing card test contract. Suites: 426 unit / lint / typecheck green.

## Spec 48 - requester notes on purchase requests (2026-06-12)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator WP-detail feedback item 2: "Allow user to include some notes." Migration 20260620000100 applied (dry-run showed exactly the 1 file, zero drift): purchase_requests.notes text, WRITE-ONCE posture - grant insert(notes) to authenticated only, NO update grant (the note is part of what the PM decided on; spec-33 column-scope doctrine), appsheet_writer untouched (ADR 0034 freeze), no DB CHECK (item_description posture, spec-36 queued follow-up). pgTAP file 30 (3 privilege asserts) - 699/699. Test-first: 5 validator cases RED then GREEN (blank->null, trim, 1000 cap with Thai message, exact-1000 boundary; the typical-input toEqual pin named-UPDATEd for the new field). Validator + createPurchaseRequest thread notes; form gains textarea after urgency (maxLength 1000, 3 rows, zinc-400 field border); detail page renders it in the facts card (whitespace-pre-wrap); slim cards deliberately omit it. db:types regen reconciled byte-identical to the hand extension (after prettier - regen drops semicolons, the spec-43 lesson now has a known shape). Suites: 430 unit / lint / typecheck / build / pgTAP 699. Out-of-scope recorded: note editing, PM note threads, notes in LINE payloads.

## Spec 49 - photo filmstrip (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass). Operator WP-detail feedback item 3: "images get too long and scrolling down further and further is against intuition." Per-phase photo grids grew the page vertically without bound; zones below the photos vanished at field volumes. Fix: shared PhotoStrip primitive (src/components/features/photo-strip.tsx) - one horizontal snap-scroll row (flex gap-2 overflow-x-auto snap-x pb-1) + exported PHOTO_STRIP_TILE fixed-square tile constant (h-28 w-28 shrink-0 snap-start ...) so both surfaces stay in lockstep (PAGE_MAX_W idea at component scale). Swapped on BOTH WP surfaces: SA phase-uploader (Thumbnail + PendingTile take the constant; upload lifecycle/remove overlay/ConfirmDialog/queue bracket untouched) and PM PhaseGallery. Phase headings announce the hidden tail: label (N). Page height now constant per phase - more photos = sideways swipe. Test-first: photo-strip.test.tsx (scroll classes + tile geometry pins) RED then GREEN. Zero leftover photo-grid classes (grep). Out of scope recorded: lightbox swipe-between-photos seam, grid toggle, virtualization. Suites: 432 unit / lint / typecheck / build green. No DB diff.

## Spec 50 - lightbox swipe between photos (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass). Operator feedback item 4 first half: "users should be able to slide between pictures left and right" - closes the spec-49 recorded seam. ZoomablePhoto gains optional group/groupIndex props (absent = byte-same single-photo behavior, pinned by the 5 existing tests passing unmodified): dialog opens on the TAPPED photo, prev/next scrim buttons (44px, disabled at ends - non-wrapping by design), ArrowLeft/Right keys, horizontal pointer swipe >= 48px (vertical drags ignored; touch-pan-y + draggable=false on the img), position counter n/total top-left, all hidden for singletons. Groups threaded on 3 surfaces, never spanning sections: SA phase strip (loaded photos per phase), PM PhaseGallery (same), /requests/[id] reference images + delivery confirmations as separate groups. Pending/missing-URL tiles are not group members. Test-first: 6 new lightbox tests RED then GREEN (tapped-photo open + counter, end-disable, arrow keys incl. non-wrap, re-open resets to tapped, singleton/no-group chrome absence). Suites: 438 unit / lint / typecheck / build green. No DB diff. Second half of item 4 (drawing + comments) = spec 51, same session.

## Spec 51 - photo markup: drawing + comments (2026-06-12)

Status: COMPLETE (acceptance = operator phone pass - finger drawing is the make-or-break surface). Operator feedback item 4 second half: "Enable drawing and commenting feature on the image." Doctrine honored: markup is OVERLAY DATA - photo bytes never touched (CLAUDE.md immutability; render-at-view like the ADR-0003 watermark posture); photo_markups is append-only with tombstone removal (supersede-pattern skill loaded; ADR 0004/0009/0015), shaped byte-for-byte on the attachments precedent: content row (>=1 of strokes/comment, supersedes nothing) XOR tombstone, composite same-parent FK, one-tombstone partial unique = anti-join index, triple enforcement, security_invoker current view, table-qualified self-referential policy refs. RLS: sa/pm/super read+insert, creator pin, creator-only tombstone. Migration 20260620000200 applied (dry-run exact); pgTAP file 31 (25 asserts: posture, both malformed shapes, P0001 trigger, 42501 privilege layer, role-sim matrix incl. forged-author + foreign-tombstone denials, view drop after tombstone, dup-tombstone 23505) - 724/724. App: validate-markup.ts (>=1 payload, comment 1000 cap, strokes <=50x500 pts normalized [0,1] - 6 tests RED first), actions (list w/ display names + isMine, add, remove via tombstone), lightbox markup UI (photoId + groupPhotoIds aligned with the spec-50 group so markup follows navigation; SVG overlay viewBox 0..1 + non-scaling stroke; compose mode = pointer drawing + undo + comment textarea + standard save lifecycle; nav gated while composing; ConfirmDialog for delete - bubbling stopped, the nested-dialog-closes-parent hazard). WP surfaces thread ids; request attachments deliberately do NOT (not photo_logs - recorded boundary). Component tests: 4 markup + spec-50 file gained the action-module mock preamble (server-only import poison - the established client-test pattern; zero assertion changes). Suites: 448 unit / 724 pgTAP / lint / typecheck / build. Seams recorded: LINE notify on comment, markup in PDF reports, colors/tools.

## Spec 52 - WP status transitions: during -> in_progress + on-hold toggle (2026-06-13)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator request: "in_progress when during images are uploaded; as for on_hold, allow PM and up to toggle on/off." Spec: docs/feature-specs/52-wp-status-transitions.md. The previously-dead enum values now move: (A) first During photo flips not_started -> in_progress — new shouldTransitionToInProgress predicate + second option-(a) guarded admin UPDATE in addPhoto (.eq status not_started SQL layer; deliberately does NOT release on_hold — that release belongs to the PM toggle; offline-queue replay needs nothing, the guard no-ops on re-entry; outbox trigger fires on pending_approval only, so no stray notifications). (B) setHoldStatus PM/super action — NO admin escalation (work_packages UPDATE RLS already admits pm/super; RLS is the backstop), hold only from not_started/in_progress (pending_approval refused: pausing a queued WP is done by deciding, not hiding), release re-derives the landing status from current During photos via deriveReleaseStatus (no snapshot column, no schema change: in_progress now means exactly "current During photos exist"); HoldToggle client component on the PM WP header (outline พักงานชั่วคราว / solid กลับมาดำเนินการ, hidden on pending/complete; SA page stays read-only per the operator's "PM and up"). Recorded decisions: no audit rows (consistent with both existing transitions; updated_at records when), /pm queue ordering untouchable by the toggle (hold impossible on pending). Test-first: 3 transition-matrix tests + new wp-hold.test.ts (6) RED then GREEN. No DB diff, no migration, no pgTAP delta. Suites: 457 unit / lint / typecheck green.

## Spec 53 - refresh button on every content page (2026-06-13)

Status: COMPLETE (acceptance = operator tap on deploy). Operator rider on the pending design request: 'Also include a refresh button' - shipped first because it is independent; the installed PWA has NO reload chrome, so stale server-component data forced kill-and-relaunch in the field. RefreshButton client component (router.refresh in useTransition - keeps client state incl. the offline-queue banner, deliberately not a hard reload; RotateCw icon, 44px target, aria-label="รีเฟรช", animate-spin while pending, dark/light variants on the LogoutButton prop shape). Placement: AppHeader dark variant (every hub page; NOT standalone-hidden - pinned by a new test, the inverse of the spec-42 logout pin) + light variant right-aligned in the back-link row of all four bespoke detail headers (SA project WP list, SA WP detail, PM WP detail, /requests/[id]). Recorded exceptions: /profile, /coming-soon, /login (max-w-md single-card pages, no stale surface). app-shell-primitives suite gained the next/navigation mock (AppHeader now mounts a useRouter consumer). Test-first: refresh-button.test.tsx 3 tests RED then GREEN. No DB diff. Suites: 461 unit / lint / typecheck green. PENDING from the same operator message: 'designs similar to this for all pages' - reference attachment never arrived in-session; operator says he will re-attach. Design sweep = next unit once the screenshot lands.

## Spec 54 - WP detail redesigned to the operator's mockup (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy; tuning rounds expected per the spec-40 loop). Operator sent a mockup screenshot ('designs similar to this for all pages'): this unit rebuilds the REFERENCE page (SA + PM WP detail) and extracts the primitives; remaining pages follow in later rounds. New primitives: derivePhaseProgress (pure: doneCount / currentPhase = LAST phase with photos / 3 segments complete-current-empty, gap phases stay empty - 5 matrix tests), PhaseProgressBar (green/blue/zinc segments + Thai caption), AttentionCard (amber/red left-bar callout, role=alert - REPLACES the bespoke rejected/needs_revision strip so one attention pattern serves the app), CountChip (amber pill + numbered disc, null at 0), formatThaiTime (HH:MM h23 Bangkok pin, raw-string degradation). SA page: back chip header (44px rounded-xl, ArrowLeft) + refresh, code over text-2xl bold name + pill, progress band, attention stack (PM decision card / unassigned-contractor card wrapping the UNTOUCHED WpAssignmentPanel / requested-count chip anchored #wp-requests), assigned-contractor line + panel stay in header. PhaseUploader restyled to timeline rows: check disc (green >=1 photo) + label + N rup, rail-indented body, last-updated line, strip gains dashed Camera 'add' FIRST tile (same hidden input - upload/queue/remove machinery byte-equivalent, header button removed), tiles get capture-time gradient overlays (captured_at_client ?? created_at). PM page: same header shape (HoldToggle + create-request link share a row), progress band, PhaseGallery mirrors the timeline treatment read-only. Recorded deviations (data-honest): no photo captions (no column - own spec), no quota so no 'thai krob laew' line, no per-phase edit link (per-tile removal already exists), chip counts status='requested'. Test-first: 12 tests across phase-progress/attention-card/count-chip RED then GREEN. Suites: 473 unit / lint / typecheck / prod build green. No DB diff. NEXT ROUNDS: same language on hub/list pages + request detail after operator eyeball.

## Spec 55 - mockup design language round 2 (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator 'proceed' after spec 54: remaining detail surfaces adopt the language. /requests/[requestId]: back chip (spec-54 shape, RefreshButton stays), title to text-2xl bold, rejection block -> AttentionCard red (one attention pattern, third adopter). /sa/projects/[projectId]: back chip + text-2xl bold project name. Recorded NOT-touched: reports-page back link lives in a tab-style nav row (not a detail back); hub pages KEEP the AppHeader brand band - the mockup shows a detail screen, no evidence the operator wants the band gone; ask via feedback loop, do not guess. Pure restyle - no new logic, no tests added (spec-40 precedent; AttentionCard contract already pinned). Suites: 473 unit / lint / typecheck / prod build green. No DB diff. Remaining design seams: hub/list card language (pending operator direction on the band), photo captions column (operator word pending), per-WP progress hints on the list page (needs a photo-count query - candidate only).

## Spec 56 - WP list: status-view filter, search removed (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator screenshot feedback: hide finished by default, 'should there be more items to pick though?', no search on WP list. Answer shipped: search box + hide-completed checkbox REPLACED by a four-view segmented control (spec-21 shape, radiogroup semantics): ngan khang (default - everything not complete), ro truat (pending_approval only - what waits on the PM), set laew (complete only), thangmod (no filter). Pure helper src/lib/work-packages/list-filter.ts (WP_LIST_VIEWS registry + filterByView + DEFAULT_WP_LIST_VIEW pinned to outstanding) - 6 tests RED then GREEN; component maps the registry. Search force-expand (the spec-11 'searching overrides collapse' rule) deleted with the search box; group headers still derive progress from the UNFILTERED list (spec-12 truth rule); empty copy reworked per view. Local state only, no URL param. Suites: 479 unit / lint / typecheck / prod build green. No DB diff. Recorded: PM-side list reuse imports the same helper if a later round wants the control there.

## Spec 57 - long WP names never truncate + WP-centric principle recorded (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy). Operator screenshot: WP02 name cut to '(+0.0...' on the new detail header; plus the standing principle 'WP is the center of information - Scope/Time/Resource everything is mapped against WP' (now binding for future rounds; recorded in ui-conventions.md section 5 + assistant memory). Class-only fixes: detail-page subjects NEVER truncate (SA WP h1, PM WP h1, request item_description h1 -> break-words full wrap); list rows clamp at two lines, never single-line truncate (WP list rowLink, /pm queue code-name line -> line-clamp-2 break-words); meta/context lines may keep truncate (project line, WP link on request detail - context, not subject). PurchaseRequestCard untouched (slimness is a test-pinned contract). ui-conventions.md section 5 also caught up with the spec-54/55 detail-header reality (text-2xl bold + 44px back chip). Suites: 479 unit / lint / typecheck / prod build green. No DB diff.

## Spec 58 - project settings page for back office (2026-06-13, ADR 0042)

Status: COMPLETE (acceptance = operator tap-through on deploy). Operator: 'Add Project setting page for back office people.' First in-app projects write surface. ADR 0042: SECURITY DEFINER RPC update_project_settings(p_project_id, p_name, p_status) instead of widening the ADR-0013 super-only UPDATE policy (column-scoping by definition - name+status ONLY, the spec-31 set_work_package_contractor shape; ADR-0011 checklist: search_path pinned, 42501 role check inside, revoke-then-grant). Gate = pm/super: procurement is in the spec-33 back-office helper but has NO projects SELECT and no UI reach - recorded as the procurement-onboarding unit's job. code IMMUTABLE from the app (ADR-0014 import contract keys on it); name validated in BOTH layers (app validator trim/1-200 + RPC 22023); no audit rows (spec-52 precedent); project CREATION stays console/import. Shipped: migration 20260621000100 applied (dry-run showed exactly the 1 file), pgTAP file 32 (13 asserts: definer/search_path/grant pins, role sims pm-ok/sa-42501/visitor-42501, blank-name 22023, unknown-id false, trim landed, code untouched - plan-count was 12, runner caught the 13th, the recurring count lesson), db:types regen byte-identical to the hand extension after prettier. App: /sa/projects/[id]/settings (requireRole pm/super; spec-54 header, read-only code line, SettingsForm client w/ name input + status select PROJECT_STATUS_LABEL + saved/error surfaces), updateProjectSettings action under USER session (RPC = load-bearing layer), gear chip on the project page back-row rendered for pm/super only. Test-first: 5 validator tests RED then GREEN. Suites: 484 unit / 737 pgTAP / lint / typecheck / prod build green.

## Spec 59 - site-map audit + one project page (2026-06-13)

Status: COMPLETE (acceptance = operator round-trip on deploy). Operator: 'entering the project shows a page, but pressing back from WP list takes user to what appears to be a different page. Recheck all the site map.' Audit verdict: PM project flow crossed THREE 'project' surfaces - /pm/projects rows opened the REPORTS page (not the project), its rai-kan-ngan link led to the WP list, whose back chip was HARDCODED '/sa' = the SA home (a second, different-looking project list). SA flow was already consistent. Fix: (1) /pm/projects rows -> /sa/projects/[id] - the WP list is THE project page for every role (WP-centric doctrine); (2) WP-list back chip role-aware via new projectHubHref(role) in role-home.ts (sa -> /sa, pm/super -> /pm/projects, else roleHome) - 3 tests RED then GREEN; (3) reports reachable via a FileText chip in the project-page header row (pm/super, next to the spec-58 gear) -> /pm/projects/[id]/reports (reports page nav row already round-trips); (4) NEW docs/site-map.md - full audited inventory (route x gate x entry edges x back target), nav changes must update it in the same unit (the ui-conventions contract). Spec-12 locked-back-targets note: this is the operator-driven amendment for the WP-list target; all other back targets verified unchanged. Recorded seams: /sa vs /pm/projects dual hubs (merge = design-round candidate), /workers still has no nav entry, procurement column empty. Suites: 487 unit / lint / typecheck / prod build green. No DB diff.

## Spec 60 - reports page: detail header + standalone-safe download (2026-06-13)

Status: COMPLETE (acceptance = operator phone pass - share sheet on the installed PWA is the make-or-break). Operator items 1-2: 'Remove these urls, add back button. Pdf download is not working.' Item 1: AppHeader + three-link nav row REPLACED by the spec-54 detail header (back chip -> /sa/projects/[id] per spec 59 entry, refresh, code over text-2xl rai-ngan + project-name line); duplicate project card in the body removed; site-map.md row updated same-unit (its contract). Item 2 root cause: window.open('\_blank') AFTER an await - the spec-45 lesson verbatim (installed PWA has no tab model + iOS transient activation spent). Fix: blob flow - getReportDownloadUrl now mints the signed URL with {download: fileName} (attachment disposition) and returns fileName; new buildReportFileName(code, createdAt) pure helper ({code}-report-{YYYYMMDD}.pdf, Bangkok-pinned, dateless degradation - 3 tests RED then GREEN); DownloadButton fetches the bytes then navigator.share({files}) when canShare (iOS share sheet: Save to Files/LINE/AirDrop; AbortError = silent close) else object-URL anchor[download] click (desktop/Android); failures land on the existing Thai strip. Suites: 490 unit / lint / typecheck / prod build green. No DB diff.

## Spec 61 - PM control over report content (2026-06-13)

Status: COMPLETE (acceptance = operator report try-out). Operator item 3: 'PM needs control over what's being reported under สร้างรายงาน button.' Params model (src/lib/reports/params.ts): scope complete|all + photos after|all_phases|none; DEFAULT = {complete, after} = the legacy report; parseReportParams NEVER throws - per-field fallback so '{}' (every pre-61 row, and anything malformed) renders legacy (5 tests RED then GREEN). Migration 20260621000200 applied: reports.params jsonb not null default '{}' (rides existing policies; written once at INSERT); pgTAP file 12 +2 asserts (type + default) - 739/739. Builder: ReportInputWorkPackage.afterPhotos -> photoGroups [{label, photos}] + optional statusLabel in headings (scope=all) + includeEmptyWorkPackages (photos=none -> compact text listing, skip-empty rule disabled - the listing IS the report); PDF smoke tests named-UPDATEd to the new shape + a spec-61 case. Runner: parses job.params, scope drives the WP query filter, photos mode drives which phases download (after keeps the unlabelled legacy group; all_phases prints Thai phase labels). UI: GenerateReportButton grew two RadioChip groups (ngang-tee-ruam / roop-thai, spec-21 segmented lineage, defaults = legacy); action normalises via parseReportParams and stores the canonical literal (interface-vs-Json index-signature lesson: spread to a literal). claim_next_report Returns + reports Row/Insert/Update hand-extended; db:types regen reconciled exactly. RECORDED RISK: the byte-frozen Railway worker IGNORES params - window = fast-path claim failure only (rare; cron sweeps every ~5 min); a worker-built params report = legacy content marked complete. Operator MAY pause the Railway cron (safe since the spec-39 reaper amendment) to close the window - nudged via Telegram. Suites: 496 unit / 739 pgTAP / lint / typecheck / prod build green.

## Spec 62 - sticky headers (2026-06-13)

Status: COMPLETE (acceptance = operator scroll-test on deploy). Operator: 'headers and footers are not fixed in place.' Audit: BottomTabBar already fixed bottom-0 z-40 on every content page (spec 19) - the defect was headers scrolling away. Class-only fix: sticky top-0 z-20 on AppHeader (all hub pages) + the six bespoke detail headers (SA WP list, SA WP detail, PM WP detail, request detail, project settings, reports). z-stack recorded in the spec: headers 20 < upload-queue banner 30 < tab bar 40 < dialog/lightbox scrims 50 - chrome never covers an overlay. Deliberately NOT sticky: the WP-detail progress band + attention stack (pinning the full block would eat a third of a phone viewport; the identity row is what must stay). One new AppHeader sticky pin (RED then GREEN). Suites: 497 unit / lint / typecheck / prod build green. No DB diff.

## Spec 63 - consolidate the reusable chrome (2026-06-13)

Status: COMPLETE (acceptance = operator eye on deploy - nothing should LOOK different). Operator: 'the reusable elements should be consolidated, so that when there is a change of design, every page remains consistent by default.' The 54-62 rounds had hand-copied class strings: 44px icon chip x8, slate primary button x8(+2 variants), inline error strip x6, sticky detail-header shell x6. Shipped: (1) src/lib/ui/classes.ts - canonical constants (BUTTON_PRIMARY/SECONDARY, ICON_CHIP/\_MUTED, INLINE_ERROR, CARD; constants not components because the same classes land on button/label/Link - the PAGE_MAX_W idea applied to chrome); (2) DetailHeader feature component (back chip + refresh + actions slot + sticky z-20 shell; 3 tests RED then GREEN) adopted by all six detail pages with per-page back targets/aria-labels preserved verbatim (site-map contract); (3) constants adopted across 10 files (7 byte-identical primary sites + hold-toggle secondary + 6 error strips; TWO recorded normalizations: generate-report px-5->px-4 + w-fit composed, purchase-request-decision px-3->px-4 - the only visual deltas, both ~4px padding); (4) ui-conventions.md section 5: hand-rolling these patterns = review reject. Out of scope (recorded): full-app CARD sweep, labor-log-zone's divergent button styles (font-medium, no ring - candidate for a later normalization round), error/not-found rounded-md buttons. Suites: 500 unit / lint / typecheck / prod build green. No DB diff.

## Spec 64 - fixed app shell: chrome that cannot drift (2026-06-13)

Status: COMPLETE (acceptance = operator phone re-test, scroll + overscroll bounce). Operator after spec 62: 'header and footer sticky is not working properly.' Diagnosis: spec-62 sticky/fixed are structurally correct (no overflow/transform ancestors - audited globals.css + root layout) but ride the BODY scroller; iOS standalone rubber-bands body scrolling, so chrome drifts during the bounce - works in DevTools, drifts in the field. Fix = the canonical PWA shell: body LOCKED (h-full overflow-hidden) + new PageShell component (spec-63 consolidation: ONE shell, every route) whose main is the only scroller (h-full overflow-y-auto overscroll-y-contain) with variants app (zinc wash + tab-bar clearance) / card (centered single-card) / bare (profile + coming-soon hub supply their own). All 18 mains across routes swapped; 4 PageShell tests RED then GREEN; ui-conventions section 5 page anatomy rewritten (hand-rolled main = review reject). LIVE-VERIFIED in the preview browser: body overflow hidden at viewport height, main = sole scroller w/ overscroll containment, card variant renders. error.tsx lesson: never prepend imports above 'use client' (directive must stay first statement). Honest caveat recorded: this is the canonical bounce-drift fix; if the operator's symptom was something else (keyboard overlap etc.) the re-test will say so and the shell is the right foundation regardless. Suites: 504 unit / lint / typecheck / prod build green. No DB diff.

## Spec 65 - consolidation pass: behavior-preserving refactor (2026-06-13)

Status: COMPLETE (acceptance = suites; nothing may LOOK or BEHAVE different). Session brief: "full refactoring session." Method: 5-surveyor multi-agent sweep over src/ (76 candidates) + adversarial verification per candidate (66 confirmed, 10 rejected as churn/unsafe); spec 65 took the mechanical byte-identical subset; 6 parallel builder agents on disjoint file sets. Shipped: (1) NEW shared primitives, each TDD-first - src/lib/validate/uuid.ts (UUID\*REGEX/isValidUuid; was 11 private copies + 2 duplicate type-guards; photos/path.ts re-exports), src/lib/dates.ts (bangkokTodayIso + ISO_DATE_REGEX; was 3+3 copies; labor/dates.ts re-exports), src/lib/storage/buckets.ts + storage/signed-urls.ts (generic mintSignedUrls core; the photos/attachments pair were self-described clones, now thin wrappers; closes the recorded missing-test note), src/lib/db/enums.ts (canonical enum aliases; 12 modules converted to re-exports), src/lib/auth/action-gate.ts (getActionUser + NOT_SIGNED_IN; replaced 22 copy-pasted getUser gates with byte-identical returns incl. the reports `reason` shape), src/lib/photos/phases.ts (PHASES + latestCreatedAt; was verbatim x2 in WP pages), PM_ROLES/SITE_STAFF_ROLES in role-home.ts (3 local consts + inline arrays), PHOTO_ACCEPT_MIME derived in photos/path.ts (3 hand-written accept lists). (2) classes.ts +10 constants (SECTION_HEADING, DETAIL_TITLE, FIELD_INPUT/\_SELECT/\_STACKED, BUTTON_PRIMARY_COMPACT/\_SECONDARY_COMPACT/\_SECONDARY_MUTED, INLINE_ALERT_TEXT, BANNER_ERROR) all byte-pinned in ui-classes-spec65.test.ts; CARD adopted at its 9 verbatim sites (was a zero-consumer export); near-variants deliberately untouched and recorded. (3) requests/actions.ts: findLandedAttachment helper (ADR-0039 identity-complete replay check, was verbatim x3; purpose now a param), readPrParent (x2), repeated Thai literals hoisted to file-local consts (strings byte-identical). (4) Type hygiene: ~10 redundant identity casts deleted (one load-bearing cast found in line/callback route restored + recorded - the row annotation is the real fix); latest-decision.ts stale "client is untyped" comment corrected; LaborDisplayRow moved to src/lib/labor/types.ts (fixes lib-imports-from-component inversion); LaborLogZone dead projectId prop removed. (5) Dead code: fetchAssignableStaff/StaffOption deleted, formatPrNumber + DOWNSCALE_QUALITY unexported, ui/card.tsx + ui/button.tsx + button.test.tsx deleted, tsconfig \*\*/\_.mts + eslint out/build ignores + tests/unit/.gitkeep removed. (6) Test infra: server-only neutralized ONCE via vitest resolve.alias stub (14 per-file vi.mock preambles deleted, 4 were already dead); shared tests/helpers/router-refresh.ts (5 files). (7) PR_LIST_COLUMNS in purchasing/columns.ts; detail page composes + ", notes". Stale /requests?wp= comment fixed (PM screen is the remaining producer - NOT orphaned). Audit: 91 files, +501/-794 (net -293), zero migrations, Thai diff audit clean (every removed Thai line = hoisted literal or className swap). DEFERRED QUEUE (each needs own spec): uploader pipeline extraction + uploadPhotoIdempotent (write component tests FIRST), ConfirmActionButton trio merge, ProjectListSection for the sa/pm hub pair, PageSkeleton->PageShell (VISUAL - operator sign-off), parseRequestsSearchParams, requireSessionProfile, serverEnv test-mock dedup, e2e proxy-protection parametrize, Pick<Row> prop types, test gaps (run-report-job, labor error mapping, stager/runner/roster components), purchase-request-form unit select = FIELD_SELECT byte-match found post-pass. Suites: 541 unit (75 files) / lint / typecheck / prod build green. No DB diff.

## Spec 66 + ADR 0043 - documents have a home; on-site purchases recordable (2026-06-13)

Status: COMPLETE (migration APPLIED to prod 2026-06-13, pgTAP 765/765). Site-staff feedback (2 gaps): invoices/receipts that arrive with a delivery had no named upload home; on-site CASH purchases (no request->approve) could not be recorded so the receipt+spend had nowhere to live. Operator calls: record + PM-acknowledge; capture item + receipt; feature-first (design-critique remediation = next unit, spec 67). MODEL (red-teamed by a Plan agent, which flipped one call): new attachment purpose 'invoice' (ใบส่งของ/ใบเสร็จ, image-only v1; PDF = seam); DEDICATED status 'site_purchased' NOT a reuse of 'delivered' (reuse would leak site buys into the appsheet_writer worklist + render the wrong uploader + conflate delivery audit, all via UNCOMPILED predicate edits; a new enum value's blast radius is typecheck-enforced via the exhaustive switch/Record + one pgTAP pin = lower net risk); acknowledged_at/by columns (RPC-only, NOT in any authenticated grant) as the PM-ack gate, badge DERIVED from source+acknowledged_at not a status change; source='site_purchase' discriminator (pr_source_valid CHECK widened - it would have hard-failed 23514 otherwise, red-team catch). Two SECURITY DEFINER RPCs: record_site_purchase (role gate + input re-checks + WP-EXISTENCE probe [SECURITY DEFINER bypasses RLS; v1 access is role-level per ADR 0013 so no per-project scope to probe - role+FK is the full guard], creates the row born terminal, ONE action='insert' audit row reusing the existing enum value [no new audit_action], returns id so the client immediately attaches the receipt) + acknowledge_site_purchase (pm/super, idempotent, scoped). Invoice RLS arm added DROP+CREATE in place (policy name unchanged so policies_are pin stays green; preserves the pr_attachment_tombstone_target_ok 42P17 recursion cure + objects.name qualification; tombstone helper extended so invoice is creator-only removable); storage upload policy widened to purchased/site_purchased. 5 migrations (20260622000100-000500; ALTER TYPE ADD VALUE each its own txn). App: validate-site-purchase (test-first), 3 server actions (recordSitePurchase/addInvoiceAttachment/acknowledgeSitePurchase), database.types.ts hand-extended then reconciled byte-exact with db:types regen. UI (WP-centric): บันทึกการซื้อหน้างาน form on the SA WP-detail purchasing zone (records then immediately reveals the receipt uploader); a NAMED เอกสาร (ใบส่งของ/ใบเสร็จ) section on the request detail visible whenever status in purchased/on_route/delivered/site_purchased (the discoverability fix - a document home appears the moment a delivery lands); site-purchase รอ PM รับทราบ AttentionCard + รับทราบ button (benign action = plain button, not the red ConfirmDialog); requisition stepper hidden for site purchases. CORRECTNESS FIX found while wiring: the request-detail attachment split treated any non-confirmation image as 'reference' - invoices would have leaked into the reference section; split out explicitly. InvoiceUploader is a lean immediate uploader (offline-queue bracket = recorded seam, unlike DeliveryPhotoUploader). LESSONS: (1) adding a status enum value breaks EVERY enum_has_labels pin - files 17 AND 19 both pin the status set (grep-all-pins struck again; updated both, plan counts unchanged since it's a modify not an add). (2) pgTAP under `set local role authenticated` cannot write the runner's \_tap_buf collector table+sequence (42501) - needed `grant insert on _tap_buf` + `grant usage on sequence _tap_buf_ord_seq` to authenticated before the role switch, and `reset role` before finish()/read-back (file 26's pattern). (3) append-only UPDATE under authenticated throws 42501 (privilege layer) NOT P0001 (the block trigger that catches privileged roles) - three-layer append-only, the privilege layer fires first. Seams: PDF invoices, push-notify PM on site purchase, a PM awaiting-acknowledgement queue, amount/supplier capture on site purchases. Suites: 548 unit / 765 pgTAP / lint / typecheck / prod build all green.

## Spec 67 - design-critique remediation + anti-drift pins (2026-06-13)

Status: COMPLETE (8 of 9 survivors; #8 disclosure-chevrons deferred as subjective minor). Closes the design "zero-day" found by the ruthless multi-agent critique earlier this session: SIX of the flaws were the code contradicting the team's OWN written doctrine, surviving because nothing enforced the rules and the one-operator look-loop (one iPhone, one SA account, short seed data, clean indoor screen, normal colour vision, tap-only) structurally cannot surface them. Fixes: (1 CRIT) Thai leading - DETAIL*TITLE += leading-snug (a Thai-only app had ZERO leading override anywhere; wrapped headings crowd stacked tone marks); (2 CRIT) WP-list deliverable group header truncate -> line-clamp-2 break-words (spec-57 hard floor; Thai has no inter-word spaces so truncate shears mid-word); (3 CRIT) all FOUR window.confirm removed (shared ConfirmActionButton for the 3 identical destructive buttons [cancel/ship/attachment-remove, which were copy-paste dups] + inline ConfirmDialog for the queue discard) - the native sheet shows a raw origin string in the installed PWA on the most irreversible actions; (4+7 MAJOR, one fix) extracted RadioChip (native sr-only radio = keyboard + SR from the browser, 44px) from generate-report-button to a shared component; adopted on the WP-list view filter (was min-h-9 36px + fake role=radio on buttons) AND the worker-type picker (fake radiogroup recurrence) AND deduped the report page - kills the sub-44px tap target AND the lying-radiogroup a11y defect together; (5 MAJOR) purchase-request-tracker text-[11px]/[10px] -> text-xs, zinc-500 meaningful dates -> zinc-600 (the §3 floor), leading-tight -> leading-snug; (6 MAJOR) token canon unified: emerald=done, amber=current, blue-700=links-only - killed off-palette green-600 x5 (phase-progress-bar + phase-uploader + pm WP page done-badges) and the reserved-blue progress fill (current phase was bg-blue-700, the tappable-link hue on a non-tappable bar inches from real tel: links); (9 MINOR) dead .dark palette removed from globals.css (never applied, contradicts "no .dark ever"), /workers got a real PM/super link from the labor empty-state (was dead prose - the orphaned-page reachability seam). THE POINT OF THE UNIT: tests/unit/design-doctrine.test.ts reads src/ as text and FAILS on any recurrence (window.confirm( call, off-palette green-*, min-h-9, group-header truncate, missing DETAIL*TITLE leading, blue progress fill) - drift is now a red test, not a thing the operator has to spot. ui-conventions.md §11 records the doctrine deltas. LESSON: the anti-drift pin caught its OWN false-positive - comments saying "window.confirm (§7)" tripped the call-regex /window\.confirm\s*\(/ (the "(§7)" reads as a call); reworded to "confirm sheet §7 forbids". Scoping matters: the blue-fill and truncate pins are file-scoped (bg-blue-700 is legit on the bottom-tab active indicator; truncate is legit on meta lines per §5) while window.confirm/green/min-h-9 are global. #8 deferred: the native <details> triangle is present (Tailwind preflight keeps it); the gripe was consistency vs the blue-700 inline-link disclosures - subjective, low-value. Suites: 554 unit (77 files, +6 anti-drift pins) / lint / typecheck / prod build green. No DB.

## Spec 68 - Labor P2: cost freeze, PM cost view, close-out variance (2026-06-13)

Status: CODE COMPLETE, local gates green; migration GATED on operator confirm before db:push (prod). Implements the P2 block deferred in spec 46 - cost is the Head Tech surplus-share pilot's input (CEO-review 'Now' #1, unblocked since C1-C7 were already operator-resolved). MODEL: wp_labor_costs snapshot (work_package_id PK, own_cost/dc_cost numeric(12,2), computed_at, frozen_by) - DELIBERATELY MUTABLE one-row-per-WP UPSERT (the audit_log carries the change history, so the snapshot need not be append-only; C6: a post-close labor correction never recomputes it silently - a pm/super re-freezes explicitly, audited). ZERO authenticated grant (money) - read only via the admin client behind requireRole(pm/super), like day_rate_snapshot. freeze_wp_labor_cost(p_wp) SECURITY DEFINER: pm/super gate else 42501 (site_admin refused - rate is money, like set_worker_day_rate); WP-existence probe (SECURITY DEFINER bypasses RLS); own/dc = sum(fraction x day_rate_snapshot) over CURRENT (non-superseded, non-tombstone) labor logs; ON CONFLICT upsert; ONE labor_cost_freeze audit row with own/dc + old_own/old_dc in payload. KEY DECISION: invoked via the caller's AUTHENTICATED session, NEVER the admin client - current_user_role() = role from users where id=auth.uid(), and the service-role client has no JWT (auth.uid() NULL) so the gate would 42501 it; the authenticated PM session yields project_manager + a real frozen_by/audit actor. Two call sites: AUTO in recordDecision right after the admin UPDATE flips the WP to complete (non-fatal - logs on error, never fails the approve; C6 makes a missed freeze recoverable), and the explicit refreezeWpLaborCost action behind a re-freeze button shown on drift. New audit_action 'labor_cost_freeze' in its own migration (ADD VALUE can't be referenced same-txn); enum-label pins updated in files 03 AND 18 (grep-all-pins; file 19's audit_action ref is an action='update' filter, NOT a label pin - verified, so only 2 needed this time). 2 migrations (20260623000000 add value, 20260623000100 table+RPC; RPC tightens beyond the P1 labor RPCs - revoke execute from public, grant to authenticated - since it writes money). App: pure helpers TDD-first (bangkokDateOf in dates.ts; aggregateLaborCost/findOverAllocatedDays/currentLaborPairKeys/fractionDays in labor/cost.ts; computeLaborVariance + LABOR_VARIANCE_MIN_DIFF=2 in labor/variance.ts - the SQL freeze sum MUST equal aggregateLaborCost). database.types.ts hand-extended (wp_labor_costs Row/Insert/Update + freeze fn + enum union + Constants array). UI (PM page ONLY - the SA page stays presence-only; money never on a site_admin-reachable screen): admin-client cost read; LaborCostView server component (own/DC subtotals + total baht, per-worker days+cost+self-log, C5 cross-WP >1.0/day flags filtered to this-WP pairs, frozen-vs-live drift note + RefreezeButton client child); AttentionCard amber close-out variance strip (photo-days bucketed bangkokDateOf vs labor work_dates, surfaces at symmetric-diff >=2 OR photos-with-zero-labor). Tests: 26 new unit (labor-cost/labor-variance/dates-bangkok) RED then GREEN; pgTAP file 34 (plan 20: shape/PK/RLS/zero-grant posture, role gate sa+visitor 42501, happy-path own=750/dc=380 + one audit row, WP-not-found P0001, re-freeze upsert single-row + 2 audit rows + prior 750 in payload, superseded/tombstone excluded). Local: 580 unit / lint / typecheck / prod build green; pgTAP 34 + db:types reconcile PENDING the gated db:push. Seams: billing status per WP/deliverable (spec 69, gated on operator per-WP-vs-nguad-ngan decision), payroll export of DC days, a PM awaiting-freeze/drift queue, cost line on the report PDF.

## Spec 69 - DC payroll export: subcontractor days per period (2026-06-13)

Status: COMPLETE (acceptance = operator phone/PC pass - open /pm/payroll, confirm DC-only rollup by contractor for the month, download the CSV in Excel). Picked via the operator's "what next" -> "Payroll export (DC days)" (billing #2 stays BLOCKED on the per-WP-vs-nguad-ngan decision). Answers the cash question spec 68's per-WP freeze does NOT: end of period, how many days did each subcontractor (DC) crew work ACROSS all jobs, and what is owed - independent of any WP close/freeze, so it reads LIVE labor_logs current state, not the wp_labor_costs snapshot. PURE-CODE UNIT: zero schema change, zero DB writes, no db:push, no prod gate - the reports/export path (run-report-job.ts) writes no audit row for a download and the source labor_logs are each already audited at insert, so the export is a derived read; auditing each export (reuse the existing action='export' enum value) is a RECORDED SEAM, not v1. MONEY POSTURE unchanged from spec 68: day_rate_snapshot has zero authenticated grant; read via the admin client behind requireRole(PM_ROLES) on BOTH the page and the export route; Server Component renders text + CSV built server-side, so no rate/amount reaches a client bundle; SA never passes requireRole (roleHome bounces to /sa). DC ONLY - own crew are salaried (monthly), per-day payout would be wrong; own-crew payroll = seam. Pure lib (src/lib/labor/payroll.ts, TDD-first 16 tests RED then GREEN): aggregatePayroll(rows, contractorNames) - current-state filter (ADR 0009 anti-join + ADR 0015 tombstone, replicated not cross-imported to keep the module decoupled) THEN keep worker_type_snapshot='dc' (filter after the supersede pass, NOT a DB eq('dc') - a correction re-snapshots worker_type so a DB-level type filter could drop a superseding row and miscount the stale one); group by contractor_id_snapshot (null -> "ไม่ระบุผู้รับเหมา" sentinel, sorted last) then worker_id; days=Sigma fraction, amount=Sigma fraction x PER-ROW rate snapshot (honours mid-period rate changes, same rule as cost.ts); contractors sorted by name (th), workers by name (th). payrollToCsv - UTF-8 BOM (Excel-Thai), RFC-4180 quoting, header ผู้รับเหมา,ช่าง,จำนวนวัน,ค่าแรง (บาท), one row per worker (raw days / 2dp amount) + a trailing รวม grand-total row. buildPayrollFileName -> payroll-dc-YYYYMMDD-YYYYMMDD.csv (ASCII). monthRangeOf(todayIso) - first/last day of the Bangkok month (deterministic Date.UTC, no now()); parsePayrollRange(from,to,today) - accept YYYY-MM-DD params, fall back to the month on missing/malformed/inverted (a bad URL never crashes the page). Same-date-supersede assumption recorded (corrections/tombstones preserve work_date; a date-moving correction across the period boundary is a seam). Server: src/lib/labor/fetch-payroll.ts (server-only shared read backing BOTH surfaces so CSV and on-screen can't diverge; fetches all worker types in the window + resolves contractor names from contractors, CURRENT name not snapshotted - name-snapshot is a seam). UI: /pm/payroll Server Component (period = zero-client-JS GET form defaulting to the current Bangkok month; per-contractor cards with worker rows + subtotal + grand total; ดาวน์โหลด CSV is a plain <a download> NOT next/link so a prefetch can't fire the export) + /pm/payroll/export route handler (requireRole FIRST, text/csv attachment, no-store) + loading.tsx. PM_HUB_NAV +1 item ค่าจ้าง -> /pm/payroll (4th; PM surfaces are already PM/super-gated so it leaks nothing to SA; hub-nav.test pin + comment updated). BottomTabBar is independently hardcoded (untouched) - a mobile payroll tab is a seam (payroll = back-office, PC-leaning). No pgTAP: no new DB object/RLS/grant - the existing grant tests already prove authenticated cannot read day_rate_snapshot, and the new reads go through the same trusted admin-client + requireRole(PM_ROLES) gate spec 68's cost view uses. Browser preview not feasible (LINE-OAuth wall + money-data seeding) - operator acceptance, same model as spec 68. Suites: 596 unit (+16 payroll, hub-nav pin updated) / lint / typecheck / prod build green. No DB diff. Seams: audit each export (action='export'), own-crew payroll, contractor-name snapshot, date-moving corrections, a "mark period paid" state, a mobile bottom-tab entry.

## Spec 70 - procurement onboarding: the purchasing worklist (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 790/790). Operator "what next" -> procurement chosen as the next unit; first cut = the purchasing worklist (/requests), NOT PR triage / supplier-master / full PM parity. procurement was a v2 role bounced to /coming-soon. MAP-THEN-SPEC found the real shape: isBackOfficeRole ALREADY declares procurement back-office, the record_purchase/record_shipment SECURITY DEFINER RPCs ALREADY gate it in, and purchase_requests + suppliers SELECT ALREADY admit it - but THREE RLS policies never caught up, so procurement on /requests would see blank WP labels (violates the WP-centric principle) and hit broken upload buttons. So the unit = align the privilege layer with the already-declared back-office role.

APP (routing/nav, no prod gate): roleHome(procurement) -> /requests (was /coming-soon); new canonical PURCHASING_ROLES = sa/pm/super + procurement on BOTH /requests + /requests/[id] gates (NOT folded into SITE_STAFF_ROLES - that set gates SA photo/WP screens procurement must not reach); PROCUREMENT_TABS = [คำขอซื้อ, โปรไฟล์] (no โครงการ - projects SELECT deferred per spec 58; no รอตรวจ - not a decider); create-request section HIDDEN for procurement (a processor not a requester - not in the purchase_requests INSERT policy, no WP link to arrive ?wp=-pinned, so the section was inert); WP reference on the detail page renders as plain TEXT for procurement (the /sa WP route is SITE_STAFF_ROLES-gated and would bounce it).

DB (migration 20260624000100, gated on operator go/no-go -> "Apply now"): three-policy widen, each adds 'procurement' to an existing role IN-list, DROP+CREATE in place with NAME unchanged so policies_are pins stay green: (1) work_packages SELECT (read only - INSERT/UPDATE stay pm/super; gives WP identity + project_id for the uploaders); (2) purchase_request_attachments INSERT (the per-purpose arms unchanged - procurement inherits the invoice + delivery_confirmation arms; the reference arm's own-parent+status='requested' predicate keeps it inert for a non-requester); (3) storage pr-attachments INSERT. No new object/column, no data change. appsheet_writer unaffected (current_user_role() NULL for it).

STAYS PM-ONLY (worklist != triage, operator call): approve/reject (PurchaseRequestDecision), cancel, site-purchase recording (lives on the SA WP page, not /requests), site-purchase ack - all already isDecider-gated, so already exclude procurement; this unit widened NONE of them.

TESTS: TDD - role-home.test.ts (roleHome procurement -> /requests; PURCHASING_ROLES membership) + bottom-tab-bar.test.tsx (PROCUREMENT_TABS pin + procurement render: คำขอซื้อ+โปรไฟล์, no โครงการ/รอตรวจ) RED then GREEN. pgTAP +5: file 08 (procurement SELECT allowed / INSERT denied), file 20 (procurement invoice on a purchased parent ALLOWED - also fills a pre-existing invoice-arm RLS test gap - + procurement reference on a foreign requested parent DENIED), file 21 (storage role-gate text-pin includes procurement). db:types regen reconciled byte-EXACT after prettier (RLS-only = zero schema-shape drift). Suites: 599 unit / 790 pgTAP / lint / typecheck / prod build all green.

ACCEPTANCE (operator): sign in as a procurement user -> lands on /requests; sees the site's PRs WITH WP labels; opens an approved request -> records a purchase (supplier dropdown populated); opens a purchased request -> records shipment; uploads an invoice; confirms NO approve/reject/cancel controls; SA + PM screens unchanged. SEAMS: procurement projects SELECT / project hub, desktop HubNav for procurement, a procurement supplier-master screen, a procurement-specific worklist ordering (approved-awaiting-purchase first). NEXT backlog unchanged: spec 71 billing status (still BLOCKED on the per-WP-vs-nguad-ngan operator decision), own-crew payroll, moat-insurance backup/restore drill.

## Spec 71 - notes as backup capture: work-package notes (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 801/801). Operator after spec 70 acceptance gave 2 items: (1) "add notes in places that might need it" -> clarified "Everywhere, we need them as backups in case we forgot a field, user can still put information in notes instead" = a BACKUP-CAPTURE notes field (NOT a discussion thread). (2) statuses as icons vs text -> DECISION: KEEP TEXT-ONLY (operator agreed) - color already carries the fast scan (spec 67 token canon), 13 statuses have no intuitive glyph, Thai-first + a11y want text; NO icon work. DESIGN call for notes: per-entity EDITABLE notes column (matches the existing purchase_requests.notes spec-48 + work_packages.description precedent + the operator's "notes field" mental model), NOT a generic polymorphic notes table (CLAUDE.md forbids mixed-content reference columns; a thread over-architects "a backup field"). Coverage audit found the gaps: editable WP remark, supplier/contractor notes, labor-day note. SCOPED v1 to the highest-value + cleanest slice -> WORK-PACKAGE notes (WP-centric principle #1); suppliers/contractors have NO edit UI today (created/selected only) and labor_logs is append-only, so those slices need their own surfaces/handling = recorded seams.

MODEL: work_packages.notes text null + CHECK (notes is null or length<=2000) [abuse backstop; app caps at 1000 = spec-48 cap; starts closing the queued DB-CHECK gap]. Write path = set_work_package_notes(p_work_package_id, p_notes) SECURITY DEFINER RPC MIRRORING set_work_package_contractor (spec 31): role gate site_admin/pm/super else 42501, search_path pinned, revoke-then-grant execute, nullif(btrim(p_notes),'') so blank clears to null, return found. WHY an RPC: SA is the on-site note author but work_packages UPDATE RLS is pm/super only - the RPC writes the notes column ONLY without handing SA every WP column (the spec-31 lesson). NO audit row (consistent with set_work_package_contractor - WP-column edits aren't individually audited; a note is benign ops text).

APP: validateWorkPackageNotes pure helper (trim, empty->null, 1000 cap) TDD-first; setWorkPackageNotes server action (UUID + cap validate, action gate, RPC relay, revalidatePath); WorkPackageNotes client component (controlled textarea + dirty/save/error/saved state, mirrors wp-assignment-panel) in the WP detail ข้อมูลงาน zone (sa/pm/super reach it). typecheck caught the one trap: typegen types p_notes as a NON-NULL string, so the action passes validated.value ?? "" (the RPC's nullif maps "" -> null) rather than string|null. database.types.ts hand-extended then db:types regen reconciled EXACTLY (only delta vs HEAD = the notes column on Row/Insert/Update + the set_work_package_notes fn, p_notes: string - schema understanding confirmed).

TESTS: 8 unit (validate-notes x4 + work-package-notes component x4) RED then GREEN. pgTAP +11 in file 08: 3 catalog (notes text/nullable + has_function) + 8 behavioral (SA writes via RPC returns true + note landed, visitor 42501, procurement 42501 [reads WPs per spec 70 but never writes], unknown WP -> false, blank -> null x2, length CHECK rejects >2000 = 23514). Suites: 607 unit / 801 pgTAP / lint / typecheck / prod build all green.

ACCEPTANCE (operator): open a WP, type a note in ข้อมูลงาน, save, reload -> persists; confirm SA (not just PM) can write it. SEAMS (the rest of "everywhere", each its own slice): supplier notes + contractor notes (need an edit surface first - none exists), labor-day note (labor_logs.note via a log_labor_day param, append-only carries through corrections), editable purchase-request note (purchase_requests.notes is write-once spec-48; making it editable is a posture change), PM-review-page (/pm/work-packages/[id]) read-only display of the WP note. DB-CHECK caps on the OLDER text columns remain the standing queued item.

## Spec 72 - notes everywhere (program) + Unit 1: shared NotesField + projects.notes (2026-06-13)

Status: COMPLETE (migration APPLIED to prod, pgTAP 808/808). Operator clarified spec-71's "notes" -> "notes on every db, which means every process" = an editable backup field on EVERY user-facing entity. Plan-moded the program (plan file hashed-swimming-duckling.md, operator-approved). ARCHITECTURE (decided, Plan-agent-validated): per-entity `notes text` column + ONE shared presentational NotesField component (generalize WorkPackageNotes), NOT a unified polymorphic table (CLAUDE.md forbids mixed-content reference columns; every existing note is already a column; operator's model = one editable field per record, not a thread; a 9-FK typed table = more surface for no asked-for benefit). Write path reuses each entity's doctrine; a column-only SECURITY DEFINER RPC only where the writer lacks UPDATE. App cap 1000, DB CHECK<=2000 per column. OPERATOR SCOPE: existing-screen entities first (projects=this unit, purchase_requests editable, labor per-day note, workers); suppliers+contractors DEFERRED (no edit screen exists -> needs a build-the-screen effort); deliverables (no surface) + reports (machine artifact) EXCLUDED. Units 2-4 = specs 73-75.

UNIT 1 shipped: (1) SHARED SCAFFOLDING (no DB) - src/lib/notes/validate.ts generic validateNotes(raw, max=1000); validate-notes.ts now re-exports it (validateWorkPackageNotes + its test stay green); src/components/features/notes-field.tsx presentational textarea+dirty/save/error/router.refresh taking an injected onSave callback (no server fn crosses the RSC boundary - each entity keeps a thin client wrapper); work-package-notes.tsx refactored to a ~12-line wrapper over NotesField (its existing test = regression guard). (2) projects.notes: migration 20260624000300 (projects.notes column + CHECK<=2000; DROP 3-arg update_project_settings, CREATE 4-arg with p_notes default null + COALESCE-PRESERVE [case when p_notes is null then notes else nullif(btrim,'') end] so a name/status-only save never wipes the note, explicit '' clears). update_project_settings is the existing pm/super column-scoped escape hatch (ADR 0042) - extended rather than a new RPC. settings/actions.ts + settings-form.tsx gained notes (batched into the one save); page passes initialNotes. LESSON: CREATE OR REPLACE can't add a param -> DROP+CREATE; the 3-arg signature ceasing to exist broke file-32's 2 has_function_privilege pins (grep-all-signature-pins) - updated to 4-arg; the 3-arg CALLS still resolve via the default. db:types regen byte-exact with the hand-extension. TESTS: notes-field.test.tsx (5, RED first) + settings-form.test.tsx (2) + work-package-notes/validate-notes regression. pgTAP +7: file 07 (notes col text/nullable + CHECK>2000) + file 32 (4-arg signature pins; PM sets note + landed + blank clears to null). Suites: 614 unit / 808 pgTAP / lint / typecheck / prod build green.

ACCEPTANCE: open a project's settings (pm/super), type a note, save, reload -> persists alongside name/status. NEXT: Unit 2 spec 73 = purchase_requests.notes editable (set_purchase_request_notes RPC, requester+back-office, replaces the spec-48 read-only block on /requests/[id]). Then Unit 3 labor per-day note, Unit 4 workers note. Deferred: suppliers/contractors (need screens), deliverables, reports excluded, PM-review-page WP-note display.

## Spec 73 - notes everywhere Unit 2: editable purchase-request note (2026-06-13)

Status: COMPLETE (migration 20260624000400 APPLIED to prod, pgTAP 818/818). Second slice of the notes-everywhere program (spec 72 / plan). Spec 48 made purchase_requests.notes write-once by GRANT posture (authenticated INSERT only, no UPDATE - column-scope doctrine ADR 0038). Operator wants it editable. KEY POSTURE: KEEP the no-UPDATE grant (file 30 STILL pins has_column_privilege(authenticated, notes, UPDATE)=false) and add set_purchase_request_notes SECURITY DEFINER RPC as the controlled edit path - the definer (table owner) bypasses both the column grant AND RLS, so the column-scope posture is intact while the RPC is the gated editor. GATE: requester edits their OWN note (requested_by = auth.uid()), back-office (pm/procurement/super) edits ANY; else 42501. nullif(btrim,'') clears. CHECK<=2000 added (app cap 1000). App: setPurchaseRequestNotes action (maps 42501 -> ไม่มีสิทธิ์แก้ไขหมายเหตุ) + PurchaseRequestNotes wrapper over the shared NotesField (spec 72); /requests/[id] read-only note block REPLACED - editable for isMine||isBackOffice, read-only text otherwise. database.types.ts regen byte-exact with hand-extension. TESTS: purchase-request-notes.test.tsx (3, RED first); pgTAP file 30 expanded from 3->13 (kept the 3 grant-posture pins unchanged + 10: catalog has_function, requester edits own + landed, back-office edits any + landed, non-requester SA 42501, visitor 42501, blank clears + null, CHECK>2000; fixtures = sa1-requester/pm-backoffice/sa2-nonrequester/visitor + project + WP + PR). Suites: 617 unit / 818 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: edit+save the note on a request you raised; as PM edit a note on a request you didn't raise; as a non-requester SA the note is read-only. NEXT: Unit 3 (labor_logs.note via log_labor_day + correct_labor_log params), Unit 4 (workers.note). Recorded posture: PR note stays editable after decision (benign backup field).

## Spec 74 - notes everywhere Unit 3: labor-day note (2026-06-13)

Status: COMPLETE (migration 20260624000500 APPLIED to prod, pgTAP 825/825). Third notes slice. An optional note on a daily labor entry; labor_logs is append-only (supersede) so the note is a per-row SNAPSHOT set at log_labor_day and CARRIED FORWARD through corrections (like rate/name snapshots), null on tombstone. Migration: labor_logs.note + CHECK<=2000 + grant select(note) to authenticated (presence data, NOT money - unlike day_rate_snapshot). DROP+CREATE log_labor_day (+p_note, nullif(btrim)) + correct_labor_log (+p_note, carry-forward: case tombstone->null / p_note null->v_orig.note / else nullif; bodies reproduced verbatim from 20260619000300 + the note). App: logLaborDays action +note (shared validateNotes, applied to every entry in the batch); correctLaborLog UNCHANGED (RPC carries note forward automatically - editing a labor note post-entry = recorded seam, the p_note param exists but the UI doesn't expose it). LaborLogZone: one note textarea on the entry form (the day's crew) + shows each row's note; note threaded through LaborDisplayRow + fetch-zone-data select + types. database.types.ts regen byte-exact (note on Row/Insert/Update + p_note on both RPCs). TESTS: labor-log-zone (+2: entry passes note, row renders note), labor-current-logs fixture +note. pgTAP file 29 (+7): note stored at entry, carried through correction, cleared on tombstone, CHECK>2000. LESSON (pgTAP): the CURRENT row is the ANTI-JOIN (not exists newer.superseded_by = ll.id), NEVER `superseded_by is null` (that's the ORIGINAL row a correction supersedes per ADR 0009) - my first draft tombstoned an already-superseded row -> P0001 'log already superseded'; migration was fine, only the test queries were wrong (fixed test, re-ran db:test, no re-push). Suites: 619 unit / 825 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: log a crew day with a note -> shows on each row; correct an entry -> note persists; remove -> note goes. NEXT: Unit 4 (workers.note via create_worker/update_worker params) = last existing-screen slice. Then deferred: suppliers/contractors (need screens), deliverables, reports excluded.

## Spec 75 - notes everywhere Unit 4: worker roster note (2026-06-13)

Status: COMPLETE (migration 20260624000600 APPLIED to prod, pgTAP 831/831). LAST existing-screen notes slice. An editable note on a roster worker; workers is RPC-only-write (rates=money) so the note rides create_worker/update_worker. Migration: workers.note + CHECK<=2000 + grant select(note) (presence, not money). DROP+CREATE create_worker (+p_note, nullif(btrim)) + update_worker (+p_note, CASE-PRESERVE: p_note null->keep / ''->clear / else set; coalesce for name/active/contractor unchanged); bodies verbatim from 20260619000200, audit payloads unchanged. App: createWorker/updateWorker actions +note (shared validateNotes; create passes p_note only when non-empty; update passes raw incl. '' to clear, omits to preserve); WorkerRosterManager add-form + per-row edit note textareas + row display; ManagedWorker +note, /workers page select +note. database.types.ts regen byte-exact (note Row/Insert/Update + p_note on both RPCs). TESTS: worker-roster-manager.test.tsx (new, 3, RED first: row shows note, add passes note, edit passes note - edit uses getAllByLabelText[1] since add-form note is [0]). pgTAP file 29 +6 (placed AFTER the worker_change audit-count=3 pin so the 2 new audit rows don't disturb it): create stores note, update sets note, note-only update preserves name (coalesce), CHECK>2000. Suites: 622 unit / 831 pgTAP / lint / typecheck / prod build green. ACCEPTANCE: /workers (pm/super) add a worker with a note -> shows on row; edit a note -> persists.

### Notes-everywhere program COMPLETE (existing-screen scope)

All 5 existing-screen entities have an editable note: work_packages (71), projects (72), purchase_requests editable (73), labor per-day (74), workers (75). Shared NotesField + generic validateNotes + per-entity column + reuse-the-entity's-write-path (RPC where the writer lacks UPDATE). DEFERRED (need a new management screen first, operator chose to defer): suppliers.note, contractors.note. EXCLUDED: deliverables (no surface), reports (machine artifact). SEAMS: editing a labor note post-entry (correct_labor_log p_note exists, UI doesn't expose), PM-review-page WP-note display. NEXT (operator-chosen direction after notes): the APP-FEEL design round - make prc-ops feel native (motion/transitions, optimistic UI replacing 23 router.refresh round-trips, bottom sheets, toasts+haptics); assessment + 4 prioritized adjustments recorded in memory app-feel-roadmap. Operator deferred it to finish notes; pick it up next session.

## Spec 76 - app-feel slice 1: toast/snackbar system (2026-06-13)

Status: COMPLETE (no DB change; acceptance = operator eyeball on deploy). First slice of the "feel like a native app" round. METHOD (ultracode): a 5-agent audit+design workflow (mapped 37 router.refresh sites + every feedback surface, inventoried reusable primitives, VERIFIED framework facts, mapped shell/overlay mount constraints) -> synthesized the ordered slices + a build-ready slice-1 design; built test-first; then a 3-lens ADVERSARIAL REVIEW workflow (lifecycle/a11y/iOS) caught 2 a11y majors fixed before ship. KEY VERIFIED FACTS that shaped the round: navigator.vibrate = NO-OP on iOS Safari/PWA (all versions) -> haptics DROPPED (worthless for the iPhone-first users; Android-only progressive enh at most); Next 16.2.4 experimental.viewTransition is "not recommended for production" -> motion is CSS-only (@starting-style/keyframes, iOS 17.5+/18+ safe) and LAST, not the experimental route-VT API; design-doctrine.test enforces emerald(not green)+44px floor.

SHIPPED: use-toast.ts (useToast hook + context + NO-OP fallback outside a provider so consumers degrade safely, never throw) + toast-provider.tsx (mounted in root layout WRAPPING {children} so a toast fired just before router.refresh survives the RSC re-render) + globals.css @keyframes toast-in gated by prefers-reduced-motion:no-preference (opt-in; reduced-motion=instant) + classes.ts TOAST_SUCCESS(emerald)/TOAST_ERROR (pinned). z-[45] fixed bottom above the 64px tab bar + safe-area. A11Y (review-driven rework): TWO PERSISTENT sr-only live regions (polite role=status for success, assertive role=alert for errors) that exist on first paint and gain a keyed child per toast -> iOS VoiceOver reliably announces (a region inserted already-containing its text is the silent-failure case the first impl hit); visible pills presentational. Errors PERSIST (no auto-dismiss, WCAG 2.2.1); success auto-dismiss 4s; stack cap 3; timer cleanup on unmount + dropped-item timers cleared; full-contrast 44px dismiss button. ADOPTION: display-name-form + settings-form + notes-field (fans out to all 5 notes surfaces) - success -> toast.success, inline span removed; ERRORS STAY INLINE (field-anchored, deliberate split). TESTS: toast-provider.test (8) + notes-field/display-name assert toast.success fires + no inline span. 634 unit / lint / typecheck / build green. RECORDED SEAMS (review-deferred, not bugs): action-failure-inline-vs-toast (design call, kept inline), toast-inside-useTransition paint latency (device-verify before restructure), toast/queue-banner proximity on small phones, purchase-request-form still uses an inline บันทึกแล้ว span (later adoption wave). NEXT app-feel slices (memory app-feel-roadmap): 2 press/active feedback, 3 optimistic UI (kill the 37 router.refresh flickers), 4 bottom sheets, 5 motion (CSS list-enter; route VT only as a guarded spike).

## Spec 77 - app-feel slice 2: press/active tactile feedback (2026-06-13)

Status: COMPLETE (no DB; acceptance = operator eyeball). Second app-feel slice. Native apps respond on touch; only buttons had a press state (active:translate-y-px) - the cards/rows/tabs/chips/icons people tap had none, and iOS painted its grey tap-flash over them. Verified fact: navigator.vibrate is a no-op on iOS PWA, so :active states are the only "haptic" the primary users get. METHOD: an exhaustive Explore tap-target audit (22 targets lacking press feedback, grouped + traffic-ranked) -> press states on the high-traffic set. SHIPPED: (1) GLOBAL globals.css - -webkit-tap-highlight-color:transparent on html (kills the grey iOS flash) + touch-action:manipulation on a/button/summary/label/[role=button] (drops the ~300ms double-tap-zoom delay -> instant taps); biggest single win, covers every control. (2) active:bg-zinc-100 press tint on PR cards, WP list rows (flat+contained), project rows (sa+pm), PM queue rows; active:bg-slate-200 on the deliverable group toggle. (3) active:translate-y-px on ICON_CHIP/\_MUTED (back/gear/reports) + RefreshButton + RadioChip + the requests filter chips. (4) active:scale-95 on bottom-tab-bar items (transform, no reflow). ICON_CHIP was NOT byte-pinned (audit was wrong) so no pin churn. design-doctrine stays green (zinc/slate press hues, 44px floor kept). 634 unit / lint / typecheck / build green. DEFERRED (low-traffic, covered by the global): text <summary> toggles, desktop HubNav/AppHeader links, report download button, requests back link. NEXT app-feel slices: 3 optimistic UI (kill the 37 router.refresh flickers, careful per-surface), 4 bottom sheets, 5 motion (CSS @starting-style list-enter; route VT guarded spike).

## Spec 78 - app-feel slice 4: bottom-sheet primitive + 1 form (2026-06-13)

Status: COMPLETE (no DB; acceptance = operator eyeball). Bottom-sheet native pattern. SLICE 3 (optimistic UI) DELIBERATELY DEFERRED - it mutates payroll/labor data where an optimistic-then-rolled-back row is confusing; needs careful per-surface treatment (payroll-safe surfaces only), not a tail-of-session rush. SHIPPED: src/components/features/bottom-sheet.tsx (<BottomSheet open title onClose>) - same overlay contract as ConfirmDialog/lightbox (fixed inset-0 scrim z-50, Escape + scrim-click close, content stopPropagation, role=dialog aria-modal, aria-labelledby); bottom-anchored rounded-t-2xl panel + grab handle + sticky header + 44px ปิด, max-h-85vh own overscroll-contained scroller, pb-safe-area. Body already LOCKED (spec 64) so no iOS scroll-leak behind the scrim. globals.css @keyframes sheet-up (translateY 100%->0) gated prefers-reduced-motion. MIGRATION: wp-assignment-panel (มอบหมายงาน) inline <details> -> trigger button opening the sheet w/ contractor picker + add-contractor form; closes on successful assign. Chosen first because it's already a self-contained client component (no server/client boundary change, no form-component change, no test ripple). TESTS: bottom-sheet.test (5: closed=nothing, open=labelled dialog+title+children, Escape closes, scrim-click closes but content click doesn't, ปิด closes). 639 unit / lint / typecheck / build green. SEAMS: full focus-trap not implemented (matches ConfirmDialog; panel takes focus on open), swipe-to-close deferred, more form migrations (create-purchase-request/site-purchase/worker-add) = fast-follows reusing the primitive (the WP-page create-form <details> needs a small client wrapper - it lives in a Server Component - the one boundary to handle next). NEXT app-feel slices: 3 optimistic UI (careful per-surface, payroll-safe only), 5 motion (CSS list-enter safe half; route View Transitions experimental = guarded spike).

## Data-architecture hardening pass (2026-06-13) — audit ranks 1-9 shipped

Status: COMPLETE (all applied to prod under full operator autonomy; verify = operator can't see it, it's infra). Followed a 4-dimension multi-agent audit (normalization/scale/RLS-tenancy/AI-readiness) + synthesis. Full review + deferred roadmap persisted at docs/data-architecture-review-2026-06.md. Nine ranks, 8 migrations (20260625000100-000800) + 1 app change + 7 new pgTAP files (35-41); suite 865 assertions / 0 failures; typecheck/unit/build green. Shipped: (1+2) hot-path indexes - labor_logs superseded_by partial (anti-join) + work_date (the spec-69 payroll date-window was seq-scanning since both composites lead with worker/wp), purchase_requests(requested_by,supplier_id), work_packages(status,updated_at)+(contractor_id), workers(contractor_id,user_id). (5) revoke PUBLIC/anon EXECUTE on the 5 worker/labor mutation RPCs (the 0624 note-param DROP+CREATEs had reset grants to the PUBLIC default; internal current_user_role() gate was the only defense). (4) prune_notification_outbox daily cron (terminal rows >30d - the only disposable log table; audit_log/photo_logs/labor_logs are evidence, partition later). (6) COMMENT ON all 20 tables + load-bearing columns - was 0 table/4 column comments; makes the schema legible to text-to-SQL/AI. (7) purchase_requests.received_by_id FK (the one genuine free-text-where-FK-belongs column; populated on both write paths - record_site_purchase=auth.uid(), delivery trigger=uploader) + reports.params object CHECK + workers.contractor_id delete-block comment. (3) RLS EVAL-ONCE - the headline: every policy called auth.uid()/current_user_role() BARE, evaluated per-row (EXPLAIN-verified: "Filter: current_user_role()=ANY"). Wrapped in scalar subselects -> InitPlan, once per query (EXPLAIN-verified after). Transformed in-DB from pg_get_expr text (no hand-reproduction). 66/67 policies; photo_markups EXCLUDED - its INSERT policy has an inline self-referential subquery (tombstone-target), wrapping calls in either of its policies makes the self-reference re-apply a wrapped policy -> 42P17 recursion (cure = a SECURITY DEFINER tombstone helper like attachments use; deferred). Three migrations (000600 cursor-skip wrapped 34 + broke markups; 000700 snapshot-then-alter wrapped remaining 32 + began markup revert; 000800 finished markup revert). LESSONS: (a) a plpgsql FOR-IN-SELECT cursor over pg_policies skips rows when you ALTER mid-loop (catalog changes under the cursor) - snapshot into a temp table first. (b) Postgres renders a wrapped call as "( SELECT f() AS f )", so literal-string bare-detection false-positives - use regexp_count(total) > regexp_count(select-prefixed). (8) /requests bounded queries - was select\* unbounded + ?mine filtered in JS = silent 1000-row PostgREST truncation + mine-after-cap drop; split pending/decided, ?mine as DB predicate, decided capped explicitly at 500. (9) pgTAP pin of the no-JWT NULL-deny invariant (appsheet_writer/anon/future-AI-role all depend on current_user_role() returning NULL with no sub). DEFERRED (own units, see review doc): AI access contract (CRITICAL - agents must use authenticated RLS context not admin.ts), semantic/analytics views, ai_insights landing table, evidence-log partitioning, pgvector semantic layer; + multi-tenant org_id seam (before customer #2), /requests keyset paging, photo_markups SECURITY DEFINER helper. Caveat: eval-once win EXPLAIN-verified (InitPlan) not load-benchmarked; partition urgency volume-dependent (unmeasured).

## Spec 79 — Project metadata + client information (2026-06-13, COMPLETE units 1-3)

Operator asked "where do users set project/client info, what would help". Read-only design workflow (5 agents) mapped the gap: projects had only code/name/status/notes, NO client concept. Operator scope decisions (AskUserQuestion): client = reusable MASTER table (mirrors contractors/suppliers ADR 0033/0038), not inline; project fields = site_address, contract_reference (immutable like code), start_date, planned_completion_date, project_lead_id (INTERNAL person-in-charge, distinct from client.contact_person), project_type (enum, 6 operator-chosen Thai categories), budget_amount_thb (MONEY). Internal team/supervisors split to SPEC 80 (join table). **Unit 1 SHIPPED (1317a86, migrations 20260626000000/000100/000200 applied to prod under the db:push gate, pgTAP 897/0):** clients master (staff SELECT, PM/super INSERT/UPDATE created_by-pinned, no delete) + projects +8 cols + set_project_client RPC + update_project_settings extended 4-arg→10-arg. MONEY posture: budget SELECT revoked from authenticated — but a COLUMN revoke was inert because authenticated holds a TABLE-level SELECT grant (the spec-46 C3 reality), so 000200 replaced it with explicit per-column grants excluding budget (MAINTENANCE: new projects columns must be added to that grant; money cols intentionally omitted). 000200 also wrapped current_user_role() in the clients policies in (select …) — the eval-once doctrine (file 40) now FAILS on any bare call, caught it on first db:test. validators + PROJECT_TYPE_LABEL + 18 unit tests + compile-time drift guard (tuple vs generated enum) + pgTAP file 42 (32 asserts) + file 32 signature pin updated. **Unit 2 SHIPPED (ca8c4cd):** settings form (/sa/projects/[id]/settings, PM/super) edits all fields + inline "เพิ่มลูกค้าใหม่" (createClient mirrors masters); budget + staff roster read via admin client (budget revoked; users RLS read-self), clients via user session; contract_reference read-only. LESSONS: (a) exactOptionalPropertyTypes forbids passing `undefined` to an optional RPC arg — build the args object and OMIT unset keys (absent = SQL default null = COALESCE-preserve). (b) set_project_client p_client_id has no DEFAULT so typegen types it `string` (non-null); cast to pass null (clears) — or add DEFAULT NULL like spec-31 did. 653 unit / typecheck / lint / build green. **Unit 3 SHIPPED (399df41):** display — project detail header shows client/ผู้รับผิดชอบ (display-name resolved via admin)/type/site lines (each only when set); /pm/projects list shows client name (one batched lookup); PDF report header (fast-path src/lib/reports/build-pdf) prints client name + mailing_address + site_address, suppressed when absent so legacy projects keep the old code/name/Generated header (worker/ stays frozen → renders old header; atrophy-retired). No DB change → no gate. 653 unit/typecheck/lint/build green. **SPEC 79 COMPLETE.** REMAINING: only SPEC 80 (project_members team join table). Seams recorded in spec 79 §Out-of-scope: /pm/clients management page, budget-vs-spend dashboard, clearing date/lead/type/budget back to null (COALESCE preserves), procurement client access. OPERATOR OWES (acceptance): open a project's settings as PM → set site/dates/type/lead/budget, add+assign a client; confirm SA cannot reach settings or see budget.

## Spec 80 — Project team / supervisors (2026-06-13, SHIPPED)

The team list spec 79 split out. **SHIPPED (0902d07, migration 20260626000300 applied to prod under the db:push gate, pgTAP file 43, suite 911/0):** project_members join table (project_id, user_id, added_by, added_at; PK(project_id,user_id); user_id index) — mirrors work_package_members (ADR 0032) but MUTABLE (DELETE granted) and with eval-once-WRAPPED policies from the start (learned from spec-79: a bare current_user_role()/auth.uid() fails file 40; file 40 globally covers project_members so file 43 dropped its own redundant eval-once assert). RLS: staff SELECT, PM/super INSERT (added_by=(select auth.uid()) pinned) + DELETE; procurement excluded. No SECURITY DEFINER RPC — PM/super write directly under the authenticated session (they hold the grant+policy). App: addProjectMember (idempotent — 23505 = already member = ok) / removeProjectMember server actions (PM/super gate); settings-form ทีมงาน section (list + ✕ remove + staff picker to add; add/remove persist immediately via their own actions + update LOCAL state with NO router.refresh so the main form's unsaved edits survive — same pattern as the inline client-add); project detail header shows a ทีมงาน line (member names, admin-resolved alongside the lead in one fetchDisplayNames). project_lead_id (single lead, spec 79) stays distinct. LESSONS: (a) an RLS DELETE with a failing USING deletes 0 rows SILENTLY — no 42501 (only INSERT WITH CHECK throws); test the no-op (rows survive), not throws_ok. (b) the hand-rolled bare-call regex must be case-INSENSITIVE — Postgres renders the wrapped form as "( SELECT current_user_role() …)" uppercase, so a lowercase `!~ 'select …'` false-positives (use file 40's proven global check instead of re-rolling). 653 unit/typecheck/lint/build green. SEAMS (spec 80 §Out-of-scope): per-member role/title, team on the PDF/list (header-only v1), notify-on-add. OPERATOR OWES (acceptance): on a project's settings, add + remove a team member; the header shows ทีมงาน; a duplicate add is a no-op; SA cannot reach settings.

## Spec 81 — Master data management: clients · suppliers · contractors (2026-06-14, SHIPPED)

Operator picked this from a "what next" menu (build the master-data **screens** + unblock the deferred `suppliers.note`/`contractors.note`). **SHIPPED (migration 20260627000000_masters_notes.sql applied to prod under the db:push gate, pgTAP 935/0):** one PM-gated route `/pm/masters` with a RadioChip segmented control (ลูกค้า/ผู้ขาย/ผู้รับเหมา) over the three reference masters — each created inline elsewhere and never editable until now (a name typo on a master that snapshots onto reports/PRs was permanent). Mirrors the `/workers` roster precedent minus the money machinery (no master has a rate/cost column, so reads use the ordinary user-session server client — no admin client).

**Notes-everywhere reaches the masters.** Migration adds `note text` + `CHECK(<=2000)` + `grant insert/update (note)` + a column comment to clients, suppliers, contractors. App cap 1000 (`validateNotes`), DB CHECK 2000 (specs 71–75 doctrine). **No RLS policy dropped/created** — the note rides each table's existing UPDATE/INSERT policy, so the eval-once doctrine (pgTAP file 40) is untouched (this is exactly why a note column needs no RPC: it rides the existing policy). suppliers.note/contractors.note were DEFERRED in specs 74/75 for lack of an edit screen; spec 81 builds the screen, so they land here. Notes-everywhere now covers WP/projects/PR/labor/workers + clients/suppliers/contractors.

**No SECURITY DEFINER RPC.** `/pm/masters` is `requireRole(PM_ROLES)`-gated and PM/super already hold the INSERT/UPDATE policy + column grants on all three (clients pm/super; contractors sa/pm/super⊇pm/super; suppliers pm/procurement/super⊇pm/super), so the six actions (`{create,update}{Client,Supplier,Contractor}Record` in `src/app/pm/masters/actions.ts`) write directly under the authenticated session — the spec-80 project_members precedent. Each action re-checks PM_ROLES before the write: defense-in-depth + a real error, because an RLS UPDATE whose USING fails affects 0 rows SILENTLY (spec-80 lesson) and trusting RLS alone would mask a forbidden edit as success. Update sends only changed keys (omitted=preserve, ""=clear); `norm()` blanks→null. The existing inline quick-adds (createClient in settings, createSupplier in requests, createContractor in WP assignment) are UNTOUCHED — they stay note-less and return the new id for immediate selection in their host flow (recorded simplify-seam: a shared insert core could unify them; they differ in return shape, revalidate target, and note support).

**Components.** `master-manager.tsx` — generic presentational manager driven by a `MasterFieldDef[]` schema (key/label/type text|tel|email|textarea/maxLength); add card + per-row แก้ไข expander; entity actions injected as `onCreate`/`onUpdate` (no server fn imported here — the NotesField pattern; toast on success spec 76; `active:` press tints spec 77). `masters-tabs.tsx` — the segmented-control shell, holds the active tab + binds the field-record→typed-action mappers. `page.tsx` fetches all three lists (user session, `order by name`) → MasterRow[] (snake→camel) → MastersTabs; +loading.tsx. Nav: `PM_HUB_NAV` += ข้อมูลหลัก (5 items, desktop strip; no phone bottom-tab entry — same seam as /workers, /pm/payroll). site-map.md + feature-specs README (79/80/81 added) updated same-unit.

**Method/tests:** TDD RED-first `master-manager.test.tsx` (5: row render, textarea for textarea-type, onCreate with values, onUpdate with only-changed, error render). hub-nav pin bumped to 5 items. pgTAP +24 across files 24/26/42 (each +note column exists/nullable/text, +CHECK>2000 rejected, +has_column_privilege insert/update, +PM note update lands + outcome). database.types.ts hand-extended then `db:types` regen reconciled byte-EXACT (9 insertions / 0 deletions). LESSON: `pick()` union-spread helper keeps the field-record→typed-action mapping exactOptionalPropertyTypes-clean (only present keys forwarded). Suites: 658 unit / 935 pgTAP / lint / typecheck / build green.

**OPERATOR OWES (acceptance):** as PM open `/pm/masters` → three tabs; add a client with a note, edit it, reload → persists; rename a supplier; rename a contractor; add a contractor note; confirm SA cannot reach `/pm/masters`. **SEAMS (recorded):** SA/procurement access to the management page (role-widening units); delete/merge/dedup (ADR 0033/0038 keep masters un-deletable); unify masters-page create with the inline quick-adds; per-record usage view (which projects/WPs/PRs reference a master); client budget/analytics (spec 79 seam).

### Spec 81 amendment — renamed "master data" → Contacts (2026-06-14)

Operator feedback right after ship: "instead of /masters, can we make it contacts? for all the contact settings." Rename only (no DB change — note columns already live): route `/pm/masters` → `/pm/contacts`; nav รายชื่อติดต่อ (was ข้อมูลหลัก), page title รายชื่อผู้ติดต่อ; generic component MasterManager → RecordManager (record-manager.tsx; types RecordFieldDef/RecordRow/RecordActionResult), shell MastersTabs → ContactsTabs (contacts-tabs.tsx), RadioChip group name contact-tab / aria ประเภทผู้ติดต่อ; actions module path moved (CONTACTS_PATH revalidate). Umbrella label รายชื่อติดต่อ chosen (operator) to avoid colliding with the client field ผู้ติดต่อ (contact-person). git mv preserved history on all 6 moved files. Stale `.next/types/validator.ts` referenced the old route path until the build regenerated it (build-cache artifact, not a code error). 658 unit / lint / typecheck / build green post-rename. Spec doc + README + site-map updated; spec file kept its 81-master-data-management.md name with an amendment banner mapping the old names.

## Spec 82 — content-named route namespace (program), Units 1–4 (2026-06-14, UNITS 1–4 COMPLETE; only Unit 5 cleanup remains)

Operator: "site map looks weird, pm lands on sa. The map should be about what is shown on the page, not the role." Program spec [82](feature-specs/82-content-named-routes.md): URL names the surface, role decides landing+chrome, never the prefix. `/requests` already proves the model; project/review/payroll/contacts are holdouts. Five units. **Unit 1 = neutralize the shared project detail subtree `/sa/projects/*` → `/projects/*`** (kills the reported "PM lands on /sa"). Hubs `/sa` + `/pm/projects` stay role-named until Unit 3.

Pre-code audit: notifications (compose-notification.ts) are text-only, NO deep links — redirect concern is external bookmarks only; no routing ADR touches this.

SHIPPED: `git mv src/app/sa/projects → src/app/projects` (history preserved; `/sa` hub page itself stays put). New `src/lib/nav/project-paths.ts` (TDD red→green: project-paths.test.ts, 4 tests) — `projectHref`/`workPackageHref`/`projectSettingsHref` builders replace ~14 scattered inline `/sa/projects/...` template literals across pages, server-action revalidatePaths, the WP-list row, both `/requests` WP cross-links, the reports back chip, the PM-decision cross-revalidate, and both hub rows. The scatter was _why_ the role prefix leaked everywhere → one file to touch on future moves (reports keeps its `/pm/...` home → no builder yet, Unit 2). 3 external importers (`wp-assignment-panel`, `work-package-notes`, `upload-queue-runner`) repointed `@/app/sa/projects/...` → `@/app/projects/...`. `next.config.ts` 307 redirect `/sa/projects/:path*` → `/projects/:path*` (NOT 308 — installed PWA caches permanent redirects stickily; Unit 5 promotes). Bottom-tab highlight: SA hub tab (`/sa`) + PM/super tab (`/pm/projects`) both gain `match: ["/projects"]` (the project surface left `/sa/*`); the old PM `match: ["/sa"]` is dead, replaced. `projectHubHref` UNCHANGED (it returns hubs, which don't move until Unit 3) — back chips still close their round-trip. No gate/RLS/enum change.

Tests updated for the move: design-doctrine WP_LIST const, bottom-tab-bar (2 cross-surface paths → `/projects`, +1 new SA-on-/projects pin), work-package-notes + settings-form mock/import paths, labor-log-zone + detail-header sample strings. LESSON (re-confirmed from spec 81): a route `git mv` leaves stale `.next/dev/types/validator.ts` + `.next/types/validator.ts` pointing at old paths → `tsc` and `next build` both fail on phantom missing modules; `rm -rf .next` + rebuild regenerates them clean. Gates: lint ✓ / typecheck ✓ / build ✓ (route table shows `/projects/[projectId]/*`, `/sa` hub intact) / 663 unit ✓ (was 658; +4 path-builder +1 tab) / e2e 27/27 (2 chromium cold-start flakes on untouched `/sa`+`/pm` proxy-redirect tests, 8/8 on warm re-run). site-map.md + feature-specs README + this tracker updated same-unit.

**Unit 2 SHIPPED (same session, operator "proceed"/override of the one-unit rule):** `git mv src/app/pm/projects/[projectId]/reports → src/app/projects/[projectId]/reports` (history preserved; the `/pm/projects` hub page itself stays — only its reports child moved). New `reportsHref(id)` builder (TDD red→green: +reportsHref test) replaces the project-page รายงาน chip href + the reports `actions.ts` revalidatePath. `next.config.ts` second 307: `/pm/projects/:projectId/reports` → `/projects/:projectId/reports` — SPECIFIC source (`:projectId/reports`, not `:path*`) so the `/pm/projects` hub is untouched. status-colors.ts "used-by" comment + bottom-tab-bar nested-page test path (`/pm/projects/abc/reports` → `/projects/abc/reports`) + go-live-checklist operator URLs (×2) + site-map.md updated. No external importers into the reports dir (verified). Reports stays PM_ROLES-gated; back chip already → projectHref (Unit 1). Gates: lint ✓ / typecheck ✓ / build ✓ (`/projects/[projectId]/reports` present, `/pm/projects` hub intact) / 664 unit ✓ (+1 reportsHref). No reports-specific e2e exists; the move touches no auth/proxy code, so Unit 1's e2e pass holds.

**Unit 3 SHIPPED (same session, operator "ok"/continued override):** folded the two project-list hubs (`/sa` for site_admin, `/pm/projects` for pm/super — same query, same row behaviour) into ONE content-named `/projects` hub. New `src/app/projects/page.tsx` (+loading.tsx) gated SITE_STAFF_ROLES; the role decides ONLY the chrome (kicker หน้างาน vs ผู้จัดการโครงการ; desktop HubNav SA_HUB_NAV vs PM_HUB_NAV) — URL + row behaviour identical. Client-name row now shows for all staff (clients are staff-readable; matches the project detail header). `git rm` old `src/app/sa/page.tsx`+`loading.tsx` and `src/app/pm/projects/page.tsx`+`loading.tsx` (both dirs now empty). `roleHome(site_admin)` `/sa`→`/projects` (pm/super stay `/pm` review queue). **`projectHubHref` RETIRED** (deleted from role-home.ts) — the WP-list back chip is now the constant `/projects`; the spec-59 role-aware helper and the PM-bounced-to-/sa bug it patched are gone. HubNav SA/PM "โครงการ(และรายงาน)" items + both bottom-tab โครงการ tabs → href `/projects` (tab `match` prefixes dropped — href covers `/projects/*`). coming-soon: site_admin redirect → `/projects`; super_admin OperatorHub's two now-duplicate project links (หน้างาน + โครงการและรายงาน) merged to one. settings/actions revalidates `/projects` (was `/sa`+`/pm/projects`). `next.config.ts` two exact 307s: `/sa`→`/projects`, `/pm/projects`→`/projects` (the Unit-1 `/sa/projects/*` + Unit-2 `/pm/projects/*/reports` rules are more specific, stay above). Tests: role-home (site_admin→/projects, projectHubHref block removed), hub-nav + bottom-tab pins, handoff-poll-route (site_admin role-home → /projects — the one initially-missed failure, caught by the suite), e2e `/sa`→`/projects` protected-hub check. Gates: lint ✓ / typecheck ✓ / build ✓ (`/projects` hub present, `/sa`+`/pm/projects` gone) / 661 unit ✓ (664 − 3 retired projectHubHref tests + ... net 661) / e2e [running].

**Unit 4 SHIPPED (same session, operator "next"/continued override):** the last role-named surfaces moved to content-named ones. `git mv`: `pm/page.tsx`+`loading.tsx` → `review/`, `pm/work-packages` → `review/work-packages`, `pm/payroll` → `payroll`, `pm/contacts` → `contacts` (Windows quirk: `git mv` needed the `review/` target dir pre-created with `mkdir`). `roleHome(pm/super)` `/pm` → `/review`. Rewired: review queue page (currentHref + WP link), review WP detail (backHref + 2 LaborZone revalidate props), review actions (4 revalidatePaths → `/review`+`/review/work-packages`), record-decision-form `router.push("/review")`, payroll page (exportHref `/payroll/export` + currentHref), contacts actions (`CONTACTS_PATH`) + the `contacts-tabs` import (`@/app/contacts/actions`), PM_HUB_NAV (3 hrefs), PM_TABS (2 hrefs), coming-soon (pm redirect + operator-hub link), status-colors used-by comments, the project-WP-page producer comment. `next.config.ts` four 307s: `/pm/work-packages/:path*`, `/pm/payroll/:path*`, `/pm/contacts`, then bare `/pm` LAST (exact — must not shadow the specific subtree rules nor the still-live `/pm/requests`). **Left in place (out of scope):** `src/app/pm/requests/route.ts` — the spec-19 `/pm/requests`→`/requests` legacy 308 (now the only thing under `/pm`; Unit 5 candidate to fold into next.config). Tests: role-home + role-sets + require-role (pm roleHome → `/review`, the TDD red set), hub-nav + bottom-tab pins/paths, e2e `/pm`→`/review` protected-hub check. Gates: lint ✓ / typecheck ✓ / build ✓ (`/review`, `/payroll`, `/contacts`, `/review/work-packages/[id]` present; only `/pm/requests` left under `/pm`) / 661 unit ✓ / e2e [running].

REMAINING (spec 82): **only Unit 5** — promote the 307 redirects to permanent (308) once link sources are confirmed migrated, and drop dead/foldable rules (incl. the `/pm/requests` legacy handler → a next.config rule). Everything user-facing is content-named now. OPERATOR OWES (acceptance round-trip): SA → lands `/projects`; PM/super → lands `/review`; review queue → tap WP → `/review/work-packages/[id]`, decision → back to `/review`; ค่าจ้าง → `/payroll` (+ CSV export); ติดต่อ → `/contacts`; all old `/sa*`, `/pm*` bookmarks 307-redirect.

## Spec 83 — Contacts v2 Unit 1: contractor taxonomy + enrich + DC backfill (2026-06-14, SHIPPED)

First unit of the operator-approved **Contacts v2** program (autonomous 15hr run; decisions locked in memory prc-ops-contacts-redesign-plan.md; full-auto prod+main). DB-only, additive. **SHIPPED (migration 20260628000000 applied to prod, pgTAP 948/0):** contractors gains the taxonomy — `contractor_category`('contractor'|'dc'), `contractor_subtype`(NULL; 'regular' | 'dc_company'/'dc_regular'/'dc_temporary') gated by a subtype↔category CHECK, `status` contact_status('active'|'probation'|'blacklisted') — plus enrichment columns contact_person/email/mailing_address/tax_id/specialty (nullable + length CHECK). KEY MODEL: **DC is a classification of contractors, NOT a new table** (a DC party already IS a contractors row via workers.contractor_id; labor_logs.contractor_id_snapshot groups payroll by it). **DC-wins backfill:** any contractor referenced by a dc worker → category='dc' (subtype NULL for triage); dual-role crews surface under DC. worker_type('own','dc') untouched (orthogonal). 3 new enums (contact_status/contractor_category/contractor_subtype). Column-scoped INSERT/UPDATE grants extended; NO RLS policy touched (rides the eval-once-wrapped contractors policies; file 40 untouched). All 4 load-bearing FKs byte-intact. STATUS WRITES ride the existing UPDATE policy + grant for v1 (recorded seam: audited set_contractor_status RPC deferred — needs no audit_action enum value this way). pgTAP file 24 +13 (columns/defaults/CHECK/grants + DC-backfill replay). db:types regen byte-exact (30 ins/0 del). 661 unit / 948 pgTAP / lint / typecheck / build green.

## Spec 84 — Contacts v2 Unit 2: suppliers enrich + service_providers (2026-06-14, SHIPPED)

DB-only, additive. **SHIPPED (migration 20260628000100 applied to prod, pgTAP 968/0):** (1) suppliers gains contact_person/email/mailing_address/tax_id/payment_terms (nullable + length CHECK, column grants extended; rides existing eval-once-wrapped policies; FK purchase_requests.supplier_id intact). (2) NEW service_providers master (ผู้ให้บริการ → รถขนส่ง): id/name(nonblank)/service_subtype enum('transport' default)/status contact_status(default active, reuses spec-83 enum)/phone/contact_person/email/mailing_address/vehicle_type/plate_no/note + created_by/created_at; RLS enabled, SELECT staff (sa/pm/super), INSERT/UPDATE pm/super (created_by pinned), policies authored eval-once-WRAPPED from day one, NO delete, NO appsheet_writer. New enum service_subtype. New pgTAP file 44 (13 asserts: table/RLS/policies/no-delete/CHECK/defaults/PM-insert/SA-denied/staff-read/visitor-none/created_by); file 26 +7 (suppliers cols + grants). db:types byte-exact (73 ins/0 del). Greenfield table = zero inbound FK (bank cols arrive U3). 661 unit / 968 pgTAP / green.

## Spec 85 — Contacts v2 Unit 3: bank info, money-isolated (2026-06-14, SHIPPED)

DB-only, additive. **SHIPPED (migration 20260628000200 applied to prod, pgTAP 982/0):** bank details for paid contacts, PM/back-office only (site_admin CANNOT see) — money-isolation like workers.day_rate. DESIGN: dedicated `contact_bank` table with ZERO authenticated access (RLS on, NO policies/grants) — only the service-role admin client (read, behind requireRole pm/super, wired U5) and the SECURITY DEFINER `set_contact_bank` RPC (write, pm/super) touch it. Chosen over money columns on the 3 masters (those carry a TABLE-level SELECT grant — spec-46 C3 — that would leak a bank column unless every non-bank column were re-granted per table: a 3× footgun). Three TYPED nullable FKs + exactly-one-target CHECK (NOT polymorphic) + partial unique index per FK (one bank row per contact). RPC: 42501 non-pm/super, P0001 unless exactly one target, nullif(btrim), upsert (update-else-insert), updated_by=auth.uid(); execute revoked public/anon, granted authenticated (gate inside). New pgTAP file 45 (14 asserts incl. no-SELECT/no-INSERT priv, CHECK 0+2 targets, SA/visitor 42501, upsert one-row + in-place, partial-unique 23505). db:types byte-exact (76 ins/0 del). 661 unit / 982 pgTAP / green. Bank read/write UI = Unit 5.

## Spec 86 — Contacts v2 Unit 4: select primitive + write-action layer (2026-06-14, SHIPPED)

Code-only (no DB). **SHIPPED:** (1) RecordFieldDef gains `type:"select"` + optional `options[]`; maxLength optional; FieldInputs renders a native <select> (FIELD_STACKED appearance-none); blankValues defaults a select to its first option (valid enum, never ""). Existing text/tel/email/textarea branches byte-unchanged. (2) contacts/actions.ts write layer extended (still PM-gated direct writes, no new RPC): contractors create/update +contractorCategory/contractorSubtype/status (checkEnum over Constants.public.Enums; invalid→generic; subtype ""→null on update) +contact_person/email/mailing_address/tax_id/specialty; suppliers +contact_person/email/mailing_address/tax_id/payment_terms; NEW service_providers create/update (serviceSubtype/status enum-checked + vehicle_type/plate_no + contact fields); clients unchanged. Enum writes spread-omit undefined (exactOptionalPropertyTypes). record-manager.test +1 (select renders + reports value). 662 unit / lint / typecheck / build green. Consumed by U5 (detail page) + U6 (list UI). Bank stays the contact_bank RPC (U3).

## Spec 87 — Contacts v2 Unit 6: list-first UI (5 tabs) (2026-06-14, SHIPPED)

Code-only. The operator's headline ask. **SHIPPED:** RecordManager +2 additive props — `addInSheet` (an Add button opens the add form in a BottomSheet, spec 78; AddCard gains `bare`+`onDone`) and `rowBadge` (status chip). ContactsTabs now 5 tabs: ลูกค้า/ผู้ขาย/ผู้รับเหมา/DC/ผู้ให้บริการ — ผู้รับเหมา & DC are the ONE contractors table split by contractor_category in page.tsx. Per-type schemas use the spec-86 select primitive: contractors get a STATUS select (ปกติ/ทดลองงาน/บัญชีดำ = active/probation/blacklisted — maps the operator's ประจำ/ทดลองงาน/บัญชีดำ; create injects category='contractor'), DC get ประเภท DC subtype select (บริษัท/ประจำ/ชั่วคราว) + status (create injects category='dc'), service providers get status + vehicle/plate, suppliers get tax_id/payment_terms, clients unchanged. contractor/DC/service rows show a status badge (amber probation / red blacklist) + an in-memory status sub-filter (ทั้งหมด/ปกติ/ทดลองงาน/บัญชีดำ). Inline per-row edit retained (detail page next unit). page.tsx fetches all fields, splits contractors by category, adds service_providers. record-manager.test +2 (addInSheet opens sheet, rowBadge chip). 664 unit / lint / typecheck / build green. No DB. Acceptance = operator phone (PM-gated; preview can't auth).

## Spec 88 — Contacts v2 Unit 5: contact detail page + bank block (2026-06-14, SHIPPED)

Code-only (contact_bank + RPC shipped U3). **SHIPPED:** new route /contacts/[type]/[id] (PM/super; type ∈ clients|suppliers|contractors|service-providers, DC uses the contractors route). Server fetches the record (user session, notFound if missing) + bank (admin read, behind the requireRole gate). Renders DetailHeader (back→/contacts) + a read-only field list (Thai labels; status/subtype→Thai) + ContactBankBlock. Field editing stays inline on the list (spec 87); detail = display + bank (+ docs/crew in U7/U8). BANK: src/lib/contacts/bank.ts getContactBank(admin, kind, id) [zero-auth contact_bank read, admin-only]; setContactBank action (PM-gated, calls set_contact_bank RPC on the USER session for auth.uid()/role); ContactBankBlock client (bank name/account no/account name, "เฉพาะผู้จัดการเห็นข้อมูลนี้", save→toast+refresh). clients have no bank. RecordManager +rowHref (row name → detail link); contacts-tabs wires per-type hrefs (DC→contractors route). contact-bank-block.test (RED first, 2). 666 unit / lint / typecheck / build green. Acceptance = operator phone (PM-gated).

## Spec 89 — Contacts v2 Unit 9: blacklist hidden from assignment pickers (2026-06-14, SHIPPED)

Code-only. The operator's core ask. Blacklist = status (never delete, spec 83), so filter at PICKERS, never at history/payroll. **SHIPPED:** (1) WP owner picker — the WP detail page fetches contractors incl. status and passes WpAssignmentPanel a list filtered to drop status='blacklisted' EXCEPT the WP's current owner (an already-assigned now-blacklisted contractor still lists — never blank an existing assignment); assignedContractor header lookup uses the full list; panel unchanged. (2) DC-parent picker — /workers fetches status+contractor_category; WorkerRosterManager filters the new-DC-worker dropdown to category='dc' && status!='blacklisted', while the FULL list still resolves names for existing rows (a worker with a blacklisted/non-dc parent still shows its name). Payroll/history UNFILTERED. worker-roster-manager.test +1 (DC picker shows only non-blacklisted DC crews). 667 unit / lint / typecheck / build green. No DB. Acceptance = operator phone.

## Spec 90 — Contacts v2 Unit 8: crew on a contractor's detail page (2026-06-14, SHIPPED)

Code-only. The operator's "teammates under that subcon". **SHIPPED:** ContactCrewSection (client) on /contacts/contractors/[id] — lists the DC workers parented by the contractor (names only) + an add form (name + day rate). Add reuses createWorker({name, workerType:'dc', dayRate, contractorId}) — the spec-46 RPC-backed action; day rate REQUIRED at creation (the RPC needs it), but rates are NEVER displayed here (money stays on /workers). The detail page (PM-gated) fetches crew (workers where contractor_id=id AND worker_type='dc', user session, id+name only) and renders the section only for the contractors route. contact-crew-section.test (RED first, 2: lists crew; add calls createWorker w/ dc+contractorId+dayRate). 669 unit / lint / typecheck / build green. No DB. Seam: remove/re-parent a crew member from the contact screen (today: deactivate on /workers).

===== FILE: docs/specs/v1-entities.md =====

# v1 Database Entities

The five tables that will be deployed for the v1 pilot.

## projects

Represents a construction project. The top-level grouping for all work packages, photos, and approvals.

Key fields: `id`, `name`, `status` (Postgres enum), `created_at`, `created_by`.

## work_packages

A unit of work within a project. Photos are attached to work packages. PMs approve at the work package level.

Key fields: `id`, `project_id` (FK → projects), `name`, `status` (Postgres enum), `created_at`.

## photo_logs

An append-only log of photos uploaded against a work package. Logical edits use the supersede pattern (`superseded_by` FK → photo_logs).

Key fields: `id`, `work_package_id` (FK → work_packages), `storage_path`, `exif_captured_at`, `uploaded_by` (FK → users), `uploaded_at`, `superseded_by` (FK → photo_logs, nullable).

## users

Application users synced from Supabase Auth. Stores role and LINE identity linkage.

Key fields: `id` (matches Supabase Auth UID), `display_name`, `role` (Postgres enum: `site_admin` | `pm`), `line_user_id`, `created_at`.

## audit_log

Append-only event log. Records every status change, photo upload, approval, and import. Never updated or deleted.

Key fields: `id`, `event_type` (Postgres enum), `actor_id` (FK → users), `target_table`, `target_id`, `payload` (JSONB), `occurred_at`.

---

# PART 2 — DESIGN CANON (the reference)

===== FILE: docs/ui-conventions.md =====

# UI Conventions

Consolidated from the design-system specs (14, 17–20, 28, 38, 40, 41) and the
code as of 2026-06-12. This is the reference for any new screen or component.
The specs remain the authority for _why_; this doc records _what is current_.
If a convention here conflicts with newer shipped spec work, update this doc
in the same unit.

## 1. Language — Thai-first (spec 14)

- Every user-facing string is Thai: headings, nav, buttons, pills, empty
  states, error strips, form labels/placeholders, hints, aria-labels,
  confirm text, metadata.
- **Latin stays Latin:** `PRC Ops`, `LINE` (brands), project/WP/deliverable
  codes, `PDF`, file-format names (JPEG/PNG/WebP/HEIC).
- Enum values, route paths, redirect targets are storage keys — never
  translated. The label is presentation only.
- The binding glossary lives in spec 14 §A. All new copy must reuse its
  terms (โครงการ, รายการงาน, คำขอซื้อ, …).
- Thai has no plurals: counts render as `{n} รายการ`, no ternaries.
- Single-language by design — no i18n library, no locale switcher.

### Labels and dates — `src/lib/i18n/labels.ts`

The only place enum labels live. Never write a per-file status-label map.

- Maps: `WORK_PACKAGE_STATUS_LABEL`, `PROJECT_STATUS_LABEL`,
  `PURCHASE_REQUEST_STATUS_LABEL`, `PURCHASE_REQUEST_PRIORITY_LABEL`,
  `PHOTO_PHASE_LABEL`, `APPROVAL_DECISION_LABEL`, `USER_ROLE_LABEL`.
- Dates: `formatThaiDateTime(iso)` / `formatThaiDate(iso)` —
  `th-TH-u-ca-buddhist` (Buddhist era) pinned to `Asia/Bangkok`, so server
  and client render identically. Never call `toLocaleString` directly.
- `tests/unit/i18n-labels.test.ts` enforces: every enum value labeled,
  labels non-empty and distinct per map.

## 2. Typography and document setup

- Font: **Sarabun** via `next/font/google`, subsets `["thai", "latin"]`,
  weights `400/500/600` only (not a variable font — weight is mandatory).
  Matches the PDF font (spec 13). `--font-sans: var(--font-sarabun)`.
- **Geist Mono** for codes only (project/WP codes): `font-mono text-xs`.
- `<html lang="th">`; metadata title template `%s — PRC Ops`; per-route
  static Thai `metadata.title`.

## 3. Color doctrine — sun-readable light theme (spec 20, amended by 38/40)

Users are outdoors on phones. Light ground wins in glare; dark pixels become
a mirror. Hard floors:

- Ground is light. Pages: `bg-zinc-50`; cards/headers: `bg-white`. Ink is
  `text-zinc-900`. No `.dark` class is ever set; `html { color-scheme:
light; }` in `globals.css` blocks Chrome Android force-dark. Theme color
  `#ffffff`.
- **No mid-gray meaningful text.** Secondary-text floor is `zinc-600`.
  `zinc-400/500` only for decoration (dividers, disabled, placeholder).
- **Hue roles are exclusive:**
  - `blue-700` — links and active nav only (`text-blue-700`).
  - `slate-900` — primary action fills (spec 40: `bg-slate-900`,
    hover `slate-800`) and the brand header band.
  - `amber-400` — brand accent (the "Ops" in the wordmark, deliverable
    group `border-l-4`).
  - zinc / amber / emerald / red / sky — status pill slots only.
  - `red-600` — destructive actions.
- Status = solid saturated fills, identifiable by hue alone at arm's length
  — never tinted translucency.
- Recorded dark exceptions: ConfirmDialog and PhotoLightbox scrims
  (`bg-black/85`), the LINE login button, the AppHeader brand band.

## 4. Status pills

- Component: [status-pill.tsx](../src/components/features/status-pill.tsx).
  Geometry: `shrink-0 rounded-full border px-3 py-1 text-sm font-semibold`.
- Colors come ONLY from [status-colors.ts](../src/lib/status-colors.ts) —
  never hardcode pill classes in a page. Six helpers:
  `projectStatusPillClasses`, `workPackageStatusPillClasses`,
  `approvalDecisionPillClasses`, `reportStatusPillClasses`,
  `purchaseRequestStatusPillClasses`, `purchaseRequestPriorityPillClasses`.
- The six palette slots (contrast-audited; see spec 20 §1a amendments):

  | Slot         | Classes                                        | Meaning                 |
  | ------------ | ---------------------------------------------- | ----------------------- |
  | PILL_ZINC    | `border-zinc-400 bg-zinc-200 text-zinc-900`    | neutral / not started   |
  | PILL_AMBER   | `border-amber-600 bg-amber-400 text-zinc-950`  | in progress / attention |
  | PILL_EMERALD | `border-emerald-800 bg-emerald-700 text-white` | done / approved         |
  | PILL_RED     | `border-red-700 bg-red-600 text-white`         | rejected / failed       |
  | PILL_SKY     | `border-sky-800 bg-sky-700 text-white`         | in transit              |
  | PILL_MUTED   | `border-zinc-300 bg-zinc-100 text-zinc-600`    | archived / cancelled    |

  Amber keeps dark text (white-on-amber fails AA); emerald is 700 not 600
  (white-on-600 = 3.67:1, fail).

## 5. Layout

### Page width — `PAGE_MAX_W` (spec 41)

One canonical token in [page-width.ts](../src/lib/ui/page-width.ts):
`max-w-2xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl`. Every content page's
header strip, nav strip, and content container use it. `AppHeader`/`HubNav`
accept only `typeof PAGE_MAX_W` — the type system prevents drift.
Recorded exceptions: `/login`, `/profile`, `/coming-soon` — single-card
form screens at `max-w-md`.

### Page anatomy

```
<PageShell>                                ← THE scroller (spec 64); body is locked
  <DetailHeader …> | <AppHeader …>         ← sticky chrome (spec 62/63)
  <section class="mx-auto {PAGE_MAX_W} px-5 py-6">   ← gap-8 between sections
```

- Every route renders `PageShell`
  ([page-shell.tsx](../src/components/features/page-shell.tsx), spec 64)
  — the body is `overflow-hidden`; the shell's `<main>` is the only
  scroll container, so sticky headers and fixed chrome cannot drift on
  iOS bounce. Variants: `app` (content pages), `card` (single-card
  screens), `bare`. Hand-rolling a `<main>` is a review reject.
- The `app` variant's `pb-20 sm:pb-0` clears the phone tab bar.
- Back link: `text-xs font-medium text-blue-700 hover:underline`, text
  `← {ชื่อหน้าก่อนหน้า}` (back-nav targets are locked behavior, spec 12).
- Title: `text-xl font-semibold tracking-tight`; code above it in
  `font-mono text-xs text-zinc-600`. DETAIL pages (WP, request) use the
  spec-54 scale instead: `text-2xl font-bold tracking-tight`.
- **Detail headers render `DetailHeader`**
  ([detail-header.tsx](../src/components/features/detail-header.tsx),
  spec 63) — back chip + refresh + actions slot + sticky chrome in one
  shell. Hand-rolling a detail header is a review reject.
- **Shared chrome classes live in
  [classes.ts](../src/lib/ui/classes.ts)** (spec 63): `BUTTON_PRIMARY`,
  `BUTTON_SECONDARY`, `ICON_CHIP`, `ICON_CHIP_MUTED`, `INLINE_ERROR`,
  `CARD`, and (spec 65) `SECTION_HEADING`, `DETAIL_TITLE`,
  `FIELD_INPUT`, `FIELD_SELECT`, `FIELD_STACKED`,
  `BUTTON_PRIMARY_COMPACT`, `BUTTON_SECONDARY_COMPACT`,
  `BUTTON_SECONDARY_MUTED`, `INLINE_ALERT_TEXT`, `BANNER_ERROR`.
  Copying these class strings inline is a review reject — import the
  constant. Every value is pinned byte-for-byte in
  `tests/unit/ui-classes-spec65.test.ts`.
- Section heading: `SECTION_HEADING`
  (`mb-3 text-base font-semibold text-zinc-900`).

### Names and truncation (spec 57)

The WP is the center of information — scope, time, and resource all map
against it (operator principle, 2026-06-13). Its identity must stay
readable:

- Detail-page subject (WP name, request item description): NEVER
  truncate — `break-words`, full wrap, no clamp.
- List rows (WP list, PM queue): `line-clamp-2 break-words` — bounded
  rows, never single-line `truncate`.
- Meta/context lines (project line, WP link on a request) may truncate —
  they are context, not the page's subject.

### Cards, lists, panels (spec 38 class map)

- Card / list item: `rounded-xl border border-zinc-200 bg-white px-4 py-3
shadow-sm` (rows min-h-16).
- Sub-panel: `rounded-lg border border-zinc-200 bg-zinc-50`.
- Card lists on hub pages go `lg:grid-cols-2` — width buys density, not
  stretched cards (spec 40).
- Deliverable groups (work-package-list): one elevated white card per
  group; header = slate-50 band with `border-l-4 border-amber-400`, bold
  slate-900 name, mono code; WPs are divided rows inside with hover wash
  and `ring-inset` focus. Flat mode (no deliverables) keeps standalone
  cards. (spec 40 §3)
- Photo galleries: horizontal filmstrip, never a growing grid (spec 49).
  Use `PhotoStrip` + `PHOTO_STRIP_TILE` from
  [photo-strip.tsx](../src/components/features/photo-strip.tsx) —
  fixed-square `h-28 w-28 shrink-0 snap-start` tiles in one
  `overflow-x-auto snap-x` row; phase headings announce the count
  `({n})`. Page height stays constant regardless of photo volume.

## 6. Shared chrome

- **AppHeader** ([app-header.tsx](../src/components/features/app-header.tsx))
  — the slate-900 brand band (spec 38): wordmark `PRC` white + `Ops`
  amber-400, white heading (สวัสดี คุณ{fullName}), desktop-only โปรไฟล์
  link, dark-variant logout. Hub pages only — detail screens keep light
  breadcrumb headers (they are content, not chrome).
- **HubNav** ([hub-nav.tsx](../src/components/features/hub-nav.tsx)) —
  desktop only (`hidden sm:block`), `bg-zinc-100` strip; active item
  `border-b-2 border-blue-700 font-semibold`.
- **BottomTabBar**
  ([bottom-tab-bar.tsx](../src/components/features/bottom-tab-bar.tsx)) —
  phone only (`sm:hidden`), fixed bottom, `bg-white/95 backdrop-blur` +
  `pb-[env(safe-area-inset-bottom)]`; active tab `text-blue-700` with top
  indicator bar; longest-prefix-wins matching. SA tabs: โครงการ / คำขอซื้อ /
  โปรไฟล์. PM tabs: รอตรวจ / โครงการ / คำขอซื้อ / โปรไฟล์.

## 7. Controls and forms

- **Touch targets:** 44 px minimum (`h-11` inputs/buttons, `min-h-11`
  chips/tabs, 56 px WP rows) — gloved-hands convention (spec 18).
- Primary button: `rounded-lg bg-slate-900 shadow-sm` + hover `slate-800`
  - `active:translate-y-px`, white text.
- Secondary: `rounded-lg border border-zinc-300 bg-white shadow-xs`.
- Fields: `rounded-lg border border-zinc-400 bg-white shadow-xs` — fields
  KEEP `zinc-400` borders (WCAG 1.4.11 boundary; zinc-300 regressed to
  1.48:1, lens-caught in spec 38).
- Focus: blue ring with `focus-visible:ring-offset-2` on solid fills.
- **Save lifecycle:** button `บันทึก` → `กำลังบันทึก…` (disabled, inputs
  disabled) → on round-trip success a `role="status"` span
  `text-xs font-medium text-emerald-700` reading `บันทึกแล้ว`. Never show
  "saved" before the server confirms.
- **Error strips:** `role="alert"`, `rounded-md border border-red-300
bg-red-50 px-3 py-2 text-xs text-red-900`. Message text ends with
  `กรุณาลองใหม่อีกครั้ง` unless a more specific action applies.
- **Notices** ([notices.tsx](../src/components/features/notices.tsx)):
  `ErrorNotice` (red-600 border, red-50, `font-medium text-red-900`) for
  fetch failures; `EmptyNotice` (zinc, centered `text-zinc-600`) for empty
  lists — always a concrete Thai sentence (ยังไม่มีโครงการ,
  ไม่มีรายการรอตรวจ), never blank space.
- **ConfirmDialog**
  ([confirm-dialog.tsx](../src/components/features/confirm-dialog.tsx)):
  `bg-black/85` scrim (recorded dark exception), `max-w-sm` white box,
  ยกเลิก + red-600 confirm, Escape/overlay-click cancels. No
  `window.confirm`.

## 8. Loading

Every route group has a `loading.tsx` rendering
[page-skeleton.tsx](../src/components/features/page-skeleton.tsx) — it
mirrors the page anatomy (zinc-50 main, white header strip, `h-16
rounded-lg` row placeholders) with an sr-only `กำลังโหลด…`.

## 9. Server vs client components

Server by default (CLAUDE.md). `'use client'` requires justification and is
earned only by:

1. form state / `useTransition` / `router.refresh`
2. navigation hooks (`usePathname` for active tabs)
3. keyboard or window event listeners (Escape, document-level)
4. IndexedDB / localStorage / Service Worker access
5. open/close/focus view state

Pages, layouts, AppHeader, HubNav, StatusPill, notices, and skeletons are
all server components.

## 10. Hard floors — do not change without a spec

- PILL\_\* fills and `StatusPill` geometry; `status-colors.ts` mappings.
- Ink-on-white text floors (§3); `color-scheme: light`; theme `#ffffff`.
- 44 px touch targets.
- `text-blue-700` as the link convention; slate-900 as the action fill.
- The LINE login button; ConfirmDialog/lightbox scrims.
- `PAGE_MAX_W` and its three recorded exceptions.
- Locked behaviors (spec 14 checklist): pinned-form modes, back-nav
  targets, group-header semantics, progress-from-unfiltered, avatar
  precedence.

Several of these are pinned by named UPDATE-tests — a visual change that
moves a pinned class must update the test in the same unit, with the spec
naming the change.

## 11. Spec 67 doctrine deltas (2026-06-13) + anti-drift pins

- **Thai leading.** Wrapping headings carry explicit `leading-` (Latin-tuned
  defaults crowd stacked tone marks). `DETAIL_TITLE` = `leading-snug`.
- **Token canon (amends §3).** Positive/done = **emerald**; current/in-progress
  = **amber**; `blue-700` stays links/active-nav ONLY (never a fill). No
  off-palette `green-*` anywhere.
- **Segmented controls / radios** use the shared `RadioChip`
  ([radio-chip.tsx](../src/components/features/radio-chip.tsx)) — a native
  `sr-only` radio (keyboard + SR from the browser), 44px. A `role="radio"` on a
  `<button>` is a review reject (it lies about keyboard support).
- **Destructive actions** use the shared `ConfirmActionButton`
  ([confirm-action-button.tsx](../src/components/features/confirm-action-button.tsx))
  or `ConfirmDialog`. `window.confirm` is a review reject (§7).
- **Anti-drift.** `tests/unit/design-doctrine.test.ts` reads `src/` and fails on
  recurrence: `window.confirm(`, off-palette `green-*`, `min-h-9`, group-header
  `truncate`, missing `DETAIL_TITLE` leading, the blue progress fill. The
  doctrine is now enforced by a test, not by one operator's eye.

===== FILE: docs/design-directions-2026-06.md =====

# Design directions — June 2026 (the "looks generated" fix)

**Status:** proposal — operator picks a direction (ก/ข/ค) from
`/design-preview` on a phone, ideally outdoors. The pick becomes
spec 38 (systematic re-skin). Doc-only; nothing here restyles the app
yet.

## Diagnosis (why it reads as an old/generated app)

1. **Border-everything, depth-nothing** — every block is the same
   `1px zinc border + rounded-md` rectangle on a flat white page. No
   elevation, no figure/ground separation.
2. **One card treatment for every content type** — a photo tile, a
   purchase request, a form, and a notice all look like the same gray
   box; hierarchy exists only in font size.
3. **Default-looking controls** — native selects, plain bordered
   inputs, buttons that are filled rectangles with no pressed/hover
   depth.
4. **No brand** — placeholder icon, no wordmark; the only identity is
   "links are blue."
5. **Uniform cramped spacing** — no rhythm; sections separated by
   rules instead of space.

## Hard floors (non-negotiable, from spec 20)

- Sun-readable contrast ratios stay: ink on white, solid saturated
  pills (the PILL\_\* recipes are the status identity — untouched in all
  three directions), blue-700 actions ≥ ~6.8:1.
- 44 px tap targets, Thai-first copy, locked routes/behaviors.
- `color-scheme: light` posture unchanged.

## The three directions (all live at /design-preview)

### ก — Refined Utility (recommended)

The current language, grown up: depth via a zinc-50 page wash with
white elevated cards, softer radii, real control styling. Lowest risk,
biggest perceived-quality jump per changed class.

| Token       | Value                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| Page        | `bg-zinc-50`                                                                          |
| Card        | `bg-white rounded-xl border border-zinc-200 shadow-sm p-4`                            |
| Heading     | `text-lg font-semibold tracking-tight`                                                |
| Meta text   | `text-[13px] text-zinc-500`                                                           |
| Primary btn | `rounded-lg bg-blue-700 text-white shadow-sm hover:bg-blue-800 active:translate-y-px` |
| Secondary   | `rounded-lg border border-zinc-300 bg-white shadow-xs`                                |
| Input       | `rounded-lg border-zinc-300 bg-white shadow-xs focus-visible:ring-2`                  |
| Section gap | `space-y-6`, rules dropped in favor of whitespace + weight                            |

### ข — Industrial Brand

Direction ก **plus** a construction identity: slate-900 header band
with the wordmark, hi-vis amber accent (already the attention color)
as section markers (`border-l-4 border-amber-400`), bolder headings,
mono codes emphasized. Most "this is OUR product"; slightly busier.

### ค — Soft Cards

Modern SaaS look: zinc-100 page, borderless `rounded-2xl shadow-md`
floating cards, generous padding, pill-shaped primary buttons.
**Honest caveat:** shadow-only edges wash out in direct sun — the
preview keeps a faint border as mitigation, but this direction trades
some outdoor edge-definition for indoor polish.

## After the pick (spec 38 scope sketch)

1. Shared recipes first: card/button/input/section-header classes in
   the shared components (AppHeader, BottomTabBar, StatusPill
   geometry, notices, forms) + globals — pages inherit most of it.
2. Per-surface sweep (the spec-20 playbook: agents per surface, named
   UPDATE-tests for class pins, 3-lens adversarial pass with computed
   contrast ratios).
3. Interim SVG wordmark (Sarabun-weight "PRC Ops" + simple mark) into
   AppHeader + manifest icons — replaced whenever a real logo exists.
4. `/design-preview` route is TEMPORARY (public, static, zero data) —
   deleted in the spec-38 commit that implements the pick.

===== FILE: docs/app-feel-options.md =====

# Making PRC Ops feel like an app — options & recommendation (2026-06-11)

**Operator question:** "The app doesn't feel a lot like an app yet,
because it uses a browser — how do we take care of that? Not sure if
LINE Mini App will solve the problem."

**Short answer:** the "browser feel" and the "reach/login friction" are
two different problems. A **PWA install** (small work, ~1 day + device
testing) is what removes the browser chrome and puts a real icon on the
phone. A **LINE Mini App** does NOT remove the app-in-a-browser feel —
it moves the app _inside LINE_ (LINE's own header bar, with our domain
shown under the title until verified) — but it gives **zero-login
access** from LINE chats and rich menus, which is its own big win for
staff who live in LINE. They complement each other; neither replaces
the other. Store wrapper apps are not worth it for this team.

All facts below verified against official sources June 2026 (three-agent
research pass; sources in the research notes).

## Option 1 — PWA install (recommended first, iteration 5)

What users get: a real icon on the home screen; the app opens
**full-screen with no URL bar**, with a splash screen — on Android it
is literally installed as an APK (WebAPK). This is the direct fix for
"feels like a browser."

- Work: `app/manifest.ts` (built into Next.js), 192/512px + 180px
  icons, theme color, a minimal service worker (Android's install
  prompt still wants one). Roughly a one-day PR.
- iOS: no automatic prompt — users add via Share → "เพิ่มลงหน้าจอโฮม"
  once (a 30-second guided step at onboarding). iOS 26 (shipped fall 2025) now opens ANY home-screen site as a web app by default, which
  makes this path stronger than it's ever been.
- Login: LINE OAuth inside an installed PWA works (our cookies are
  first-party, set by our own server). Known iOS quirk: the LINE
  consent page opens in an in-app sheet and users may re-login once
  (PWA cookies are separate from Safari's). **Must be device-tested on
  a real iPhone before telling staff to install.**
- Caveat: a PWA **cannot be installed from LINE's in-app browser**.
  Links shared in LINE chat open in LINE's browser; appending
  `?openExternalBrowser=1` to links we send forces the real browser
  (official LINE URL scheme). Install instructions should use that.
- Push notifications: possible on installed PWAs (iOS 16.4+), but see
  Option 3 — LINE messages are the better channel for this team.

## Option 2 — LINE Mini App (yes, but for reach — not for app-feel)

A LINE Mini App is technically our same web app + the LIFF SDK
(`liff.init()`), registered on a Mini App channel. As of **2026-03-11
Thailand allows anyone to publish UNVERIFIED Mini Apps** (link-only
distribution: `https://miniapp.line.me/{liffId}`, QR, rich menu).

What it solves:

- **No login screen at all** — inside LINE the user is already
  authenticated; `liff.getIDToken()` hands us a LINE id_token our
  server already knows how to verify (same verify endpoint we use
  today). Integration cost is modest: accept the Mini App channel's ID
  as a second token audience, and **create the channel under our
  existing provider** so user IDs stay identical.
- Instant reach: tap from a chat message or the OA rich menu → app
  opens, already logged in.

What it does NOT solve:

- It opens **inside LINE** with LINE's native header (title + mandatory
  action button + close): it feels like a LINE service, not a
  standalone app. Unverified apps additionally show our raw domain
  under the title.
- **Home-screen shortcut, service messages (free push), and LINE
  search/Services listing require VERIFIED status** — and for Thailand
  verification is only open to channels under a **certified provider**
  (Thai DBD company certificate, TAX ID, matching legal-entity docs;
  ~5–7 business days for certification, then ~1–2 weeks review, no
  fee documented).
- LY Corp is folding LIFF into the Mini App brand (announced
  2025-02-12) — any new LINE integration should target a Mini App
  channel, not a legacy LIFF app.

## Option 3 — LINE notifications + rich menu (the notification channel)

Regardless of 1/2: the OA **rich menu** (free, up to 20 tap areas) is a
zero-cost launcher for site staff, and **Messaging API pushes** can
deep-link into the app/Mini App already-authenticated. Thailand OA
pricing: Free plan 300 msgs/mo; Basic 1,280 THB/mo for 15,000 (+0.10
THB each beyond). At ~50 staff × 2 work notifications/day ≈ 2,200
msgs/mo → Basic plan ≈ 1,280 THB/mo. ≤10 users can fit the free tier.
This is the natural future home of "งานใหม่รอตรวจ" / "คำขอซื้อได้รับการ
อนุมัติ" notifications (a future spec; needs the Messaging API channel

- user opt-in via the OA).

## Option 4 — real store apps (NOT recommended)

Apple rejects thin web wrappers (Guideline 4.2 "beyond a repackaged
website"); Capacitor's remote-URL mode is explicitly "not for
production." Google Play needs an org account (D-U-N-S) or a 14-day
12-tester gauntlet on personal accounts. Private distribution (managed
Play / Apple unlisted / ABM) is administratively disproportionate for
10–50 BYOD phones at a Thai contractor. Revisit only if the app someday
needs deep native features.

## Recommended sequence

1. **Iteration 5: ship the PWA** (manifest, icons, theme color, minimal
   SW) + a one-page Thai install guide (with the
   `?openExternalBrowser=1` escape) + real-iPhone test of the LINE
   login round-trip in standalone mode.
2. **When notifications are wanted:** LINE OA rich menu + Messaging API
   deep links (Basic plan ~1,280 THB/mo at full scale). Target a Mini
   App channel (unverified) at the same time so taps open zero-login.
3. **In parallel (paperwork, no code):** start LINE **certified
   provider** registration with the company's DBD documents — it
   unlocks verified Mini App status (home-screen shortcut, free service
   messages, no domain subtext) whenever we want it.

## Operator decisions needed (none block iteration 5)

- Approve the PWA unit (icons need a logo/brand mark — or I generate a
  simple "PRC" mark as placeholder).
- Whether/when to start certified-provider paperwork (needs company
  DBD certificate + TAX ID).
- Notification appetite (drives the OA plan cost: free ≤300 msgs/mo vs
  1,280 THB/mo Basic).

---

# PART 3 — CORE CODE (tokens + shared primitives) — EDIT HERE

===== FILE: src/app/globals.css =====

@import "tailwindcss";

@custom-variant dark (&:is(.dark \*));

@theme inline {
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-border: var(--border);
--color-input: var(--input);
--color-ring: var(--ring);
--color-chart-1: var(--chart-1);
--color-chart-2: var(--chart-2);
--color-chart-3: var(--chart-3);
--color-chart-4: var(--chart-4);
--color-chart-5: var(--chart-5);
--radius-sm: calc(var(--radius) - 4px);
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);
--font-sans: var(--font-sarabun);
--font-mono: var(--font-geist-mono);
}

:root {
--radius: 0.625rem;
--background: oklch(1 0 0);
--foreground: oklch(0.145 0 0);
--card: oklch(1 0 0);
--card-foreground: oklch(0.145 0 0);
--popover: oklch(1 0 0);
--popover-foreground: oklch(0.145 0 0);
--primary: oklch(0.205 0 0);
--primary-foreground: oklch(0.985 0 0);
--secondary: oklch(0.97 0 0);
--secondary-foreground: oklch(0.205 0 0);
--muted: oklch(0.97 0 0);
--muted-foreground: oklch(0.556 0 0);
--accent: oklch(0.97 0 0);
--accent-foreground: oklch(0.205 0 0);
--destructive: oklch(0.577 0.245 27.325);
--destructive-foreground: oklch(0.985 0 0);
--border: oklch(0.922 0 0);
--input: oklch(0.922 0 0);
--ring: oklch(0.708 0 0);
--chart-1: oklch(0.646 0.222 41.116);
--chart-2: oklch(0.6 0.118 184.704);
--chart-3: oklch(0.398 0.07 227.392);
--chart-4: oklch(0.828 0.189 84.429);
--chart-5: oklch(0.769 0.188 70.08);
}

/_ Spec 67: the dead `.dark` palette was removed. The app is sun-mode
light by design (§3) — `.dark` is never set, color-scheme:light blocks
force-dark, and these tokens redefined a theme that could never apply. _/

@layer base {

- {
  @apply border-border outline-ring/50;
  }
  html {
  /_ Spec 20: the app is sun-mode light by design. Declaring the
  scheme opts out of Chrome Android's force-dark ("also darken
  websites") auto-inversion, which would re-darken the UI. _/
  color-scheme: light;
  /_ Spec 77 (app-feel slice 2): kill the grey iOS tap-flash so our own
  :active press states are what the user sees on touch. _/
  -webkit-tap-highlight-color: transparent;
  }
  body {
  @apply bg-background text-foreground;
  }
  /_ Spec 77: instant taps — drop the legacy ~300ms double-tap-zoom delay on
  every control so a tap registers immediately (the core native feel). _/
  a,
  button,
  summary,
  label,
  [role="button"] {
  touch-action: manipulation;
  }
  }

/_ Spec 76 (app-feel slice 1) — toast enter motion. Motion is OPT-IN per the
prefers-reduced-motion: no-preference pattern: the base .toast-item appears
instantly (the safe reduced-motion default), and only motion-OK users get
the slide+fade. CSS animations are fully supported on iOS WebKit. _/
@keyframes toast-in {
from {
opacity: 0;
transform: translateY(8px);
}
to {
opacity: 1;
transform: translateY(0);
}
}

@media (prefers-reduced-motion: no-preference) {
.toast-item {
animation: toast-in 180ms ease-out;
}
}

/_ Spec 78 (app-feel slice 4) — bottom-sheet slide-up. Base = motion-free
(instant, the reduced-motion-safe default); motion-OK users get the slide. _/
@keyframes sheet-up {
from {
transform: translateY(100%);
}
to {
transform: translateY(0);
}
}

@media (prefers-reduced-motion: no-preference) {
.sheet-panel {
animation: sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1);
}
}

===== FILE: src/app/layout.tsx =====

import type { Metadata, Viewport } from "next";
import { Geist_Mono, Sarabun } from "next/font/google";
import { SwRegister } from "@/components/features/sw-register";
import { UploadQueueRunner } from "@/components/features/upload-queue-runner";
import { ToastProvider } from "@/components/features/toast-provider";
import "./globals.css";

// Sarabun matches the PDF reports (spec 13) — one Thai face across web
// and PDF. Not a variable font, so weight is mandatory; 400/500/600 are
// the only weights used in src/.
const sarabun = Sarabun({
variable: "--font-sarabun",
subsets: ["thai", "latin"],
weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
variable: "--font-geist-mono",
subsets: ["latin"],
});

export const metadata: Metadata = {
title: {
default: "PRC Ops",
template: "%s — PRC Ops",
},
description: "ระบบบริหารงานก่อสร้าง — รูปถ่ายความคืบหน้า อนุมัติงาน และรายงานโครงการ",
};

// Status-bar / splash chrome matches the app's white ground (spec 20).
export const viewport: Viewport = {
themeColor: "#ffffff",
};

export default function RootLayout({
children,
}: Readonly<{
children: React.ReactNode;
}>) {
return (
<html lang="th" className={`${sarabun.variable} ${geistMono.variable} h-full antialiased`}>
{/_ Spec 64: the body is LOCKED — PageShell's <main> is the only
scroller, so sticky/fixed chrome cannot drift on iOS bounce. _/}
<body className="h-full overflow-hidden">
{/_ Spec 76: the toast viewport wraps {children} so a toast fired just
before a router.refresh() survives the RSC re-render. _/}
<ToastProvider>{children}</ToastProvider>
<SwRegister />
{/_ Spec 35: drains the offline photo queue (leftovers from
crash/offline/navigation); renders only when items wait. _/}
<UploadQueueRunner />
</body>
</html>
);
}

===== FILE: src/lib/ui/classes.ts =====

// Canonical UI class constants (spec 63) — the PAGE_MAX_W idea applied
// to the rest of the chrome: one source per pattern, consumers import.
// Constants (not components) because the same classes land on
// <button>, <label>, and <Link> alike. Values are byte-identical to the
// hand-copied strings they replaced — adopting them is a no-op render.
//
// Hand-rolling a copy of any of these is a review reject
// (ui-conventions.md §5/§7).

/\*_ Slate-900 primary action fill (spec 40). _/
export const BUTTON_PRIMARY =
"inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500";

/\*_ White outline sibling of BUTTON_PRIMARY. _/
export const BUTTON_SECONDARY =
"inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 shadow-xs transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:text-zinc-500";

/\*_ 44px white chip for header icon affordances (back/gear/reports). _/
export const ICON_CHIP =
"inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/\*_ ICON_CHIP with muted ink for secondary header actions. _/
export const ICON_CHIP_MUTED =
"inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 active:bg-zinc-100 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/\*_ Inline form/action error strip — pair with role="alert". _/
export const INLINE_ERROR =
"rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900";

/\*_ Standard white card (spec 38 class map). _/
export const CARD = "rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm";

// ---------------------------------------------------------------------------
// Spec 65 additions. Every value below is byte-identical to the hand-rolled
// string it replaced (tests/unit/ui-classes-spec65.test.ts pins each one).
// ---------------------------------------------------------------------------

/\*_ Zone/section heading h2 (ui-conventions §5). _/
export const SECTION_HEADING = "mb-3 text-base font-semibold text-zinc-900";

/\*\*

- Detail-page subject h1 (spec 54/57 — full wrap, never truncate).
- Spec 67: `leading-snug` — a Thai-only app needs explicit leading on a
- wrapping heading, or the next line's stacked tone marks crowd the line
- above (text-2xl default ≈1.33 is Latin-tuned).
  \*/
  export const DETAIL_TITLE = "text-2xl leading-snug font-bold tracking-tight break-words";

/\*_ Standard h-11 text input (forms outside the labor zone). _/
export const FIELD_INPUT =
"h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/\*_ Standard h-11 select (px-2 sibling of FIELD_INPUT). _/
export const FIELD_SELECT =
"h-11 w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-2 text-sm text-zinc-900 shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/\*_ Stacked label+field input used by the labor components (py-2, mt-1). _/
export const FIELD_STACKED =
"mt-1 w-full rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";

/\*_ min-h-11 primary fill, the labor-feature compact pair (vs BUTTON_PRIMARY's h-11). _/
export const BUTTON_PRIMARY_COMPACT =
"inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-slate-800 active:translate-y-px disabled:opacity-50";

/\*_ min-h-11 outline sibling of BUTTON_PRIMARY_COMPACT. _/
export const BUTTON_SECONDARY_COMPACT =
"inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50";

/\*_ Muted secondary used by the photo uploaders (hover zinc-100, opacity disable). _/
export const BUTTON_SECONDARY_MUTED =
"inline-flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 shadow-xs transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-not-allowed disabled:opacity-60";

/\*_ Borderless inline alert text — pair with role="alert" (INLINE_ERROR's light sibling). _/
export const INLINE_ALERT_TEXT = "text-xs font-medium text-red-700";

/\*_ Full-width error banner (login surfaces) — pair with role="alert". _/
export const BANNER_ERROR =
"rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900";

// ---------------------------------------------------------------------------
// Spec 76 (app-feel slice 1) — toast colour trios. Colour only; the shared
// pill layout (rounded/padding/shadow) lives in toast-provider. emerald is
// the sanctioned positive hue (NEVER green-\* — design-doctrine test).
// ---------------------------------------------------------------------------

/\*_ Success toast colours — emerald, the doctrine positive hue. _/
export const TOAST_SUCCESS = "border-emerald-300 bg-emerald-50 text-emerald-900";

/\*_ Error toast colours — the red trio (sibling of INLINE_ERROR's palette). _/
export const TOAST_ERROR = "border-red-300 bg-red-50 text-red-900";

===== FILE: src/lib/ui/page-width.ts =====

// Spec 41 (width unification): THE one content-page width. Every page's
// header strip, nav strip, and content container use this same token —
// AppHeader/HubNav accept only `typeof PAGE_MAX_W`, so a page cannot
// drift to its own width again. Exceptions (recorded): /login,
// /profile, /coming-soon — single-card form screens stay max-w-md.
export const PAGE_MAX_W = "max-w-2xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl";

===== FILE: src/lib/ui/use-toast.ts =====

"use client";

// Spec 76 (app-feel slice 1) — the toast hook + context. Split from the
// provider so any client component can import useToast without pulling the
// viewport renderer. Outside a provider the context is a NO-OP API (never
// throws) so components that fire toasts stay renderable in tests and degrade
// safely if the provider is ever absent — the provider is mounted once at the
// root layout, so in the running app the real API is always present.

import { createContext, useContext } from "react";

export type ToastVariant = "success" | "error";

export interface ToastOptions {
durationMs?: number;
}

export interface ToastApi {
toast: (message: string, opts?: ToastOptions & { variant?: ToastVariant }) => string;
success: (message: string, opts?: ToastOptions) => string;
error: (message: string, opts?: ToastOptions) => string;
dismiss: (id: string) => void;
/\*\*

- Adapter for the canonical server-action result shape
- ({ ok: true } | { ok: false; error: string }) — ok → success(okMessage),
- !ok → error(result.error). One-liner adoption for every action surface;
- returns the new toast id (matching the sibling methods).
  \*/
  fromResult: (result: { ok: true } | { ok: false; error: string }, okMessage: string) => string;
  }

const NOOP: ToastApi = {
toast: () => "",
success: () => "",
error: () => "",
dismiss: () => {},
fromResult: () => "",
};

export const ToastContext = createContext<ToastApi>(NOOP);

export function useToast(): ToastApi {
return useContext(ToastContext);
}

---

# PART 4 — SHELL COMPONENTS (highest leverage — do first)

===== FILE: src/components/features/app-header.tsx =====

import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { RefreshButton } from "@/components/features/refresh-button";

// Shared hub-page header (spec 17). One source for the kicker + greeting
// block that /sa, /pm, /requests, /pm/projects, and the reports page
// each hand-rolled before. Detail screens (breadcrumb-style headers)
// and the bespoke landing/login/profile/coming-soon layouts do NOT use
// this component.
//
// Every hub header carries the โปรไฟล์ link + logout (spec 18
// normalized away the two historical hide-sites). `maxWidthClass`
// remains a prop for the hub/detail width split.

interface AppHeaderProps {
kicker: string;
/** Greeting variant: สวัสดี คุณ{fullName} with a bare สวัสดี fallback. \*/
fullName?: string | null;
/** Fixed-title variant — overrides the greeting (reports page). \*/
title?: string;
maxWidthClass: typeof PAGE_MAX_W;
}

export function AppHeader({ kicker, fullName, title, maxWidthClass }: AppHeaderProps) {
const heading = title ?? (fullName ? `สวัสดี คุณ${fullName}` : "สวัสดี");
return (
// Spec 38: the brand band (direction ข) — the one dark surface in
// the app. White heading on slate-900 is ~17:1; the amber wordmark
// accent is decorative bold text on near-black (≈10:1).
// Spec 62: sticky chrome — z-20 sits under the queue banner (30),
// tab bar (40), and dialog scrims (50).
<header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900 px-5 py-4">
<div className={`mx-auto flex ${maxWidthClass} items-center justify-between gap-3`}>
<div>
<p className="text-xs font-bold tracking-wide text-white">
PRC <span className="text-amber-400">Ops</span>
<span className="mx-2 font-normal text-slate-500">·</span>
<span className="font-semibold tracking-wider text-amber-400 uppercase">{kicker}</span>
</p>
<h1 className="text-xl font-semibold tracking-tight text-white">{heading}</h1>
</div>
<div className="flex items-center gap-3">
{/_ Spec 53: NOT hidden in standalone — the installed PWA has
no reload chrome; this button exists for exactly that. _/}
<RefreshButton variant="dark" />
{/_ Desktop-only: the bottom tab bar carries โปรไฟล์ on phones
(spec 19 §2 — one profile affordance per viewport). _/}
<Link
            href="/profile"
            className="hidden text-sm font-medium text-white transition-colors hover:text-amber-300 hover:underline focus:outline-none focus-visible:underline sm:inline"
          >
โปรไฟล์
</Link>
{/_ Spec 42: hidden in the installed PWA — accidental logout
there forces the expensive LINE re-login path. Deliberate
logout lives on /profile (bottom tab). _/}
<div className="[@media(display-mode:standalone)]:hidden">
<LogoutButton variant="dark" />
</div>
</div>
</div>
</header>
);
}

===== FILE: src/components/features/bottom-tab-bar.tsx =====

"use client";

// Phone-first bottom tab bar (spec 19 §1) — the primary nav on phones,
// where thumbs actually are; the top HubNav strip is desktop-only.
// 'use client' is justified: usePathname for the active tab.
//
// Active-tab rule: LONGEST matching prefix wins — exactly one active
// tab, ever (naive startsWith would light both /pm and /pm/projects on
// every /pm/projects/\* page). Cross-surface paths (a PM on the
// spec-12 back-target /sa/...) match no tab; the bar still renders for
// navigation and in-page back links remain the way "up" works.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
CircleUserRound,
ClipboardCheck,
Contact,
FolderKanban,
ShoppingCart,
type LucideIcon,
} from "lucide-react";

export interface TabItem {
label: string;
href: string;
icon: LucideIcon;
// Extra path prefixes this tab claims beyond its own href. Lets a tab
// stay lit on cross-surface paths (operator report 2026-06-11: PM/super
// browsing /sa/\* project screens lost the highlight entirely —
// reverses spec 19's "cross-surface matches no tab" acceptance).
// Longest-prefix-wins still guarantees exactly one active tab.
match?: ReadonlyArray<string>;
}

export const SA_TABS: ReadonlyArray<TabItem> = [
// Spec 82 Unit 3: the project hub folded to the content-named /projects;
// the tab points straight at it (and lights on every /projects/\* screen).
{ label: "โครงการ", href: "/projects", icon: FolderKanban },
{ label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
{ label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

export const PM_TABS: ReadonlyArray<TabItem> = [
// Spec 82 Unit 4: the review queue is the content-named /review (was /pm).
{ label: "รอตรวจ", href: "/review", icon: ClipboardCheck },
// Spec 82 Unit 3: same folded /projects hub for PM/super; the href lights
// on the hub and every /projects/\* detail screen, so no extra match.
{ label: "โครงการ", href: "/projects", icon: FolderKanban },
{ label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
// Spec 81: contacts management (clients/suppliers/contractors). Phone-first
// users had no way here — it was in the desktop HubNav only. Short tab label
// "ติดต่อ" (the page itself is รายชื่อผู้ติดต่อ) to fit the 5-tab row.
{ label: "ติดต่อ", href: "/contacts", icon: Contact },
{ label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

// Spec 70: procurement's worklist-only nav — the purchasing surface plus
// profile. No โครงการ (no project/WP hub in v1; projects SELECT deferred)
// and no รอตรวจ (procurement is not a decider).
export const PROCUREMENT_TABS: ReadonlyArray<TabItem> = [
{ label: "คำขอซื้อ", href: "/requests", icon: ShoppingCart },
{ label: "โปรไฟล์", href: "/profile", icon: CircleUserRound },
];

function tabsForRole(role: string): ReadonlyArray<TabItem> | null {
if (role === "site_admin") return SA_TABS;
if (role === "project_manager" || role === "super_admin") return PM_TABS;
if (role === "procurement") return PROCUREMENT_TABS;
return null;
}

export function BottomTabBar({ role }: { role: string }) {
const pathname = usePathname();
const tabs = tabsForRole(role);
if (!tabs) return null;

// Longest matching prefix across href + extra match prefixes — still
// exactly one active tab; the longest claim wins regardless of which
// tab owns it.
let active: TabItem | null = null;
let activeLen = -1;
for (const tab of tabs) {
for (const prefix of [tab.href, ...(tab.match ?? [])]) {
const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
if (matches && prefix.length > activeLen) {
active = tab;
activeLen = prefix.length;
}
}
}

return (
<nav
      aria-label="เมนูหลัก"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-300 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.1)] backdrop-blur sm:hidden"
    >
<div className="mx-auto flex h-16 max-w-2xl items-stretch">
{tabs.map((tab) => {
const Icon = tab.icon;
if (tab === active) {
return (
<span
                key={tab.href}
                aria-current="page"
                className="relative flex flex-1 flex-col items-center justify-center gap-1 text-blue-700"
              >
{/_ Visible active signal (spec 20) — a tint alone washes
out in sunlight; the indicator bar survives glare. _/}
<span
                  aria-hidden
                  className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-blue-700"
                />
<Icon aria-hidden className="size-6" />
<span className="text-xs font-bold">{tab.label}</span>
</span>
);
}
return (
<Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-600 transition-colors hover:text-zinc-900 focus:outline-none focus-visible:text-zinc-900 active:scale-95"
            >
<Icon aria-hidden className="size-6" />
<span className="text-xs font-medium">{tab.label}</span>
</Link>
);
})}
</div>
</nav>
);
}

===== FILE: src/components/features/page-shell.tsx =====

// PageShell (spec 64): THE page scroller. The body is locked
// (h-full overflow-hidden in the root layout); this <main> is the only
// thing that scrolls. Sticky headers stick to it crisply on iOS, and
// fixed chrome (tab bar, queue banner, scrims) anchors a viewport that
// can no longer rubber-band — drift is impossible by construction.
//
// Spec-63 consolidation rule: every route renders PageShell;
// hand-rolling a <main> is a review reject (ui-conventions §5).

type PageShellVariant = "app" | "card" | "bare";

const SHELL_BASE = "h-full overflow-y-auto overscroll-y-contain text-zinc-900";

const VARIANT_CLASSES: Record<PageShellVariant, string> = {
/** Content pages: zinc wash + phone tab-bar clearance. \*/
app: "bg-zinc-50 pb-20 sm:pb-0",
/** Single-card screens (login, landing, error, not-found). _/
card: "flex items-center justify-center bg-white px-6",
/\*\* Caller supplies the rest (profile, coming-soon hub). _/
bare: "",
};

interface PageShellProps {
variant?: PageShellVariant;
className?: string;
children: React.ReactNode;
}

export function PageShell({ variant = "app", className, children }: PageShellProps) {
return (
<main className={`${SHELL_BASE} ${VARIANT_CLASSES[variant]} ${className ?? ""}`.trim()}>
{children}
</main>
);
}

===== FILE: src/components/features/hub-nav.tsx =====

import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

// Shared hub nav strip (spec 18). One consistent item set per role
// surface — the PM pages all show the same four destinations, /sa shows
// two — with the current page rendered as a non-link span. Tab
// semantics: no directional arrows; min-h-11 tap targets for gloved
// site hands. NOT used by /requests (its back-bar is spec-12 locked
// behavior), the reports page (project-detail back-nav), or detail
// screens.

export interface HubNavItem {
label: string;
href: string;
}

// The canonical item sets — every consuming page passes one of these so
// the destinations and their order never drift between pages again.
// Spec 19 §4 merged /pm/requests into /requests: one purchasing entry.
export const PM_HUB_NAV: ReadonlyArray<HubNavItem> = [
// Spec 82 Unit 4: the review queue is the content-named /review (was /pm).
{ label: "รายการรอตรวจ", href: "/review" },
// Spec 82 Unit 3: the project hub folded to the content-named /projects.
{ label: "โครงการและรายงาน", href: "/projects" },
{ label: "คำขอซื้อ", href: "/requests" },
// Spec 69: PM-only DC payroll (money) — every PM surface is already
// PM/super-gated, so listing it here leaks nothing to SA. Spec 82 Unit 4: /payroll.
{ label: "ค่าจ้าง", href: "/payroll" },
// Spec 81: contacts management (clients / suppliers / contractors). Unit 4: /contacts.
{ label: "รายชื่อติดต่อ", href: "/contacts" },
];

export const SA_HUB_NAV: ReadonlyArray<HubNavItem> = [
// Spec 82 Unit 3: the SA project hub folded to the shared /projects hub.
{ label: "โครงการ", href: "/projects" },
{ label: "คำขอซื้อ", href: "/requests" },
];

interface HubNavProps {
maxWidthClass: typeof PAGE_MAX_W;
items: ReadonlyArray<HubNavItem>;
currentHref: string;
}

export function HubNav({ maxWidthClass, items, currentHref }: HubNavProps) {
return (
// Desktop-only (spec 19 §2): phones navigate via the bottom tab bar.
// Spec 20: light strip; the current page carries a blue underline —
// an identifiable "you are here", not just a brighter gray.
<nav className="hidden border-b border-zinc-200 bg-zinc-100 px-5 py-1 sm:block">
<div className={`mx-auto flex ${maxWidthClass} flex-wrap items-center gap-x-6 text-sm`}>
{items.map((item) =>
item.href === currentHref ? (
<span
              key={item.href}
              className="inline-flex min-h-11 items-center border-b-2 border-blue-700 font-semibold text-zinc-900"
            >
{item.label}
</span>
) : (
<Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center border-b-2 border-transparent text-zinc-600 transition-colors hover:text-zinc-900 focus:outline-none focus-visible:underline"
            >
{item.label}
</Link>
),
)}
</div>
</nav>
);
}

===== FILE: src/components/features/detail-header.tsx =====

// DetailHeader (spec 63): THE sticky detail-header shell — back chip
// (spec 54/55), refresh (spec 53), sticky chrome (spec 62), optional
// action chips, title block as children. Every detail page renders
// this component, so a design change here reaches all of them by
// default (the operator's consolidation mandate). Server component;
// only RefreshButton inside is client.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { ICON_CHIP } from "@/lib/ui/classes";
import { RefreshButton } from "@/components/features/refresh-button";

interface DetailHeaderProps {
backHref: string;
backLabel: string;
/** Extra header chips (gear, reports, …) rendered left of refresh. \*/
actions?: React.ReactNode;
/** The title block: code line, h1, meta lines. \*/
children: React.ReactNode;
}

export function DetailHeader({ backHref, backLabel, actions, children }: DetailHeaderProps) {
return (
// Spec 62 z-stack: headers 20 < queue banner 30 < tab bar 40 < scrims 50.
<header className="sticky top-0 z-20 border-b border-zinc-200 bg-white px-5 py-4">
<div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
<div className="flex items-center justify-between gap-3">
<Link href={backHref} aria-label={backLabel} className={ICON_CHIP}>
<ArrowLeft aria-hidden className="h-5 w-5" />
</Link>
<div className="flex items-center gap-2">
{actions}
{/_ Spec 53: the PWA's only reload affordance. _/}
<RefreshButton variant="light" />
</div>
</div>
{children}
</div>
</header>
);
}

===== FILE: src/components/features/bottom-sheet.tsx =====

"use client";

// Spec 78 (app-feel slice 4) — BottomSheet: a thumb-reachable sheet that
// slides up from the bottom, the native pattern for an inline form. Same
// overlay language as ConfirmDialog / the lightbox (fixed inset-0 scrim, z-50,
// Escape + scrim-click close, content click stops propagation, role=dialog
// aria-modal). The caller owns the open state.
//
// The body is already LOCKED (spec 64: <body h-full overflow-hidden>), so the
// page behind the scrim can't scroll-leak on iOS. The panel is its own
// overscroll-contained scroller. Slide-up motion is CSS-only (.sheet-panel
// @keyframes in globals.css), gated by prefers-reduced-motion. Focus moves to
// the panel on open; a full tab-trap is a recorded seam (matches ConfirmDialog).

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface BottomSheetProps {
open: boolean;
title: string;
onClose: () => void;
children: React.ReactNode;
}

export function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
const panelRef = useRef<HTMLDivElement>(null);
const titleId = useId();

// Focus the panel on open only (callers pass inline onClose with a new
// identity each render — refocusing on every re-render would yank focus).
useEffect(() => {
if (open) panelRef.current?.focus();
}, [open]);

useEffect(() => {
if (!open) return;
function onKeyDown(e: KeyboardEvent) {
if (e.key === "Escape") onClose();
}
document.addEventListener("keydown", onKeyDown);
return () => document.removeEventListener("keydown", onKeyDown);
}, [open, onClose]);

if (!open) return null;

return (
<div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
    >
<div
ref={panelRef}
tabIndex={-1}
onClick={(e) => e.stopPropagation()}
className="sheet-panel flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none" >
{/_ Grab affordance + sticky header. _/}
<div className="flex flex-col items-center gap-2 border-b border-zinc-200 px-5 pt-2 pb-3">
<span aria-hidden className="h-1 w-9 rounded-full bg-zinc-300" />
<div className="flex w-full items-center justify-between gap-3">
<h2 id={titleId} className="text-base font-semibold text-zinc-900">
{title}
</h2>
<button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="-mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 active:translate-y-px"
            >
<X aria-hidden className="size-5" />
</button>
</div>
</div>
<div className="overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
</div>
</div>
);
}

===== FILE: src/components/features/status-pill.tsx =====

import { cn } from "@/lib/utils";

// The status pill every list row and header renders (spec 17). Palette
// classes come from the typed helpers in src/lib/status-colors.ts (or
// a label-specific map); this component owns the shared geometry.

interface StatusPillProps {
/\*_ Palette classes from status-colors.ts (border/bg/text trio). _/
pillClasses: string;
className?: string;
children: React.ReactNode;
}

export function StatusPill({ pillClasses, className, children }: StatusPillProps) {
return (
<span
className={cn(
"shrink-0 rounded-full border px-3 py-1 text-sm font-semibold",
pillClasses,
className,
)} >
{children}
</span>
);
}

---

# PART 5 — MANIFEST: remaining components (ask me to paste any)

src/components/ui/ (base primitives):

- src/components/ui/input.tsx
- src/components/ui/skeleton.tsx
- src/components/ui/textarea.tsx

src/components/features/ (app components NOT pasted above):

- src/components/features/attachment-remove-button.tsx
- src/components/features/attention-card.tsx
- src/components/features/avatar-surface.tsx
- src/components/features/confirm-action-button.tsx
- src/components/features/confirm-dialog.tsx
- src/components/features/contact-bank-block.tsx
- src/components/features/contact-crew-section.tsx
- src/components/features/contacts-tabs.tsx
- src/components/features/count-chip.tsx
- src/components/features/delivery-photo-uploader.tsx
- src/components/features/display-name-form.tsx
- src/components/features/invoice-uploader.tsx
- src/components/features/labor-cost-view.tsx
- src/components/features/labor-log-zone.tsx
- src/components/features/notes-field.tsx
- src/components/features/notices.tsx
- src/components/features/page-skeleton.tsx
- src/components/features/phase-progress-bar.tsx
- src/components/features/photo-lightbox.tsx
- src/components/features/photo-strip.tsx
- src/components/features/purchase-record-form.tsx
- src/components/features/purchase-request-attachment-stager.tsx
- src/components/features/purchase-request-cancel.tsx
- src/components/features/purchase-request-card.tsx
- src/components/features/purchase-request-decision.tsx
- src/components/features/purchase-request-form.tsx
- src/components/features/purchase-request-notes.tsx
- src/components/features/purchase-request-ship.tsx
- src/components/features/purchase-request-tracker.tsx
- src/components/features/radio-chip.tsx
- src/components/features/record-manager.tsx
- src/components/features/refreeze-button.tsx
- src/components/features/refresh-button.tsx
- src/components/features/site-purchase-acknowledge.tsx
- src/components/features/site-purchase-form.tsx
- src/components/features/sw-register.tsx
- src/components/features/toast-provider.tsx
- src/components/features/upload-queue-runner.tsx
- src/components/features/work-package-notes.tsx
- src/components/features/worker-roster-manager.tsx
- src/components/features/wp-assignment-panel.tsx
