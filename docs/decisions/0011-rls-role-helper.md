# ADR 0011: RLS role-check helper to break self-referential policy recursion

## Status

Accepted — 2026-05-23

Amends ADR 0007 (`public.users` is keyed to `auth.users`). ADR 0007 remains the foundational record for the `auth.users` → `public.users` linkage, the auto-create trigger, and the role-based access concept. This ADR fixes a specific defect in the original `super_admin` RLS policy on `public.users` and establishes the canonical pattern for all future role-checking policies.

## Context

The original `super_admin full access on users` policy at `supabase/migrations/20260505143544_create_users.sql:21-34` writes its USING/WITH CHECK clauses as:

```sql
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'super_admin'
  )
)
```

This is self-referential. Evaluating the policy reads `public.users`, which triggers RLS, which evaluates the same policy, which reads `public.users` again — without bound. Postgres detects the cycle on the next row and raises:

```
infinite recursion detected in policy for relation "users"
```

The defect was discovered during the LINE-auth spike live test on 2026-05-23 (see [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md), "Real bug discovered: RLS infinite recursion on `public.users`"). The spike's result page tried to read `public.users` from an authenticated session and got this error; the Supabase session itself was valid (`supabase.auth.getUser()` succeeded and returned the right `auth_user_id`) — only the row read failed at the RLS layer.

The bug blocks the real LINE-auth implementation in the same way: the existing `src/app/auth/callback/route.ts` reads `users.role` to redirect by role, the existing `src/app/login/page.tsx` reads `users.role` to redirect already-authenticated visitors, and every future feature route that reads `public.users` will hit it too.

The `users read self` policy (`auth.uid() = id`) does not query the users table, so it does not recurse. Only the super_admin policy is defective.

## Decision

Introduce a SECURITY DEFINER helper function `public.current_user_role()` that reads the caller's role while bypassing RLS, and rewrite the super_admin policy to call the helper instead of self-joining `public.users`.

### Function definition

```sql
create function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

grant execute on function public.current_user_role() to authenticated;
```

### Policy rewrite

```sql
drop policy "super_admin full access on users" on public.users;

create policy "super_admin full access on users"
  on public.users for all
  using (public.current_user_role() = 'super_admin')
  with check (public.current_user_role() = 'super_admin');
```

### Why this is safe

SECURITY DEFINER functions run with the privileges of the function's owner (here, the migration runner — `postgres` on Supabase). Inside the function, RLS is bypassed. That is exactly what we need to break the recursion, and it is also the entire risk surface of this change. The function is safe because all five of the following hold:

1. **It takes no parameters.** A caller cannot ask "what is role X for user Y?"; they can only ask "what is _my_ role?".
2. **It returns only the caller's own role.** The hard-coded `where id = auth.uid()` makes that the only possible result. A caller can already read their own row via the existing `users read self` SELECT policy, so the function reveals nothing that wasn't already authorized.
3. **`search_path` is pinned to `public`.** Without this, a privileged caller could prepend a malicious schema to `search_path` (`set search_path = evil, public`) and shadow `public.users` with a spoofed table that returns `'super_admin'` for everyone. Pinning eliminates that vector — the canonical SECURITY DEFINER hardening step.
4. **It is STABLE.** No side effects. The planner can cache the result within a single statement.
5. **EXECUTE is granted only to `authenticated`.** `anon` cannot call it (anonymous sessions have no `auth.uid()` and no business reading roles); `service_role` doesn't need it (already bypasses RLS).

If any of those conditions is later relaxed — adding parameters, broadening grants, unpinning the search path, changing the body — the safety argument must be re-derived. Reviewers should treat changes to this function with the same care as RLS policy changes.

### Canonical pattern for future policies

All future RLS policies that need to gate on the caller's role MUST use `public.current_user_role()` instead of self-joining `public.users`. The same recursion failure recurs in any policy that re-reads its own table, regardless of which role is being checked. This helper is the role-check primitive policies should call.

When v2/v3 work adds policies on `projects`, `work_packages`, `photo_logs`, `dc_entries`, and so on, expressions like `using (public.current_user_role() in ('project_manager', 'site_admin'))` are the idiomatic form.

## Consequences

**Positive**

- The recursion is gone. `SELECT FROM public.users` works under an authenticated session, which unblocks both the real LINE-auth implementation and any future query path that reads the table.
- One canonical role-check primitive. Future policies write `using (public.current_user_role() = …)` and don't re-introduce the self-join trap.
- The existing `users read self` policy is untouched; the "users can read themselves" behavior is unchanged for everyone except super_admins (who now also resolve via the helper).

**Negative**

- SECURITY DEFINER is a privilege boundary. The function must be reviewed with the same care as RLS policies. The five safety conditions above are documented so reviewers have a checklist for any future change.
- The policy planner executes one helper call per row tested. Trivial cost (one indexed lookup, cached because the function is STABLE), but not free.

**Neutral**

- The existing `20260505143544_create_users.sql` migration is not edited (migrations are immutable history per CLAUDE.md). The fix ships as a forward migration that drops the recursive policy and recreates it on top of the helper.
- No schema change. No data migration. No application code change. Test coverage is added in `supabase/tests/database/06-users-rls.test.sql`, including a regression guard that runs the exact `SELECT` shape that previously raised the recursion error.

## Documentation handling

ADR 0007 is not edited except for a Status annotation pointing at ADR 0011 (same pattern ADRs 0009 and 0010 used).

[`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md) already documents the discovery and points forward to this ADR; no change needed there.

## Open questions

None blocking. Worth noting for future ADR process:

- **Helper variants.** When a policy needs to check whether the caller has _any_ of a set of roles, the idiom is `current_user_role() in (...)`. If a future need calls for it, a `current_user_has_role(roles user_role[])` helper could wrap the membership check. Not added preemptively.

## References

- ADR 0007 — Users and Auth (amended by this ADR)
- ADR 0009 — Supersede current-state query correction (same Status-annotation pattern when amending an accepted ADR)
- ADR 0010 — Visitor default role (same Status-annotation pattern)
- [`docs/feature-specs/01-line-auth-FINDINGS.md`](../feature-specs/01-line-auth-FINDINGS.md) — origin of the bug discovery (live spike test)
- `supabase/migrations/20260505143544_create_users.sql` — the original (now-superseded) self-referential policy
- PostgreSQL docs on Row Security Policies and SECURITY DEFINER functions (general background on the recursion and the hardening pattern used here)
