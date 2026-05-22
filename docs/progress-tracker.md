# Progress tracker

Tracks feature units per the workflow in `CLAUDE.md`. One section per unit.

---

## Unit: Claude Code infrastructure — skill + hook + coming-soon

- **Status:** Partially complete — items 1–3 done, items 4–6 blocked.
- **Started:** 2026-05-19
- **Items 1–3 completed:** 2026-05-19
- **Spec:** Provided inline by the operator. No `docs/feature-specs/NN-name.md`
  file exists for this unit.

### Done

1. **Skill** — `.claude/skills/supersede-pattern/SKILL.md` created.
2. **Hook** — `.claude/hooks/protect-audit-log.js` created (executable) and
   registered as a `PreToolUse` (`Write|Edit`) hook in `.claude/settings.json`.

Verification: hook blocks edits to audit_log migration paths (exit 2) for both
POSIX and Windows path forms, allows them when `CLAUDE_ALLOW_AUDIT_LOG_EDIT` is
set (exit 0), allows non-audit migrations, and fails open on malformed input.
`pnpm lint && pnpm typecheck && pnpm test` all pass (15/15 tests).

### Blocked — not implemented

Items 4–6 (the `/coming-soon` page, the post-login redirect, and the Playwright
E2E test) were **not implemented**. They depend on prerequisite work that does
not exist in the repo and is outside this unit's spec:

- **`user_role` enum.** The deployed enum is
  `('site_admin', 'pm', 'super_admin')`
  (`supabase/migrations/20260505143544_create_users.sql`), not the 8-role enum
  CLAUDE.md describes. `project_manager` and `procurement` — required by the
  redirect check and the E2E test — are not valid values.
