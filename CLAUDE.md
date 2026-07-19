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
- Before any append-only bypass (surgically correcting an `audit_log` / `photo_logs` / `approvals` row) or any destructive/irreversible migration (DROP, destructive ALTER, mass DELETE, TRUNCATE), read `/docs/break-glass.md` — binding. These are operator-only emergency procedures (guarded trigger-disable transaction + mandatory `audit_log` row; verified `pg_dump` floor + preview-branch rehearsal); never improvise them.
- Commit messages follow Conventional Commits (feat:, fix:, test:, docs:, refactor:, chore:).

## Unit gates (binding)

Every unit passes these gates in order — each with evidence (real command output), none skippable. The step-by-step commands live in the `ship-unit` skill.

1. **Lane claim.** Read the WHOLE `../LANES.md` + `git status` before starting; claim your lane (branch named) before touching shared surfaces. Migration writes are hook-blocked without a claim.
2. **Dependency gate-check.** Before building ON anything (RPC, table, component, route, spec assumption), read its LIVE form — DB objects from the live database, code at your branch's HEAD — and confirm the contract. Mismatch → stop and re-plan.
3. **RED first.** The failing test exists and was seen to fail before any production code.
4. **Real-flow verify.** Tests green is not "works" — exercise the changed artifact for real before claiming done. UI/route units: drive the actual user flow in a browser (dev-preview login), zero console errors. Units with no browser surface (hooks, scripts, worker, schema-only, docs): execute the changed artifact end-to-end and show its real output (e.g. run the hook against crafted stdin, run the script's new path).
5. **Fresh-eyes review.** A reviewer subagent reads the full diff; findings addressed or answered.
6. **Prove the merge.** `scripts/ship-pr.sh` refuses a branch that conflicts with origin/main — never assert "merges clean" without it.

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

Then wait. Do not proceed without explicit acknowledgement. (Under the standing autonomy grant: first exhaust self-service diagnosis — read the live DB/app state, reproduce, search the repo and memory; flag 🔔 via Telegram only when the block is genuinely operator-gated.)

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
5. **Verify.** Run the spec's verification checklist. Run `pnpm lint && pnpm typecheck && pnpm test`. All must pass. Then satisfy Unit gate 4 (real-flow verification) — for UI units that means the browser, not just tests.
6. **Update tracker.** Mark unit complete in `/docs/progress-tracker.md`. Note decisions made, open questions surfaced.
7. **Stop or continue per the standing grant.** The default is stop after one unit. Under the operator's standing autonomy grant (memory `autonomy-grant-backlog-execution`), sessions continue unit-to-unit unattended and stop only at the grant's gates (genuine judgment, external blocker, destructive migration).

The gate-by-gate procedure for this loop — lane claim, dependency gate-check, RED-first, real-browser verification, fresh-reviewer pass, gated ship — is the `ship-unit` skill (`.claude/skills/ship-unit/`); load it for every unit.

## Roles

Do NOT trust any hardcoded role list — the enum grows. The SSOTs are:

- **Enum values:** the live `user_role` Postgres enum (verify: `select unnest(enum_range(null::public.user_role))` via `pnpm exec supabase db query --linked`).
- **Routing + role sets:** `src/lib/auth/role-home.ts` — `roleHome()` maps each role to its home; the exported role-set constants (PM_ROLES, LEGAL_ROLES, …) are the only place membership is defined. Roles without a built surface route to `/coming-soon`.
- **Labels:** `USER_ROLE_LABEL` in `src/lib/i18n/labels.ts`.

Do not add or remove enum values without an ADR. New-signup default is `visitor` (ADR 0010). Adding an enum value trips exhaustiveness guards on purpose (roleHome fixture, ROLE_GROUP_ORDER, pgTAP enum pins) — update them deliberately, never by weakening the guard.

## Operating environment

- The operator is non-developer, working from cloud PC and mobile.
- **Ship through the gate, not a direct push (autonomous-build fence, 2026-06-26):** `main` is branch-protected; every change lands as a PR via `scripts/ship-pr.sh` (pushes a branch → opens a PR → requests auto-merge). Required CI (lint+typecheck+test+secret-scan; pgTAP + `next build` join once the branch-protection flip lands — ADR 0081) must be green to merge, and the **danger-path guard** fails — and so HOLDS — any PR touching a protected surface (migrations, `src/lib/auth/**`, RLS, money/GL/payroll, the service-role client, notifications, `worker/`, infra, or the governance files). So a clean code-only PR with green CI **auto-merges itself**; a dangerous or red PR **waits for the operator** (one-tap merge / admin override). `main` auto-deploys (Vercel). Token + mechanics: memory `autonomous-build-fence`.
- **Still operator-held (the ~20%):** destructive/irreversible migrations (DROP, column-type, mass DELETE/TRUNCATE — `break-glass.md` Procedure B), worker/Railway redeploys, and other danger-path changes. The danger-path guard still red-flags **every** migration PR (additive included), so none GitHub-auto-merges. What ADR 0081 unblocks is the **standing-grant self-merge** of _additive_ migrations: pgTAP now runs in CI, and once it is a required check (operator adds `SUPABASE_ACCESS_TOKEN` + the branch-protection flip lands) the green substantive checks finally prove the schema invariants — so the agent may admin-merge its own additive-migration PR under the standing grant (memory `autonomous-build-fence`), while destructive ones stay operator-merged. This makes the earlier "additive auto-push" grant (2026-06-25) safe to honor **mechanically** rather than on prose; `docs/policies/change-management.md` §1 reconciled.
- Never auto-authenticate `gh`.
- After merge: delete merged branches.

## Parallel sessions

Multiple sessions may run against this repo, but two in the SAME working dir clobber each other (shared `.git` HEAD/index — observed live). Full protocol: memory `safe-parallel-sessions`.

- **Worktree per session.** Each session works in its own git worktree (`../prc-ops-<lane>`, a sibling of the repo), NEVER two sessions in `D:\claude\projects\prc-ops\prc-ops`. If the main dir is already in use, create your own: `git worktree add ../prc-ops-<lane> -b <branch> origin/main`.
- **Schema is single-lane.** Only ONE session at a time may touch `supabase/migrations/`, run `db:push`, or `db:test` (one shared remote DB). Never start a second schema lane.
- **Parallelize only disjoint, code-only work.** A second lane is allowed only if ALL hold: no schema; pure `src/`/`docs/`/test; no file overlap with another lane; different domain; touches no shared SSOT (`src/lib/i18n/labels.ts`, `src/lib/auth/action-gate.ts`, `role-home.ts`, role-set constants, enums, `package.json`, this file). Otherwise serialize. Unsure → serialize; one session is never wrong.
- **Coordination is a whiteboard, not a lock.** `D:\claude\projects\prc-ops\LANES.md` (outside the repo) lists active lanes + the schema-sync STATUS line. Read it WHOLE on start, append your lane, re-read to confirm. On merge, MOVE your lane block to `LANES.archive.md` (append there, delete here) and refresh the STATUS line — LANES.md stays live-only because every session reads it at start; history belongs in the archive. Safety comes from the worktrees + these rules, not from the file.
- **Memory is single-writer**, appended at session end — never two sessions editing a memory file at once.
- Merge a lane: in its worktree run `pnpm lint && pnpm typecheck && pnpm test`, push, ff-merge `main`, then `git worktree remove ../prc-ops-<lane>` + delete the branch + clear your `LANES.md` lines.

## Skills, agents, and hooks

- Skills at `.claude/skills/` provide procedural knowledge. Currently installed: `ship-unit` (the gated unit loop — load for EVERY unit); `supersede-pattern`; `bug-fix-flow` (the autonomous bug-fix pipeline — discover→triage→fix→ship→reply→complete, driven by CC, flagging the operator only at genuine decision points; runs scheduled daily + on demand); `triage-feedback` (spec 201 — the queue/message/status mechanics `bug-fix-flow` builds on: CC investigates reports, sets status off `ใหม่`, and replies tiered — auto-publishes low-risk replies, stages a draft + flags the operator for anything that declines/commits/is uncertain). Load them when touching matching areas.
- Hooks at `.claude/hooks/` enforce constraints automatically. Currently installed: `protect-audit-log.js` (blocks edits to audit_log migrations unless `CLAUDE_ALLOW_AUDIT_LOG_EDIT=1` is set); `require-lane-claim.js` (blocks migration writes unless the current branch is claimed in `../LANES.md`; always blocks migrations on `main`). Do not attempt to bypass.
- Subagents at `.claude/agents/` package recurring specialized reviews. Currently installed: `spec-fact-checker` (refute-first fact-checker — verifies the factual claims in a spec, plan, or task-prompt against the live DB and the code at your worktree HEAD, returning a claim-by-claim verdict table; the doctrine §4 gate). Dispatch it BEFORE shipping any spec/plan and before building from a task-prompt or audit finding that names tables, columns, or files.

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

**CI** (`.github/workflows/ci.yml` — the workflow file is the SSOT) runs `lint` + `typecheck` + `test`, the secret scan, the worker check, `next build`, **pgTAP** (`db:test` against the shared remote DB — serialized on a concurrency group so runs never overlap; pre-existing reds pinned in `supabase/tests/known-red.json`; ADR 0081), and the **danger-path guard** (see Operating environment). It does **not** run `test:e2e` or the spike suite — run those locally when touching the relevant code. A husky pre-commit hook runs `lint-staged` (eslint + prettier on staged files).

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

`docs/decisions/` holds the ADRs — they override defaults. **The full, current list with one-line titles is `docs/decisions/README.md`** (do not trust any remembered count — the index is the SSOT). Scan that index and read the ones relevant to your change in full; don't rely on memory of the numbering.
