# Spec 152 — `project_director` role (see-all `project_manager`)

Operator (2026-06-19): add a **project director** role "similar to super_admin".
Scope decision (operator): **executive-director tier** — sees ALL projects and
has PM + back-office (procurement) write powers across every project, but NOT
operator/system-only surfaces (user/role management, OperatorHub, notification
internals). No Thai label requested — `USER_ROLE_LABEL` uses `"Project Director"`.

Model (ADR 0058): **`project_director` = `project_manager` everywhere, except
visibility is see-all** (like `super_admin` / `project_coordinator`) instead of
membership-scoped. The build is therefore "add `project_director` next to
`project_manager` in every gate" + "add it to the see-all branch of
`can_see_project`". Where `super_admin` stands **alone** (operator-only), leave it.

## Unit map

| Unit   | Scope                                                                                                                                                                              | Status    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **U1** | Identity + visibility + navigation: enum value; `can_see_project` see-all branch += `project_director`; `USER_ROLE_LABEL`; `roleHome`→`/review`; all PM-tier TS role arrays + page allowlists + manager checks + `PM_TABS`. pgTAP + vitest. | THIS UNIT |
| U2     | RPC action gates: add `project_director` to every SECURITY DEFINER RPC `current_user_role() in (…)` allowlist that contains `project_manager`. pgTAP.                              | todo      |
| U3     | Table write RLS policies: DROP/CREATE every write policy that contains `project_manager`, adding `project_director` (membership gate auto-satisfied via `can_see_*`). pgTAP.       | todo      |

## U1 — Identity, visibility & navigation

### DB

1. **Enum** (own migration `20260750000000_add_project_director_role.sql`):
   `alter type public.user_role add value if not exists 'project_director';`
2. **Visibility** (migration `20260750000100_project_director_see_all.sql`):
   `create or replace function public.can_see_project` with the see-all branch
   widened to `in ('super_admin', 'project_coordinator', 'project_director')`.
   `can_see_wp` / `can_see_photo_log` are unchanged — they delegate, so the
   director inherits see-all on every child table. Re-assert grants/comment.

### TypeScript (after `pnpm db:push` + `pnpm db:types`)

- `labels.ts` — add `project_director: "Project Director"` to `USER_ROLE_LABEL`
  (the `Record<user_role,…>` typecheck forces this; it is the safety net).
- `role-home.ts` — add `project_director` to `PM_ROLES`, `SITE_STAFF_ROLES`,
  `BACK_OFFICE_ROLES`, `PURCHASING_ROLES`, `EQUIPMENT_MOVE_ROLES`,
  `PROJECT_VIEW_ROLES`, `ACCOUNTING_ROLES`; `roleHome` → `/review`.
- `purchasing/back-office.ts` (local `BACK_OFFICE_ROLES`),
  `labor/validate.ts` (`BACKOFFICE_BACKDATE_ROLES`) — add `project_director`.
- `bottom-tab-bar.tsx` — `project_director` → `PM_TABS`.
- Page allowlists / inline manager checks (add `project_director` beside
  `project_manager`): `settings/page.tsx`, `review/work-packages/[id]/page.tsx`,
  `requests/[id]/page.tsx`, `requests/page.tsx`, `projects/page.tsx`,
  `projects/[id]/page.tsx`, `projects/[id]/work-packages/[id]/page.tsx`,
  `projects/[id]/settings/page.tsx`, `projects/[id]/reports/page.tsx`,
  `coming-soon/page.tsx` (the `project_manager → /review` redirect).

### Explicitly OUT (operator-only — ADR 0058 §3)

`coming-soon` `super_admin` OperatorHub branch; `api/notifications/drain`
recipient query; `notifications/resolve-recipients`; any `= 'super_admin'`
single-role check; user/role management (ADR 0050).

### Tests

- pgTAP `89-project-director-role.test.sql`: a `project_director` with **no**
  `project_members` row sees a project + its WP + photo_log (see-all);
  `can_see_project` / `can_see_wp` / `can_see_photo_log` all true; a
  membership-scoped `project_manager` on the same (unrelated) project sees
  nothing — proving the director's see-all is the differentiator.
- vitest `role-home.test.ts` (extend or add): `roleHome("project_director")` ===
  `/review`; `PM_ROLES`/`PROJECT_VIEW_ROLES` include `project_director`.

### Verification checklist

- [ ] `pnpm db:push` applies (enum + `can_see_project` replace).
- [ ] `pnpm db:types` regenerates `database.types.ts` with `project_director`.
- [ ] `pnpm db:test` — file 89 green, whole suite green.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.

## Open questions

- **Role-group helper / drift.** This sweep adds `project_director` to ~dozens of
  literal gates. The repeated inline `role === "project_manager" || role ===
  "super_admin"` pattern would be better as `PM_ROLES.includes(role)` (one SSOT).
  Left as-is per scope discipline; recorded here as the consolidation follow-up.
- **Notifications.** Director is deliberately excluded from the PM
  notification-recipient query (ADR 0058 §3). If the operator wants directors to
  receive review notifications, that is a separate, explicit change.
- **Accounting.** `project_director` is admitted to `ACCOUNTING_ROLES` (the
  read-only `/accounting` surface) because `project_manager` already is. It is
  NOT given accounting **write** powers beyond what a PM has.