- **No LINE auth flow.** `src/app/` has no auth callback, middleware, or login
  route. `src/lib/env.ts` marks the LINE vars optional ("Becomes required when
  LINE Login ships"); `src/lib/db/server.ts` notes middleware "will refresh
  sessions when it ships." There is no post-login redirect logic to extend.
- **No E2E auth pattern.** `tests/e2e/` contains only an unauthenticated
  page-load test; there is no user-seeding or auth-mocking pattern to follow.

Operator decision (2026-05-19): implement items 1–3 now and stop; handle the
enum/auth prerequisites as separate units before items 4–6.

### Decisions made

- **Hook path normalisation.** The spec's regex
  `supabase/migrations/.*audit[_-]?log.*` uses forward slashes; the operating
  environment is Windows, where tool `file_path` values use backslashes. The
  hook normalises `\` to `/` before matching so the specified regex works on
  both platforms. The regex itself is unchanged.
- **`.claude/settings.json`.** The file was auto-created by the harness with a
  `permissions` block during this session; the hook entry was merged in, the
  `permissions` block left intact. `settings.local.json` was not touched.
- **ESLint.** ESLint scans `.claude/` and flagged `require()` in the hook
  (`@typescript-eslint/no-require-imports`). The hook must be CommonJS
  (`package.json` has no `type`), so a single
  `eslint-disable-next-line` was added on that line — the narrowest fix,
  confined to the spec'd file.

### Open questions

- **LINE auth flow.** Items 4–6 assume "LINE OAuth is already wired" — it is
  not. The auth callback / middleware must exist first.
- **`users.display_name`.** Item 4's coming-soon page reads `display_name`; the
  deployed `users` table has `full_name`. To reconcile when item 4 is unblocked.
- **ESLint scope (out of scope — not actioned).** ESLint currently lints
  `.claude/`. Adding `.claude/**` to `globalIgnores` in `eslint.config.mjs`
  would be the principled fix, but is outside this unit's spec. Surfaced here
  per CLAUDE.md scope discipline.

### Resolved

- **`user_role` enum expansion.** Resolved by ADR 0008 and the Role enum
  expansion unit (2026-05-20) — the enum now has 9 values. See the unit below.
- **Supersede direction inconsistency.** Fixed 2026-05-20. ADR 0009 added to
  amend ADR 0004's read pattern (anti-join, not IS NULL). SKILL.md rewritten.
  ADR 0004 Status annotated. CLAUDE.md Supersede bullet updated.

---

## Unit: Role enum expansion (ADR 0008)

- **Status:** Complete — 2026-05-20.
- **Spec:** Provided inline by the operator.
- **ADR:** `docs/decisions/0008-role-enum-expansion.md`.

### Done

- The `user_role` enum was expanded from 3 to 9 values, deployed to the remote
  DB on 2026-05-20: `site_admin`, `project_manager` (renamed from `pm`),
  `super_admin`, `project_coordinator`, `procurement`, `technician`, `hr`,
  `subcon_manager`, `accounting` — the 8 PRC roles in CLAUDE.md plus the
  operational `super_admin` (see ADR 0008).
- Migrations applied to the remote DB:
  `20260520143000_rename_pm_role_to_project_manager.sql` and
  `20260520143100_add_six_new_user_roles.sql`.
- `src/lib/db/database.types.ts` regenerated from the live schema.
- pgTAP test `01-users.test.sql` updated to assert the 9 values; plan count
  unchanged at 12. `pnpm db:test` (5 files, 29 assertions) and
  `pnpm lint && pnpm typecheck && pnpm test` all pass.

### Decisions made

- In `01-users.test.sql`, the SQL comment labelling the `enum_has_labels`
  assertion ("...the three expected values") was updated to "...nine" so it
  stays consistent with the assertion below it. No other lines changed.

### Still blocked

Serving the unserved roles still depends on prerequisites outside this unit:

- **LINE auth flow** — no auth callback / middleware / login route exists yet.
- **`/coming-soon` redirect** — not implemented; depends on the auth flow.

---

## Unit: Supersede current-state query correction (ADR 0009)

- **Status:** Complete — 2026-05-20.
- **Spec:** Provided inline by the operator.
- **Entry:** ADR 0009 — Supersede current-state query correction (2026-05-20).

### Done

- Created `docs/decisions/0009-supersede-query-correction.md` amending ADR
  0004's current-state read pattern from `WHERE superseded_by IS NULL` to an
  anti-join.
- Rewrote `.claude/skills/supersede-pattern/SKILL.md` to teach the anti-join
  pattern.
- Annotated ADR 0004's Status line to reference ADR 0009.
- Updated the CLAUDE.md Supersede pattern bullet.

---

## Unit: LINE auth — PR 1 of 4: schema prep (ADR 0010)

- **Status:** Complete — 2026-05-22.
- **Started / completed:** 2026-05-22.
- **Spec:** `docs/feature-specs/01-line-auth.md` (PR 1 of 4 section).
- **ADR:** `docs/decisions/0010-visitor-default-role.md` — amends ADR 0007.
- **Phase 0 (LINE Developers + Supabase Custom OIDC Provider setup):**
  completed and verified by the operator before this PR. OAuth bounce to LINE
  confirmed working.

### Done

- Added `visitor` as the 10th value of `public.user_role`. Final enum order:
  `site_admin, project_manager, super_admin, project_coordinator, procurement,
technician, hr, subcon_manager, accounting, visitor`.
- Changed the `public.users.role` column default from `'site_admin'` to
  `'visitor'`. The `handle_new_user()` trigger function was not touched —
  it inserts only `id` and relies on the column default, so altering the
  column default was sufficient (spec branch B).
- Migrations applied to the remote DB:
  `20260522223813_add_visitor_role.sql` and
  `20260522223814_change_user_default_role.sql`. Split into two files
  because `ALTER TYPE ADD VALUE` cannot run in the same transaction as
  statements that use the new value (same pattern ADR 0008 established).
- `src/lib/db/database.types.ts` regenerated — now shows 10 enum values.
- pgTAP `01-users.test.sql` updated: `enum_has_labels` array extended to 10
  values, comment + descriptions updated to "ten", `col_default_is` now
  asserts `'visitor'`. Plan count unchanged at 12.
- `src/lib/env.ts`: removed the optional `LINE_CHANNEL_ID` and
  `LINE_CHANNEL_SECRET` fields and their "Becomes required when LINE Login
  ships" comment. LINE credentials live in Supabase's Custom OIDC Provider
  now, not in app env.
- `CLAUDE.md` Roles section: added `visitor` as a v1 default-state role
  beneath the 8 PRC roles; intro line rephrased to note "8 PRC roles plus
  a `visitor` default state for new signups". ADR 0007 Status annotated to
  reference ADR 0010.
- `pnpm db:test` (5 files, 29 assertions) and
  `pnpm lint && pnpm typecheck && pnpm test` (15/15) all pass.

### Decisions made

- **Default-role mechanism (spec branch A vs B).** The current `users.role`
  default is set by the column default on `public.users.role`
  (`20260505143544_create_users.sql:7`), not in the trigger function body
  (`handle_new_user()` inserts only `id`). The spec explicitly allowed
  altering the column default in that case; migration 2 is therefore
  `ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'visitor';` and
  the trigger function is untouched.
- **Phase 0 discovery — Supabase provider identifier is `custom:line`, not
  `line`.** The spec's PR 2 section currently calls
  `supabase.auth.signInWithOAuth({ provider: 'line', ... })`. PR 2 must
  use `'custom:line'` instead — Supabase prefixes custom-provider
  identifiers with `custom:`. This affects every `signInWithOAuth` call,
  the `/auth/callback` handler if it references the provider, and any
  test fixtures. Flag at the top of PR 2's branch.
- **Sibling pgTAP file fix.** `supabase/tests/database/02-users-trigger.test.sql`
  asserts that the auto-create trigger lands a row with role `site_admin`.
  That assertion is directly broken by the default change, so the
  expected value was updated to `'visitor'` to keep `pnpm db:test` green.
  The spec only named `01-users.test.sql`, but the spec's verification
  checklist requires `db:test` to pass — this is the minimum fix to
  satisfy that, and it's the same class of change as the spec's
  "Update any other assertion affected by the default change" line.

### Open questions

- **`CLAUDE.md` architecture section stale line.** Line ~150 in
  `CLAUDE.md` says "A trigger on `auth.users` insert auto-creates a
  `public.users` row (role defaults to `site_admin`). See ADR 0007." The
  default is now `visitor`, so the parenthetical is stale. Not updated in
  this PR (strict scope: spec named only the Roles section). One-word fix
  worth picking up in PR 2 or a tiny chore PR.
- **`.env.example` and the LINE channel secret (resolved at commit time,
  rotation question open).** During this session, `git diff .env.example`
  showed local-only edits placing real-looking LINE values into the
  tracked template (`LINE_CHANNEL_ID=2009971313` and
  `LINE_CHANNEL_SECRET=c3f9c353bd79d591483934770d4db569`). The operator
  reverted the file mid-session, so the tree at commit time matches
  `origin/main` — empty placeholders. **Open question for the operator:**
  if those values were ever committed/pushed/shared anywhere (the file
  was open in the IDE; secret may have been visible in screenshots,
  Claude chat transcripts, or git stashes), rotate the LINE channel
  secret in the LINE Developers console and re-paste into Supabase's
  Custom OIDC Provider. After this PR these env vars are no longer
  referenced by any application code (removed from `env.ts`), so the
  only remaining concern is leak, not runtime.
- **`tests/unit/env.test.ts` vestigial assertion.** The test
  `does NOT throw when LINE_CHANNEL_ID and LINE_CHANNEL_SECRET are absent`
  still passes (Zod ignores undeclared env vars) but no longer
  corresponds to anything in the schema. Worth deleting in a tiny
  follow-up; not removed here to stay strictly within spec.
- **Admin UI for promoting visitors.** Manual SQL promotion is fine for
  the v1 pilot; will not scale past it. Tracked in ADR 0010's open
  questions. Future unit.
