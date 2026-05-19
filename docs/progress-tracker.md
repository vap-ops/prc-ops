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

- **Supersede direction inconsistency.** This unit's spec for `SKILL.md`
  describes a logical edit as: INSERT a new row, then UPDATE the _old_ row's
  `superseded_by` to point at the _new_ row (so `WHERE superseded_by IS NULL`
  returns current state). ADR 0004 and CLAUDE.md instead describe "a new row
  with `superseded_by` pointing at the old one," and ADR 0004 states "the
  superseded row is never modified." These contradict. `SKILL.md` was written
  verbatim per this spec (frontmatter and body as given); the contradiction in
  ADR 0004 should be reconciled — likely an ADR amendment — before any code
  writes to `photo_logs`/`dc_entries`.
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
