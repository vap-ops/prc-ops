# Spec 220 — super_admin role administration (G63)

Implements **ADR 0050**. Today role assignment is out-of-band: ADR 0010 defaults
new signups to `visitor` and promotion is manual (raw SQL / Supabase console).
This is the onboarding bottleneck flagged as gap **G63**. Give `super_admin` an
in-app, audited, guard-railed way to change a user's role.

Binding constraints (do not re-decide — from ADR 0050 / 0019 / 0010):

- ADR 0019 REVOKEd `UPDATE` on `public.users` from `authenticated` — there is **no
  direct user-write path**. The role change MUST go through one gated SECURITY
  DEFINER RPC.
- Gate on the **authenticated** session (`current_user_role() = 'super_admin'`),
  never via the admin client (service-role has no `auth.uid()` → no actor stamp).
- Exactly one `audit_log` row per change (action `role_change`, old→new).

## U1 — `set_user_role` RPC (schema)

`public.set_user_role(p_user_id uuid, p_role public.user_role) returns void`,
`security definer`, `set search_path = public`. Revoke from `public, anon`; grant
`authenticated`.

Behaviour, in order (raise — never silently no-op):

1. **Gate:** `current_user_role()` must be `super_admin` (null-safe: a null/anon
   role is rejected). Else `42501`.
2. **Target exists:** `p_user_id` must be a real `public.users` row. Else `22023`.
3. **Self-demotion guard:** `p_user_id <> auth.uid()` — a super_admin cannot change
   their own role (avoids accidental self-lockout; a second super_admin must do it).
   Else `22023`.
4. **No-op short-circuit:** if the target already has `p_role`, return without an
   audit row (idempotent; not an error).
5. **Last-super_admin lockout guard:** if the target is currently `super_admin` and
   `p_role <> 'super_admin'`, refuse when they are the **last** `super_admin`
   (`count(*) where role = 'super_admin'` would drop to 0). Else `22023`.
6. `update public.users set role = p_role where id = p_user_id`.
7. Insert one `audit_log` row: `action 'role_change'`, `target_table 'users'`,
   `target_id p_user_id`, payload `{from, to}`.

`p_role` is enum-typed, so an invalid role value is rejected by Postgres before the
body runs (no string validation needed).

**pgTAP** (`supabase/tests/database/`): RPC exists; anon/`public` cannot execute,
`authenticated` can; super_admin promotes a visitor (role changes + one audit row);
non-super (e.g. project_manager, site_admin) → `42501`; null/anon session → `42501`;
self-demotion → `22023`; last-super_admin demotion → `22023` but a demotion that
leaves another super_admin succeeds; unknown target → `22023`; no-op call writes no
audit row.

## U2 — role-admin screen (UI)

A `super_admin`-only screen, reached from the `/settings` hub (where the other
super_admin tools live). `requireRole`/`requireActionRole` super_admin-only.

- **Route** `app/settings/roles/page.tsx` (Server Component) — lists every user
  (`full_name` or a "(ไม่มีชื่อ)" fallback, current role as a labelled badge via
  `USER_ROLE_LABEL`), ordered visitors-first then by name (promotion is the common
  task). Read via the super_admin session (RLS "super_admin full access" already
  permits the all-users SELECT) — no admin client.
- **Change role** via a per-user control (role `<select>` of `USER_ROLE_LABEL` +
  confirm) → a Server Action `setUserRole(userId, role)` that `requireActionRole`
  super_admin then calls the U1 RPC; re-`revalidatePath`. Surface the RPC's guard
  errors (last-super_admin / self / not-permitted) as friendly Thai messages. The
  current user's own row is shown but its control is disabled (matches the
  self-demotion guard). No bulk edits (ADR 0050 v1).
- **Hub link** on `/settings`, super_admin-only, alongside the existing
  super-only entries.

Out of scope (ADR 0050): inviting/creating users (signup stays LINE OAuth →
`visitor`), deleting users, per-permission ACLs.
