# Feature Spec 05: Profile Management (display-name self-edit)

> Originally drafted as feature spec 04; renumbered to 05 on
> 2026-06-07 after feature spec 04 ("Deliverable grouping in reports")
> landed on `main` via chore branch `chore/recover-migration-drift`
> (PR #45). 04 and ADR 0016 now permanently belong to deliverables.

## Status

Locked — 2026-06-07

Backed by **ADR 0017** (first user-write path to `public.users`;
chooses the SECURITY DEFINER RPC mechanism). Read ADR 0017 in full
before implementing — it carries the security derivation and overrides
the handoff's earlier mechanism recommendation.

## Goal

Let any authenticated user correct their own **display name**
(`public.users.full_name`). `full_name` is auto-populated from the
LINE `name` claim at first login (callback step 8); this unit makes it
user-correctable. Nothing else about the profile is editable in this
unit.

## Locked design decisions

Settled with the Project Owner before drafting. Not open for
re-litigation during implementation. If implementation pressure
suggests changing any of them, STOP and surface it (CLAUDE.md "When
blocked").

1. **Scope = `full_name` only.** `role`, `line_user_id`, `id`,
   `created_at`, `updated_at` are never user-writable. `avatar_url`
   is a separate v2 item and explicitly out of scope.
2. **Mechanism = SECURITY DEFINER RPC** `public.update_my_display_name`
   (ADR 0017, mechanism (c)). No new RLS UPDATE policy on
   `public.users`; no column UPDATE GRANT. Users hold EXECUTE on the
   function.
3. **Validation is DB-enforced in the function.** Trim; reject
   empty-after-trim; reject `> 80` chars. The TS validator mirrors
   these for UX only — the function is the authority (the RPC is
   directly callable by any authenticated session).
4. **Audit = yes.** Each successful change appends one `audit_log`
   row, `action = 'profile_update'` (new enum value), inside the same
   transaction as the UPDATE.
5. **UI surface = a panel on `/coming-soon`.** Serves `visitor`,
   `super_admin` (operator hub), and the not-yet-served roles. (See
   "Known gap" — does not reach live SA/PM.)
6. **Pessimistic save** — round-trip, then a "Saved" confirmation. No
   optimistic UI.

## Database

### Migration A — `<ts>_add_profile_update_audit_action.sql`

```sql
alter type public.audit_action add value if not exists 'profile_update';
```

Separate file (cannot add an enum value and use it in the same
transaction — ADR 0008 / 0010 precedent).

### Migration B — `<ts+1>_create_update_my_display_name.sql`

The function exactly as defined in ADR 0017 (SECURITY DEFINER,
`search_path = public`, one `text` param, hardcoded
`where id = auth.uid()`, single-column `set`, audit INSERT,
`revoke ... from public` + `grant execute ... to authenticated`).

After applying: `pnpm db:types` to regenerate `database.types.ts`
(adds the RPC signature and the new enum value).

## Application

### `src/lib/profile/validate-display-name.ts` (pure, unit-tested)

A pure function mirroring the DB rules for inline UX. No I/O.

```ts
export type ValidateResult = { ok: true; value: string } | { ok: false; error: string };

export function validateDisplayName(input: string): ValidateResult;
```

Rules: trim; if empty → `{ ok:false, error:"Display name can't be empty." }`;
if `> 80` chars → `{ ok:false, error:"Display name must be 80 characters or fewer." }`;
else `{ ok:true, value:<trimmed> }`.

### Server action (`src/app/coming-soon/actions.ts`)

`'use server'` action `updateDisplayName(formData)`:

1. `requireRole(...)` is not the gate here — this is reachable by every
   authenticated role. Get the session via the server client
   (`createClient()` → `auth.getUser()`); redirect to `/login` if none.
2. Run `validateDisplayName`. On failure, return the error to the form.
3. Call `supabase.rpc('update_my_display_name', { p_full_name: value })`
   on the **server (anon-key, RLS-context) client** — NOT the admin
   client. The RPC's SECURITY DEFINER does the privileged write; the
   caller's session supplies `auth.uid()`.
4. On RPC error, return a generic failure message (log the detail
   server-side). On success, `revalidatePath('/coming-soon')` and
   signal "Saved".

### `src/app/coming-soon/display-name-form.tsx` (client component)

`'use client'` — **justification:** it owns input state, inline
validation, pending state, and the post-save toast; a form with live
validation can't be a Server Component. Renders current name in a text
input (maxLength 80), a Save button (disabled while pending /
unchanged), inline error, and a transient "Saved" confirmation. Uses
`validateDisplayName` for pre-submit UX.

### Mounting

Render `<DisplayNameForm initialName={greeting-source} />` inside
`/coming-soon` for both the unserved-role branch and the
`super_admin` `OperatorHub`. Pass the user's current `full_name`
(already read on that page).

## TDD plan (tests first — state "Writing failing test first")

**Order:** the failing test is the first artifact in each sub-unit.

1. **pgTAP** `supabase/tests/database/14-update-my-display-name.test.sql`
   (run with `pnpm db:test`). Use the `request.jwt.claims` + `set local
role authenticated` pattern from `06-users-rls.test.sql`. Assertions:
   - function exists; is SECURITY DEFINER; `search_path` pinned.
   - EXECUTE granted to `authenticated`, revoked from `public`.
   - as authenticated user A → RPC sets A's `full_name` (trimmed).
   - empty / whitespace-only input raises.
   - `> 80` chars raises.
   - **`role` is unchanged after the call** (escalation guard).
   - calling as A does **not** affect user B's row.
   - an `audit_log` row is appended with `action = 'profile_update'`,
     `target_id = A`, payload `from`/`to`.
2. **Vitest unit** `tests/unit/validate-display-name.test.ts` — trims;
   rejects empty/whitespace; rejects 81 chars; accepts 80; accepts a
   normal name.
3. Implement migrations → function → helper → action → component to
   green.

## Verification checklist

- [ ] `pnpm lint` clean.
- [ ] `pnpm typecheck` clean (after `pnpm db:types`).
- [ ] `pnpm test` — new validator tests pass; 94 prior still pass.
- [ ] `pnpm db:test` — new pgTAP file passes; prior 254 still pass.
- [ ] Live: as a `visitor` (or self-promoted test user) on
      `/coming-soon`, edit the name, see "Saved", reload, name persists.
- [ ] Live: confirm an `audit_log` row was written for the change.
- [ ] Negative live check: from the browser console, attempt
      `supabase.rpc('update_my_display_name', { p_full_name: '<81 chars>' })`
      and confirm it errors (DB-level validation, not just UI).
- [ ] **Escalation probe (must FAIL):** as a non-super_admin session,
      attempt `update public.users set role='super_admin' where
    id=auth.uid()` — must be denied (no UPDATE privilege/policy).

## Known gap (open question — do NOT expand scope to fix without sign-off)

`/coming-soon` redirects `site_admin → /sa` and
`project_manager → /pm`, so the **two live pilot roles cannot reach
this panel.** Their names are set from LINE at first login, so this is
a correction gap, not a blocker. Closing it (mount the same component
on `/sa` and `/pm`, or add a shared `/profile` route) is a trivial
follow-up unit, flagged for the Project Owner. Per CLAUDE.md scope
discipline it is **not** built here.

## If blocked

Output: what you tried, what failed and why, what you'd do next, and a
confidence %. Then wait. Do not improvise a fallback mechanism — the
mechanism is locked by ADR 0017.
