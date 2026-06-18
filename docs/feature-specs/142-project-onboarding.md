# Spec 142 — Project onboarding

Today a project can only be born at the DB/service-role layer (a migration or the
console). There is **no in-app way to create a project** — `/projects` lists and
edits existing rows, nothing more. This spec gives projects a front door.

## Doctrine

- **WP-centric** (memory: wp-centric-principle). A project is a shell; its value
  is the work packages hanging off it. Onboarding must not trap a project behind
  a long blocking wizard — create a usable shell fast, then enrich.
- **Model: stub + checklist** (operator-approved, 2026-06-18). Phase A creates a
  minimal stub (identity only); Phase B is a dismissible, derived checklist on the
  project page that guides enrichment, deep-linking to surfaces that already exist
  (settings form spec 79/72, member UI spec 80, WP add U4).
- **Field-First** design system (spec 91) for all new UI.

## Unit map

| Unit   | Scope                                                                                                             | Status    |
| ------ | ----------------------------------------------------------------------------------------------------------------- | --------- |
| **U1** | DB foundation: `create_project` RPC (PM+super) · auto-add creator as `project_members` · `suggest_project_code()` | THIS UNIT |
| U2     | "New project" stub modal on `/projects` → `create_project` → redirect to detail                                   | later     |
| U3     | Onboarding checklist on the project detail page (derived state, deep-links, dismiss)                              | later     |
| U4     | In-app "add work package" form + `create_work_package` RPC (baseline WP seeding)                                  | later     |
| U5     | WP template by `project_type` (`wp_templates` + `apply_wp_template`)                                              | later     |
| U6     | Copy work packages from an existing project (`clone_work_packages`)                                               | later     |
| U7     | CSV import surfaced in the UI (reuse `src/lib/wp-import/parse.ts`)                                                | later     |

A separate spec (**143**) covers the operator's access change — project managers
see only projects they're involved with; `project_coordinator` sees all. That is
a security-sensitive RLS change touching every project-scoped child table and
needs its own ADR (amending ADR 0013). U1's auto-add-creator-as-member is the
forward-compatible hook that keeps the onboarding PM's visibility intact under 143.

---

## U1 — DB foundation

### Decisions

- **Code generation: auto, editable** (operator-approved). `suggest_project_code()`
  returns the next `PRC-YYYY-NNN` for the current year; the UI shows it as an
  editable default. The final value is whatever the caller passes to
  `create_project` — the suggestion is advisory, the unique constraint is the
  guard.
- **Write path is the RPC, not a widened INSERT policy.** `create_project` is
  `SECURITY DEFINER` and gates on role internally (`project_manager`, `super_admin`).
  The `projects` INSERT policy stays super_admin-only — exactly mirroring how
  `update_project_settings` (spec 79) lets PMs write while the UPDATE policy stays
  super-only. No RLS policy change in U1.
- **Auto-add creator as member.** The PM who onboards a project is on its team:
  `create_project` inserts one `project_members` row `(new_project, auth.uid(),
auth.uid())`. Members are display/accountability metadata today (ADR 0032) and
  the access hook for spec 143.
- **Stub captures identity only.** `code`, `name`, optional `project_type`,
  optional `client_id`. Budget/dates/lead/team/WPs are all Phase-B (checklist),
  not part of create. Budget especially stays out — it is money-isolated (spec 79).
- **No new ADR for U1.** Behaviour is consistent with ADR 0013 (RPCs role-checked,
  policies stay tight) and ADR 0032 (members = metadata).

### `create_project(p_code, p_name, p_project_type, p_client_id) returns uuid`

`SECURITY DEFINER`, `set search_path = public`. Signature:

```
create_project(
  p_code         text,
  p_name         text,
  p_project_type public.project_type default null,
  p_client_id    uuid default null
) returns uuid
```

Behaviour:

1. Role gate: caller role in (`project_manager`, `super_admin`) else raise `42501`.
2. Trim `code`/`name`. Reject empty or over-long code (`> 50`) / name (`> 200`)
   with `22023`.
3. If `p_client_id` is non-null and not a real `clients` row → `22023`
   (mirrors `set_project_client`).
4. Insert `projects(code, name, project_type, client_id)`. `status` defaults to
   `active`. A duplicate `code` raises the constraint's `23505` — surfaced to the
   caller so the UI can re-suggest (U2). No internal retry.
5. Insert `project_members(project_id, user_id, added_by) = (new id, auth.uid(),
auth.uid())`.
6. Return the new project id.

Grants: `revoke all from public, anon`; `grant execute to authenticated`.

### `suggest_project_code() returns text`

`SECURITY DEFINER`, `stable`, `set search_path = public`. Reads across all projects
(definer bypasses RLS — a PM who under spec 143 can't see every project still gets
a correct next number). Role gate: (`project_manager`, `super_admin`) else `42501`.

Logic: `v_year := to_char(current_date, 'YYYY')`; take the max trailing integer
among codes matching `^PRC-<year>-\d+$`, default 0; return
`PRC-<year>-<lpad(max+1, 3, '0')>`.

Grants: `revoke all from public, anon`; `grant execute to authenticated`.

### Test plan (pgTAP `67-project-onboarding.test.sql`)

Catalog: both functions exist; both are `SECURITY DEFINER`. Behaviour (role-sim per
file 07): PM create returns non-null id; creator is auto-added as a member;
super_admin create works; site_admin and visitor create are denied `42501`; empty
name → `22023`; unknown client → `22023`; duplicate code → `23505`. `suggest`:
matches `^PRC-YYYY-\d{3}$`; visitor call denied `42501`; after the suggested code is
taken, the next suggestion differs and its number is exactly +1 (collision-proof
property test — no exact-value assertion against live data).

### Verification checklist

- [ ] `pnpm db:push` applies cleanly.
- [ ] `pnpm db:types` regenerates `database.types.ts` (RPCs appear in `Functions`).
- [ ] `pnpm db:test` — file 67 green, whole suite green.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.

### Open questions

- Code length cap (50) is a new bound the column never had — chosen to reject
  obvious garbage without constraining real `PRC-YYYY-NNN` codes. Revisit if the
  operator uses longer external job numbers.
- Whether `create_project` should also accept `contract_reference` at create
  (immutable thereafter). Deferred — kept out of the stub; set later via a future
  immutable-write path if needed.
