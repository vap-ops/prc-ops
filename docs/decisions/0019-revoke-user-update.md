# ADR 0019: Revoke UPDATE on public.users from authenticated/anon (Amends ADR 0007)

## Status

Accepted — 2026-06-07

Amends ADR 0007 (`public.users` is keyed to `auth.users`). ADR 0007 remains the foundational record for the `auth.users` → `public.users` linkage, the auto-create trigger, and the role-based access concept. This ADR removes the unused table-level UPDATE privilege from `authenticated` and `anon`, restoring privilege-layer defense alongside the existing RLS guard.

## Context

ADR 0017's live verification on 2026-06-07 found that the original "no user-write path to `public.users`" stance — phrased as if the privilege layer was part of the block — was true in **behaviour** but not in **mechanism**:

- `has_table_privilege('authenticated', 'public.users', 'UPDATE')` returned `TRUE` (Supabase grants table-level UPDATE on `public.*` to `authenticated` by default).
- `has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE')` returned `TRUE` for the same reason.
- A DB-level probe confirmed: `UPDATE public.users SET role='super_admin' WHERE id=auth.uid()` under `set local role authenticated` returned `ROW_COUNT=0` because **no permissive UPDATE policy exists on `public.users` for non-super_admins.**

The escalation block today is therefore **RLS alone.** If a future migration adds a permissive UPDATE policy without re-confirming the privilege posture (or a wildcard re-grant slips in), the table-level privilege is already present and immediately becomes exercisable. The chain that was supposed to be "no privilege AND no policy" was in fact "no policy." ADR 0017 (Open questions) explicitly flagged this as the "hardening follow-up"; `docs/policies/change-management.md` §5 lists it as one of the policy-gated remediations. This ADR resolves it.

## Decision

Revoke the unused table-level UPDATE privilege from `authenticated` and `anon`:

```sql
revoke update on public.users from authenticated, anon;
```

After this:

- `has_table_privilege('authenticated', 'public.users', 'UPDATE')` returns `FALSE`.
- `has_table_privilege('anon', 'public.users', 'UPDATE')` returns `FALSE`.
- `has_table_privilege('service_role', 'public.users', 'UPDATE')` continues to return `TRUE` — intentionally **not** revoked.

The block on user-reachable UPDATE is now **two layers deep:** the privilege layer rejects the statement before RLS is consulted; if a future migration adds a permissive UPDATE policy by mistake, the privilege layer still rejects the call.

### Why service_role keeps the privilege

The two legitimate writers to `public.users` either bypass RLS or run as the function owner; neither needs `authenticated` to hold the table privilege:

- **Auth callback (NULL-only writes via the admin client).** `src/lib/db/admin.ts` constructs a service-role client. `service_role` retains UPDATE on `public.users` because it is not in the revoke list, and the admin client bypasses RLS by design (ADR 0007 / the auth callback contract). No regression.
- **`public.update_my_display_name(text)` (ADR 0017).** SECURITY DEFINER, so the function body executes with the function owner's privileges (the migration runner — `postgres`), not the caller's role. The revoke on `authenticated` does not affect what the function body can do. Users hold EXECUTE on the function; the function itself can write.

### What this removes for session clients

The `super_admin full access on users` RLS policy (per ADR 0011) is unchanged as a policy, but its UPDATE branch now has **no privilege backing for session clients**. A future in-app role-admin UI that wants to perform `UPDATE public.users SET role=…` from a session client will need to either (a) route the write through the service-role admin client server-side, or (b) introduce a scoped column-level GRANT under a new ADR. This is intentional: changes to who can write `role` are too security-sensitive to rest on Supabase's default privilege grant. The role-admin UI is out of scope for this ADR.

Today the only role-promotion path is direct SQL by a super_admin (ADR 0010 §0.1), which runs as the migration runner / postgres role — unaffected by this revoke.

## Consequences

**Positive**

- Self-escalation `UPDATE public.users SET role='super_admin' WHERE id=auth.uid()` from an authenticated session is now denied at the **privilege layer** (SQLSTATE `42501`), not silently affecting 0 rows. The error surfaces rather than passing through to a no-op at the RLS layer.
- The phrasing of ADR 0007's "no user-write path" stance is now literally true at the privilege layer, not just behaviourally true via the absence of a permissive policy.
- One landmine removed for future migrations: adding a permissive UPDATE policy to `public.users` (by mistake or with too-broad scope) no longer escalates, because the table privilege is gone.

**Negative**

- A future in-app role-admin UI cannot use a plain session-client UPDATE; it must go through the service-role admin client or get a scoped re-grant via a future ADR. This is the correct cost: writes to `role` should not depend on the default Supabase grant.
- Pre-existing pgTAP test seeds that perform UPDATEs on `public.users` (e.g. `06`/`07`/`08`/`09`/`10`/`12`/`13`/`14`) all run as the default test connection role (the migration runner / postgres), not switched to `authenticated`. Verified by grep before writing this ADR — no existing test asserts that `authenticated` HAS the privilege, so no prior test needs updating.

**Neutral**

- Additive change at the privilege layer only. No schema, no policy, no application code, no data migration.
- ADR 0007's invariant phrasing benefits from this revocation alongside the correction carried by ADR 0017; ADR 0007 itself is not rewritten (annotation only).

## Future work (NOT in this ADR)

- **In-app role-admin UI.** When a UI for promoting visitors to real roles is built, decide between (a) routing the UPDATE through the service-role admin client server-side, or (b) introducing a scoped column-level GRANT for `role` under a new ADR.
- **`anon` privileges audit.** This ADR revokes from `anon` defensively. A separate audit of every public table's `anon` privileges would be a useful follow-up, out of scope here.

## Documentation handling

ADR 0007 is not edited except for a Status annotation pointing at ADR 0019 (same pattern ADRs 0009, 0010, and 0011 used).

## References

- ADR 0007 — Users and Auth (amended by this ADR)
- ADR 0009 — Supersede current-state query correction (same Status-annotation pattern when amending an accepted ADR)
- ADR 0010 — Visitor default role (same Status-annotation pattern)
- ADR 0011 — RLS role helper (same Status-annotation pattern; also the canonical SECURITY DEFINER checklist this ADR's regression test relies on)
- ADR 0017 — Profile self-edit (carries the corrected privilege-vs-policy analysis; flagged this revoke as the hardening follow-up)
- `docs/policies/change-management.md` §5 — lists this REVOKE as one of the policy-gated follow-ups
- `supabase/tests/database/15-users-update-revoked.test.sql` — pgTAP file proving the revoke's contract (catalog + regression + escalation)
