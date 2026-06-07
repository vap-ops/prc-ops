# ADR 0017: First user-write path to `public.users` — display-name self-edit via SECURITY DEFINER RPC

> Originally drafted as ADR 0016; renumbered to 0017 on 2026-06-07
> after ADR 0016 ("Deliverables domain table") landed on `main` via
> chore branch `chore/recover-migration-drift` (PR #45). 0016 and
> feature-spec 04 now permanently belong to deliverables.

## Status

Accepted — 2026-06-07

Amends ADR 0007 (`public.users` keyed to `auth.users`) and ADR 0012
(custom LINE auth flow). Those ADRs established the **"no user-write
path to `public.users`"** stance: every write goes through the
service-role admin client server-side (the auth callback, NULL-only).
This ADR introduces the **first deliberate user-initiated write** to
the table and defines exactly how narrow it is.

## Context

The profile-management unit lets an authenticated user edit their own
**display name** (`public.users.full_name`). `full_name` is
auto-populated from the LINE `name` claim at first login (callback
step 8, NULL-only). This unit makes it **correctable** by the user.

Today there is no user-write path to `public.users`:

- **Reads** — RLS `users read self` policy (`auth.uid() = id`)
  permits a user to SELECT their own row; the `super_admin full access`
  policy resolves via `current_user_role()` (ADR 0011).
- **Writes** — only the auth callback writes, via the admin
  (service-role) client, and only NULL-only (`line_user_id`,
  `full_name`). No authenticated session can UPDATE the table —
  **but the block is RLS, not the privilege layer.** Verified live
  on 2026-06-07:
  `has_table_privilege('authenticated','public.users','UPDATE')` is
  `TRUE` (Supabase grants `authenticated` table-level UPDATE on
  `public.*` by default), and `has_column_privilege(... ,'role', ...)`
  is `TRUE` for the same reason. The escalation guard is that **there
  is no permissive UPDATE RLS policy for non-super_admins**, so any
  UPDATE issued through an authenticated session affects **0 rows**
  silently. A DB-level escalation probe on 2026-06-07 confirmed
  `UPDATE public.users SET role='super_admin' WHERE id=auth.uid()`
  under `set local role authenticated` returns `ROW_COUNT=0` and the
  caller's `role` is unchanged.

Adding self-edit is therefore the first user-reachable write into the
**most security-sensitive table in the schema** — the table that
holds `role`. The hazard, confirmed against the live policy set:

> **Postgres RLS `WITH CHECK` validates the resulting row, not which
> columns changed.** A naive self-update policy —
> `USING (id = auth.uid()) WITH CHECK (id = auth.uid())` — admits
> `UPDATE public.users SET role = 'super_admin' WHERE id = auth.uid()`,
> because the resulting row still satisfies `id = auth.uid()`.
> **Privilege escalation ships.** Column restriction must come from
> somewhere other than the policy's `WITH CHECK` alone.

Three mechanisms were analysed (full write-up: `docs/v2-handoff.md`
§4). Summarised:

- **(a) Column-level `GRANT update (full_name)` + an RLS self-update
  policy.** Pure-RLS, DB-enforced. Safety rests on the column grant
  never broadening. Adds a user-reachable UPDATE policy to the table.
- **(b) Server action via the admin client, hardcoded to set only
  `full_name`.** Reuses the existing callback pattern; smallest
  _schema_ surface. But it places an **RLS-bypassing service-role
  write on a user-triggered path.**
- **(c) SECURITY DEFINER RPC** — users get EXECUTE on a function, not
  UPDATE on the table. Same hardening pattern as `current_user_role()`
  (ADR 0011).

## Decision

**Adopt mechanism (c): a SECURITY DEFINER RPC,
`public.update_my_display_name(p_full_name text)`.** Authenticated
users are granted EXECUTE on the function; no UPDATE privilege and no
UPDATE RLS policy is added to `public.users`. The function is the
**only** user-reachable writer, it can touch **only** `full_name`, and
**only** for the caller's own row.

### Function definition

```sql
create function public.update_my_display_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_trimmed text := btrim(p_full_name);
  v_old     text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_trimmed = '' then
    raise exception 'display name must not be empty' using errcode = '22023';
  end if;
  if char_length(v_trimmed) > 80 then
    raise exception 'display name must be 80 characters or fewer'
      using errcode = '22001';
  end if;

  select full_name into v_old from public.users where id = v_uid;

  update public.users set full_name = v_trimmed where id = v_uid;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_uid, public.current_user_role(), 'profile_update', 'users', v_uid,
     jsonb_build_object('field', 'full_name', 'from', v_old, 'to', v_trimmed));
end;
$$;

revoke execute on function public.update_my_display_name(text) from public;
grant  execute on function public.update_my_display_name(text) to authenticated;
```

### Column writability matrix

| Column         | User-writable?    | How                                      |
| -------------- | ----------------- | ---------------------------------------- |
| `full_name`    | **Yes** (own row) | `update_my_display_name()` RPC, this ADR |
| `role`         | No                | super_admin only (admin client / SQL)    |
| `line_user_id` | No                | auth callback, admin client, NULL-only   |
| `id`           | No                | trigger from `auth.users`                |
| `created_at`   | No                | column default                           |
| `updated_at`   | No                | `users_set_updated_at` trigger           |

### Validation (DB-enforced, not just UI)

`authenticated` holds EXECUTE, so the RPC is callable directly via
`supabase.rpc(...)` — **not only through our server action.** All
input rules therefore live **in the function body**, not solely in the
TypeScript layer:

- Trim leading/trailing whitespace (`btrim`).
- Reject empty-after-trim.
- Reject `char_length > 80`.

The TypeScript validator (`src/lib/profile/validate-display-name.ts`)
mirrors these rules for UX (inline error before the round-trip), but
the **function is the authority.**

### Audit posture

Every successful change appends one `audit_log` row with a new
`audit_action` value **`profile_update`**, `target_table = 'users'`,
`target_id = auth.uid()`, and a `payload` capturing `{field, from,
to}`. The append happens inside the same function (and therefore the
same transaction) as the UPDATE, so the name change and its audit row
commit or roll back together. `audit_log` remains append-only
(ADR 0004); the function only INSERTs.

### Migration shape

Two files, because `ALTER TYPE ... ADD VALUE` cannot run in the same
transaction as statements that use the new value (same split used by
ADR 0008 / ADR 0010):

1. `<ts>_add_profile_update_audit_action.sql` —
   `ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'profile_update';`
2. `<ts+1>_create_update_my_display_name.sql` — the function +
   grant/revoke above.

## Why (c), not (a) or (b)

The decisive axis is **failure mode under a future careless edit**,
because all three are airtight _today_:

- **(b) fails open.** It runs as service-role and bypasses RLS. A
  later edit that accepts an `id` parameter, or adds a column to the
  payload, escalates privileges with RLS off and no second line of
  defence. The blast radius of a one-line mistake is total.
- **(a) fails closed**, but its only column guard is the GRANT. A
  later `grant update on public.users to authenticated` (no column
  list) silently reopens `role` to self-update, and the existing
  `WITH CHECK (id = auth.uid())` admits it. The guard is one sloppy
  migration away from escalation, and nothing in the policy itself
  signals the danger.
- **(c) fails closed and is safe by construction.** The function
  takes one `text` parameter, hardcodes `where id = auth.uid()`, and
  names `full_name` as the only assignment target. There is **no
  parameter that selects a row and no parameter that names a column.**
  To escalate, someone must rewrite the function body — a change that
  lands in a reviewable migration and is governed by the ADR-0011
  SECURITY DEFINER checklist. Users hold EXECUTE on a function, never
  UPDATE on the table.

The privilege-vs-policy point above (see Context) is **precisely why
(c) is the correct mechanism here.** `authenticated` already holds the
table-level UPDATE privilege from Supabase's defaults; the only thing
keeping that privilege un-exercisable for escalation is the absence of
a permissive UPDATE RLS policy on `public.users`. Mechanism (a) would
add exactly such a policy (gated on `id = auth.uid()`) and then rely
on a column-level GRANT to keep `role` out of bounds — a defence the
pre-existing table-level privilege can paper over the moment a future
migration broadens it. Mechanism (c) adds **no permissive UPDATE
policy at all**, so the pre-existing table privilege never becomes
exercisable for any user-reachable UPDATE, regardless of whose column
grants drift. The escalation surface stays exactly as narrow as it
was before this ADR.

(c) also **reuses an existing, reviewed primitive shape**
(`current_user_role()`, ADR 0011) rather than introducing a new write
pattern. The handoff (`docs/v2-handoff.md` §4) recommended (b) for
"smallest deviation"; this ADR overrides that recommendation on the
fail-open/fail-closed grounds above. (b)'s "smallest deviation" is
true of _schema_ surface only; it is the _largest_ deviation in terms
of putting service-role writes on a user-triggered path.

## SECURITY DEFINER safety derivation (ADR 0011 checklist)

The same five conditions that make `current_user_role()` safe are
re-derived here; any future change to the function must re-derive them:

1. **One parameter, `p_full_name text`** — the only thing a caller
   controls. No parameter selects a row (`auth.uid()` is hardcoded) or
   names a column.
2. **Writes only the caller's own row, only `full_name`** — the
   hardcoded `where id = v_uid` and the single-column `set` make any
   other effect impossible. A caller can already read/observe their own
   `full_name`; the function reveals and changes nothing beyond it.
3. **`search_path` pinned to `public`** — blocks the
   `set search_path = evil, public` shadowing vector against
   `public.users` / `public.audit_log`.
4. **No unintended side effects** — the only writes are the scoped
   UPDATE and the audit INSERT. (Not STABLE — it mutates — which is
   correct for a write function.)
5. **EXECUTE revoked from `public`, granted to `authenticated`** —
   `anon` cannot call it (no `auth.uid()`); the explicit `v_uid is
null` guard fails closed even if the grant were ever widened.

## Scope

- **UI surface:** a self-contained edit panel mounted on
  `/coming-soon` (per Project Owner decision). This serves `visitor`,
  `super_admin` (operator hub), and the not-yet-served roles.
- **Out of scope:** `avatar_url` / LINE `profile` scope (separate v2
  item); any change to `role` or `line_user_id` writability; any
  in-app role-admin UI.

## Consequences

**Positive**

- The first user-write path is column-safe and id-safe by
  construction, fails closed, and reuses a reviewed pattern.
- Every display-name change is audited atomically with the change.
- No new RLS write policy and no column GRANT on the most sensitive
  table — the **"no user-reachable UPDATE path on `public.users`"**
  invariant still holds. (The phrasing here is deliberate: the
  underlying `authenticated` UPDATE privilege already exists from
  Supabase defaults — see Context — and is held un-exercisable by the
  absence of a permissive UPDATE policy. This ADR preserves that
  posture; users hold a function EXECUTE, not a UPDATE policy.)

**Negative**

- One more SECURITY DEFINER function to maintain and review under the
  ADR-0011 checklist.
- The RPC is callable directly by any authenticated session, so
  validation must live in the function (it does) — the TS validator is
  UX, not the security boundary.

**Neutral**

- New `audit_action` value `profile_update`. Additive enum change;
  existing rows unaffected. (`audit_action` is not under the
  ADR-gated-change rule that governs `user_role`; documenting it here
  regardless.)
- `/coming-soon` panel does not reach live `site_admin` /
  `project_manager` (they are redirected to `/sa` / `/pm`). See
  open question below.

## Open questions

- **SA/PM reachability.** As scoped, the two live pilot roles cannot
  reach the edit panel (they never land on `/coming-soon`). Their
  names come from LINE at first login, so this is a correction gap,
  not a blocker. A trivial follow-up — mount the same panel on `/sa`
  and `/pm`, or add a shared `/profile` route — would close it. Not
  built in this unit per scope discipline; flagged for Project Owner.
- **Hardening follow-up: revoke the unused UPDATE privilege.**
  `REVOKE UPDATE ON public.users FROM authenticated` (and the matching
  `... FROM anon`) would restore defense-in-depth — the table-level
  privilege Supabase grants by default is unused under this ADR, so
  revoking it costs nothing and adds a second line of defence ahead
  of the no-permissive-policy guard. Tracked separately, **not in this
  unit**: changing role grants is the kind of cross-cutting edit that
  warrants its own ADR (touches ADR 0007's invariant phrasing and any
  future table whose access model assumes the Supabase default).

## References

- ADR 0004 — Audit trail & immutability (`audit_log` append-only)
- ADR 0007 — Users & auth (amended)
- ADR 0011 — `current_user_role()` SECURITY DEFINER pattern (the
  primitive this RPC mirrors)
- ADR 0012 — Custom LINE auth flow (amended)
- `docs/v2-handoff.md` §4 — the three-mechanism analysis this ADR
  resolves
- `docs/feature-specs/05-profile-management.md` — the locked spec
