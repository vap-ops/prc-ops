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
- Before implementing any feature, read `/docs/decisions/` in full. Architecture decisions there override defaults.
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

1. **Spec.** Read the numbered spec at `/docs/feature-specs/NN-name.md` in full. If no spec exists, stop — ask for one. Implement exactly what the spec says.
2. **Progress tracker.** Update `/docs/progress-tracker.md`: mark the unit as in progress, note the start time.
3. **Test first.** Write the failing test. State "Writing failing test first."
4. **Implement.** Make the test pass. Nothing more.
5. **Verify.** Run the spec's verification checklist. Run `pnpm lint && pnpm typecheck && pnpm test`. All must pass.
6. **Update tracker.** Mark unit complete in `/docs/progress-tracker.md`. Note decisions made, open questions surfaced.
7. **Stop.** Do not start the next unit in the same session.

## Roles

The `users.role` enum contains all 8 PRC roles plus a `visitor` default state for new signups, even though v1 features only target `site_admin` and `project_manager`:

- `site_admin` (SA) — v1 ✅
- `project_manager` (PM) — v1 ✅
- `project_coordinator` (PC) — v2
- `procurement` — v2
- `technician` — v2 or v3
- `hr` — v3
- `subcon_manager` — v3
- `accounting` — v3
- `visitor` — v1 — default for new signups; awaits manual promotion to a real role (see ADR 0010)

Do not add or remove enum values without an ADR. After LINE login, users whose role is not `site_admin` or `project_manager` are redirected to `/coming-soon` — a single static page that acknowledges their account exists and tells them tools for their role are not yet live. v2 work removes the redirect for whichever role is being served.

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

Five v1 tables (see `docs/specs/v1-entities.md`): `projects`, `work_packages`, `photo_logs`, `users`, `audit_log`. Schema lives in `supabase/migrations/`.

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

`docs/decisions/` holds the ADRs — read them before implementing any feature; they override defaults. 0001 stack, 0002 WP data import, 0003 photos/watermarking, 0004 audit/immutability, 0005 v1 scope, 0006 database testing, 0007 users & auth.
