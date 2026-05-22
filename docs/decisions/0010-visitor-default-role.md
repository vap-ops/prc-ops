# ADR 0010: Visitor Default Role (Amends ADR 0007)

## Status

Accepted — 2026-05-21

Amends ADR 0007 (public.users is keyed to auth.users). ADR 0007 remains the foundational record for the `auth.users` → `public.users` linkage and the auto-create trigger. This ADR changes the default role assigned to a freshly auto-created `public.users` row.

## Context

Feature Spec 01 (LINE Login Authentication) locks in an **open signup** model: anyone with a LINE account can complete the OAuth flow and end up with a row in `public.users`. The trigger in ADR 0007 auto-creates that row, defaulting `role` to `'site_admin'`.

Under open signup, that default is unsafe: every new sign-in — including from anyone outside the company who happens to find the login URL — would be granted site-admin access. The `/coming-soon` redirect for unserved roles assumes a user has a role they cannot use yet; it does not protect against a user being granted a privileged role by default.

A new `visitor` role represents the "authenticated but not yet authorized" state. A `visitor` has no feature access; the only destination they can reach is `/coming-soon`. Promotion from `visitor` to a real role is a manual `UPDATE` performed by a `super_admin`. This matches the operator's stated promotion model and the small-pilot scale of v1.

## Decision

1. **Add `'visitor'` to `public.user_role`** as the 10th enum value. New value is appended (PostgreSQL enum addition order); the resulting order is `site_admin, project_manager, super_admin, project_coordinator, procurement, technician, hr, subcon_manager, accounting, visitor`.

2. **Change the column default on `public.users.role` from `'site_admin'` to `'visitor'`.** The default is enforced as a column default — the `handle_new_user()` trigger function inserts only `id` and relies on the column default to populate `role`. Therefore changing the column default is sufficient; the trigger function does not need to be touched.

### Migration shape

Two migrations are required because `ALTER TYPE ADD VALUE` cannot run in the same transaction as statements that use the new value:

- `<ts>_add_visitor_role.sql` — `ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'visitor';`
- `<ts+1s>_change_user_default_role.sql` — `ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'visitor';`

This follows the same two-file split established by ADR 0008's role enum expansion.

### Scope limits

The default change applies only to newly inserted rows. Existing rows in `public.users` keep whatever role they currently have. No backfill or data migration is performed.

No RLS policies are added or changed in this ADR. No application code is changed beyond removing the now-unused `LINE_CHANNEL_ID` / `LINE_CHANNEL_SECRET` placeholders from `src/lib/env.ts` (Supabase's Custom OIDC Provider holds the LINE credentials, not the app env).

## Consequences

**Positive**

- New signups land in a safe-by-default state. No new LINE account can accidentally gain site-admin (or any feature-bearing) access without explicit promotion.
- The `visitor` → `/coming-soon` path mirrors the existing handling of unserved roles, so no new route logic is required to absorb visitors.
- Existing users are unaffected; this is purely a forward-looking change.

**Negative**

- Manual SQL promotion (`UPDATE public.users SET role = … WHERE id = …`) does not scale beyond the two-project v1 pilot. An admin UI for promotion is required before signup volume grows — tracked as a future unit, not part of this ADR.
- Adds a tenth enum value that has no semantic meaning to any PRC role catalogue. Future readers must understand that `visitor` is an "in-between" state distinct from the eight PRC job roles in `CLAUDE.md`.

**Neutral**

- `super_admin` continues to be the role that performs promotion. The existing "super_admin full access on users" RLS policy in `20260505143544_create_users.sql` is sufficient — no policy change is needed for super_admins to update `visitor` rows.
- The auto-create trigger function `handle_new_user()` is unchanged. The default behaviour is moved by the column-default change alone.

## Documentation handling

ADR 0007 is not edited except for a Status annotation pointing at ADR 0010 (same pattern ADR 0009 used when amending ADR 0004).

`CLAUDE.md`'s Roles list adds `visitor` as a v1 role-state, and the architecture section line stating the default role is updated for consistency.

`docs/feature-specs/01-line-auth.md` is the operative spec for the larger LINE auth unit and references this ADR in the PR 1 section.

## Open questions

None blocking. Future work that this ADR makes visible:

- **Admin UI for visitor promotion.** When the second pilot expands, manual SQL promotion stops being viable. Future unit will build a super-admin-gated `/admin` route that lists `visitor` rows and lets a super-admin assign roles.
- **Notification on first sign-in.** No notification is sent to super-admins when a new visitor signs up. For the v1 pilot scale this is acceptable; for a wider rollout an email or LINE-bot notification will likely be needed so promotions don't lag.

## References

- ADR 0007 — Users and Auth (foundational user model; amended by this ADR)
- ADR 0008 — Role enum expansion (set the precedent for two-file enum migrations)
- `docs/feature-specs/01-line-auth.md` — operative LINE auth spec; PR 1 implements this ADR
- `supabase/migrations/20260505143544_create_users.sql` — the existing `handle_new_user()` trigger and column default this ADR amends
