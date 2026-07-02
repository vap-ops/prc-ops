# Spec 235 — account deactivation / offboarding (active ≠ role)

**Status: DRAFT — design for operator review (not yet greenlit to build).**

## Why

When a person leaves the company there is **no offboarding flow**. Operators
reach for the only lever that exists — `set_user_role` → `visitor` (spec 220 /
ADR 0050). That is the wrong tool and produces the "their photos disappeared"
report:

- `visitor` is the **pre-onboarding** state for brand-new LINE signups awaiting
  promotion (ADR 0010). A departed staffer is the opposite of a new hire.
- `current_user_role() = 'visitor'` → `can_see_project()` returns **false for
  every project** (ADR 0056, `20260728000000_project_visibility_scope.sql`), and
  `roleHome('visitor')` routes to `/coming-soon`. The person is fully locked out;
  from their phone "all my photos are gone."
- The departed user now sorts to the **top** of the role-admin "รอกำหนดสิทธิ์"
  (awaiting-promotion) list (`app/settings/roles/page.tsx`), masquerading as a
  new hire to onboard.
- It **destroys the role**, which is load-bearing for attribution ("ถ่ายโดย
  <ชื่อ>") and the audit/GL trail. Their original job is forgotten.
- No record of **why / when / by whom** the person was offboarded.

**No data is ever lost in any departure** — `photo_logs` (and `dc_entries`,
`approvals`, `audit_log`) are append-only and triple-enforced; every FK to
`public.users(id)` is `NO ACTION` (RESTRICT), so contributions can never be
orphaned and the account cannot even be hard-deleted. The defect is purely that
**the access model has no "departed" state**, forcing misuse of `visitor`.

### Decision — decouple _account status_ from _role_

`role` answers "what can this person do + who were they" → **never destroyed on
exit.** A new nullable `deactivated_at` answers "are they still with us." The
three departure scenarios become three distinct, correct actions:

| Scenario             | Action                     | Mechanism                                    |
| -------------------- | -------------------------- | -------------------------------------------- |
| Left the **company** | **deactivate** (this spec) | set `deactivated_at`, keep role              |
| Left a **project**   | remove from team           | existing `removeProjectMember` (spec 80/192) |
| **Changed** role     | re-assign role             | existing `set_user_role` (spec 220)          |

Reversible: re-activation clears `deactivated_at` and the person is exactly who
they were. Hard delete stays unsupported by design (FK posture is correct).

## Binding constraints (do not re-decide)

- ADR 0019 REVOKEd `UPDATE` on `public.users` from `authenticated` — there is **no
  direct user-write path**. The status change MUST go through one gated SECURITY
  DEFINER RPC (mirror `set_user_role`).
- Gate on the **authenticated** session (`current_user_role() = 'super_admin'`),
  never the admin client (service-role has no `auth.uid()` → no actor stamp).
- Exactly **one `audit_log` row** per status change.
- This changes **ACCESS, not data.** No DELETEs, no FK changes, no cascade
  changes. Append-only posture untouched.
- Reuse the existing super_admin role-admin surface (`/settings/roles`) — do not
  build a parallel screen.

> **Prerequisite (operator decision, separate artifact):** this introduces an
> account-lifecycle concept that amends ADR 0010 (visitor lifecycle) and rides
> on ADR 0056 (visibility). Author a short companion ADR before U1 ships. The
> design below is the proposed content.

## U1 — schema: account-status columns + audit actions

Additive migration on `public.users`:

- `deactivated_at  timestamptz null` — the single load-bearing flag. `null` =
  active. Non-null = offboarded (the timestamp doubles as "when").
- `deactivated_reason text null` — optional free note for ops ("ลาออก", "หมด
  สัญญา"). Display-only; not parsed.

Actor and history come from `audit_log`, not extra columns. Add two values to
`public.audit_action` (`account_deactivated`, `account_reactivated`) — its
**own** migration, committed/ordered **before** the U2 RPC migration that
references them (enum-add-then-use lesson, `prc-ops-db-migration-lessons`).
Alternative if the operator prefers zero enum churn: reuse `action = 'other'`
with a `payload->>'event'` discriminator (the established `wp_reopened_for_defect`
pattern). **Pick one in review.** Spec assumes the enum values below.

No RLS/grant change (the `users` "super_admin full access" + "read self"
policies already cover reading the new columns; writes go through the RPC).

## U2 — `set_user_active` RPC (schema)

`public.set_user_active(p_user_id uuid, p_active boolean, p_reason text default null)
returns void`, `security definer`, `set search_path = public`. Revoke from
`public, anon`; grant `authenticated`.

Behaviour, in order (raise — never silently no-op):

1. **Gate:** `current_user_role()` must be `super_admin` (null-safe: null/anon
   rejected). Else `42501`.
2. **Target exists:** `p_user_id` must be a real `public.users` row. Else `22023`.
3. **Self guard:** `p_user_id <> auth.uid()` — a super_admin cannot deactivate
   **their own** account (avoids self-lockout; a second super_admin must do it).
   Else `22023`.
4. **No-op short-circuit:** if the target is already in the requested state
   (`p_active = (deactivated_at is null)`), return without an audit row
   (idempotent; not an error).
5. **Last-active-super_admin guard:** when `p_active = false` and the target is
   `role = 'super_admin'`, refuse if they are the **last super_admin with
   `deactivated_at is null`** (the firm must always have one reachable owner).
   Else `22023`. (Parallels spec 220's last-super_admin lockout, but counts
   _active_ supers.)
6. Apply: deactivate → `deactivated_at = now()`, `deactivated_reason = p_reason`;
   reactivate → `deactivated_at = null`, `deactivated_reason = null`.
   `updated_at = now()`.
7. Insert one `audit_log` row: `action` = `account_deactivated` /
   `account_reactivated`, `target_table 'users'`, `target_id p_user_id`, payload
   `{ reason }` (reason null on reactivate).

**pgTAP** (`supabase/tests/database/`): RPC exists; anon/`public` cannot execute,
`authenticated` can; super_admin deactivates a user (`deactivated_at` set + one
audit row) and reactivates (cleared + one audit row); non-super (project_manager,
site_admin) → `42501`; null/anon → `42501`; self-deactivation → `22023`;
last-active-super_admin deactivation → `22023` but deactivating one super while
another active super remains succeeds; unknown target → `22023`; no-op (deactivate
an already-deactivated user) writes no audit row; **role is unchanged** by both
calls (assert `role` before == after).

## U3 — access gate: inactive users are blocked at the door

A deactivated user keeps a valid LINE session, so the gate is **server-side and
load-bearing**, not UI.

- `requireRole` / `requireActionRole` (`src/lib/auth/`): after resolving the
  user, if `deactivated_at is not null` → redirect to a new
  **`/account-inactive`** page. This is checked **before** the role match, so it
  catches every role (including a still-`site_admin` deactivated user).
- `roleHome` / `resolveHome`: a deactivated user resolves to `/account-inactive`,
  **not** `/coming-soon` (which says "tools coming later" — wrong message).
- **`/account-inactive`** — a calm static page: "บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้
  ดูแลระบบหากเข้าใช้งานผิดพลาด." No app chrome, no data. (Mirrors the spec-233
  `/client/access-ended` lapsed-notice pattern.)
- Server Actions: `getActionUser` / action gates reject deactivated users with
  the existing not-permitted path (defense in depth — a deactivated user must not
  mutate even if they craft a request).

**vitest:** `requireRole` redirects a deactivated user to `/account-inactive`
regardless of role; an active user is unaffected; `roleHome`/`resolveHome` send a
deactivated user to `/account-inactive`; an action gate rejects a deactivated
caller.

## U4 — role-admin screen: deactivate / reactivate + de-pollute onboarding

On the existing `/settings/roles` (`app/settings/roles/page.tsx`,
super_admin-only):

- **Three groups, in order:** (1) "รอกำหนดสิทธิ์" = `visitor` **and**
  `deactivated_at is null` only — onboarding list, **no longer polluted** by
  departed staff; (2) active staff by name; (3) a distinct
  **"ปิดใช้งานแล้ว / Inactive"** section at the bottom.
- Each row keeps its **retained role badge**. Inactive rows add an "ปิดใช้งาน"
  status chip + the reason (if any) + the deactivation date.
- Per-user **deactivate** control (confirm dialog, optional reason field) →
  Server Action `setUserActive(userId, false, reason?)`; **reactivate** control
  on inactive rows → `setUserActive(userId, true)`. Both `requireActionRole`
  super_admin then call the U2 RPC; `revalidatePath('/settings/roles')`. Surface
  the RPC guards (self / last-active-super / not-permitted) as friendly Thai.
- The current user's own deactivate control is disabled (matches the self guard).
- The role `<select>` (spec 220) stays available on active rows — role and status
  are independent controls. (On inactive rows it may stay enabled; changing a
  departed person's role is harmless and rare — keep it simple, no extra gating.)

**vitest:** `RoleAdminList` renders the three groups; a deactivated user is **not**
in the onboarding count/list; deactivate/reactivate controls call the action with
the right args; self-row deactivate disabled; guard errors surface as Thai.

## Out of scope

- Hard account deletion — stays unsupported by design (FK RESTRICT posture is
  correct; never force it — `break-glass.md`).
- Bulk deactivate, scheduled/auto deactivation, self-service offboarding.
- Departure data export / handover packet (possible later spec).
- Re-pointing `project_lead_id` or auto-removing project memberships on
  deactivation — the access gate already blocks the person; membership cleanup
  stays a separate manual action (spec 80/192). (Open question below.)
- The companion ADR (separate artifact, see prerequisite).

## Open questions

1. **Audit action: enum-add vs `payload.event`** (U1) — operator pick.
2. **Memberships on deactivate** — leave `project_members` rows intact (cheap,
   reversible, gate already blocks access) vs. strip them. Spec assumes _leave_.
3. **Reports/notifications to a deactivated user** — the notification drain
   already tolerates missing/locked users; confirm no digest is sent to an
   inactive account (likely a one-line filter, flag if so).
