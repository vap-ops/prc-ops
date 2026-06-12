# Spec 58 — project settings page for back office

**Status:** complete (2026-06-13) — operator tap-through on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator 2026-06-13: "Add Project setting page for back
office people." ADR 0042 records the write-path decision.

## Scope

### DB (migration `20260621000100_create_update_project_settings.sql`)

- `public.update_project_settings(p_project_id uuid, p_name text,
p_status public.project_status) returns boolean` — SECURITY DEFINER,
  `search_path = public`, role check `project_manager`/`super_admin`
  (42501 otherwise), name trimmed + non-blank + ≤200 chars (22023),
  updates `name` + `status` only, returns `found` (false = unknown id).
  Revoke from public/anon, grant execute to authenticated.
- pgTAP file 32: function/definer/search_path/grant pins; role sims
  (PM ok + outcome, SA 42501, visitor 42501, blank name 22023, unknown
  id false); `code` untouched.

### App

- New pure module `src/lib/projects/validate-settings.ts`:
  `PROJECT_NAME_MAX = 200`, `validateProjectName(raw)` (trim → ok/error
  Thai), `isValidProjectStatus(v)` guard over the 4 enum values.
- `/sa/projects/[projectId]/settings`:
  - `requireRole(["project_manager", "super_admin"])` — SA never lands
    here (redirects home).
  - Spec-54 header: back chip → project page, refresh; code (read-only,
    mono) over the page title ตั้งค่าโครงการ.
  - Form (client component, justification: submit pending + inline
    error/success): name input (maxLength 200), status select with
    `PROJECT_STATUS_LABEL`, save button. Code displayed, not editable
    (ADR 0042 §3).
  - Server action `updateProjectSettings` — uuid check, auth, explicit
    pm/super check (clean Thai error), validator, `supabase.rpc(...)`
    under the USER session (RLS/RPC are the load-bearing layer),
    `data === false` → ไม่พบโครงการ; revalidates `/sa`, the project
    page, and the settings page.
- Entry: gear chip (lucide Settings, 44px, chip style) in the project
  page's back-chip row, rendered only when `ctx.role` is pm/super.
- `database.types.ts` hand-extended with the RPC signature; reconcile
  with `pnpm db:types` post-push (prettier first — the spec-48 lesson).

## Recorded decisions / seams

- procurement: no projects SELECT + no UI reach (ADR 0042 §2) — the
  procurement-onboarding unit widens read posture and joins this gate.
- Project CREATION stays out of the app (super_admin console/import) —
  this page edits, it does not create.
- No audit rows (ADR 0042 §5).

## Tests (failing first)

- `tests/unit/project-settings-validate.test.ts` — name trim/blank/cap
  boundary (200/201), Thai error strings non-empty; status guard over
  all enum values + junk.
- pgTAP file 32 (above) — runs after `db:push`.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. `supabase db push --dry-run` shows exactly the one migration; push;
   `pnpm db:types` reconciles; `pnpm db:test` green.
3. Operator: gear visible on a project as PM/super, invisible as SA;
   rename + status change land and show on /sa and the project page.
