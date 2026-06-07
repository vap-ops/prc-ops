# ADR 0018: AppSheet back-office DB role (external principal, least-privilege)

## Status

DRAFT — 2026-06-07. Not accepted. Supersedes the parked migration
`20260606210130_add_appsheet_role` (reverted in `cfa4560`; original
content recoverable from git sha `30916ee`), which was broken (granted on
a nonexistent `public.tasks`) and insecure (placeholder password in git;
blanket `grant select on all tables` exposing `audit_log` and `users`).

## Context

AppSheet is to be a back-office surface for this org — most likely
read-only report/WP viewing plus work-package status updates. It connects
to the live Postgres as its own principal. This is the **first
non-Supabase-platform DB role** on the project, so it gets an ADR.

The parked migration showed exactly how this goes wrong: an over-broad
`grant select on all tables in schema public` would have handed an
external integration the entire `audit_log` (actor/target/payload trail)
and `public.users` (line_user_id, full_name, role) — a privacy and
security leak. This ADR locks the opposite posture: **start from zero,
grant only what AppSheet is demonstrated to need, never the sensitive
tables.**

## THE load-bearing open question (must be resolved before the grant matrix means anything)

**How does AppSheet authenticate to the database, and how does RLS apply
to it?** Two very different models:

- **(A) Direct Postgres connection as the `appsheet` role.** Then RLS +
  table grants apply to that role directly. Crucially, the existing RLS
  policies gate on `public.current_user_role()`, which reads
  `public.users` by `auth.uid()`. A direct DB connection has **no
  `auth.uid()`**, so `current_user_role()` returns NULL and every
  role-gated policy DENIES. AppSheet would therefore need _either_ its own
  RLS policies written for it, _or_ `BYPASSRLS` (dangerous — do not),
  _or_ access via dedicated views. Table grants alone are not enough.
- **(B) Via Supabase's REST/data API with a key.** Then it's an API key +
  RLS story, not a DB-role story, and much of this ADR changes shape.

**This ADR assumes model (A) (a dedicated DB role).** If AppSheet at this
org actually uses model (B), stop and re-scope — the grant matrix below
does not apply. Operator must confirm the connection model first.

## Decision (provisional, pending the open question + org confirmation)

Create role `appsheet` via migration with the narrowest grants that serve
its actual function, plus dedicated RLS policies (model A) so it sees only
its own rows. The password is **never** in git (see below).

### Grant matrix — least privilege (every row marked CONFIRM needs the operator to verify AppSheet's real usage)

| Table           | Read            | Write                    | Rationale / posture                                                                                                                                               |
| --------------- | --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`      | SELECT          | none                     | View context for reports. CONFIRM read-only.                                                                                                                      |
| `work_packages` | SELECT          | UPDATE (`status` only)   | Back-office status updates. Column-scoped UPDATE, not whole-row. CONFIRM columns.                                                                                 |
| `deliverables`  | SELECT          | none                     | Grouping context. CONFIRM.                                                                                                                                        |
| `approvals`     | **none**        | **none**                 | Append-only decision log; approval is an in-app PM action. Do NOT grant. If report views need approval status, expose via a view, not the table. CONFIRM no need. |
| `photo_logs`    | SELECT (if req) | **never** insert/upd/del | Append-only. Photos normally reached via the app/reports, not directly. Grant SELECT only if a concrete need exists. CONFIRM.                                     |
| `reports`       | SELECT (if req) | none                     | Report metadata listing. Files are private-bucket + signed URLs. CONFIRM.                                                                                         |
| `users`         | **NEVER**       | **NEVER**                | PII (line_user_id, full_name, role). If display names are needed, expose a minimal view with only the needed column.                                              |
| `audit_log`     | **NEVER**       | **NEVER**                | Full audit trail. No external principal reads this.                                                                                                               |
| `tasks`         | **n/a**         | **n/a**                  | Does not exist. See below.                                                                                                                                        |

**Default deny:** no `grant ... on all tables`. Every grant is explicit
and per-table (and per-column for writes). Anything cross-cutting is a
**view** (`security_invoker`/`security_barrier`) that exposes only the
needed columns — never a direct grant on `audit_log` or `users`.

### The `tasks` table

`tasks` does not exist in git or on the live DB. In the parked migration
it was granted **alongside** `work_packages`, so it was not a mis-name for
`work_packages` — it was a planned/aspirational table that was never
built. **Posture: drop `tasks` from the grant matrix entirely.** If a
`tasks` entity is genuinely needed, it gets its own ADR + create-table
migration first; this role grants on it only after that exists.

### Password handling (no secret in git)

The migration creates the role and grants **without** a usable login
password. The operator sets the password out-of-band, once, as a
**logged exception** under the change-management policy:

```sql
-- run by the operator in the SQL editor, NOT in a migration:
alter role appsheet with login password '<generated-secret>';
insert into public.audit_log (action, target_table, payload)
values ('other', null, jsonb_build_object('event','set appsheet role password','at', now()));
```

The secret lives wherever AppSheet's connection config is stored (the
integration's own secret store), tracked per the policy, and rotated on
suspicion. No placeholder, no real password, ever committed.

## Consequences

- **Positive:** an external principal that can touch only what it needs,
  never the audit trail or user PII; the role's creation and grants are in
  git and reviewable; the password is out of version control.
- **Negative / cost:** model (A) requires writing dedicated RLS policies
  (or views) for `appsheet`, since the existing `current_user_role()`
  policies don't apply to a non-auth connection. That's the bulk of the
  work and depends entirely on the connection-model answer above.
- **Neutral:** this ADR is numbered 0018 (after deliverables 0016 and
  profile 0017); the feature spec is `06-appsheet-role.md`.

## References

- Change-management policy (`docs/policies/change-management.md`) — gates
  role creation and password handling.
- ADR 0004 (audit_log immutability), ADR 0007 (`public.users`), ADR 0011
  (`current_user_role()` — why RLS won't apply to a non-auth connection).
- Parked migration original content: git sha `30916ee`.
- `docs/feature-specs/06-appsheet-role.md` — the unit spec.
