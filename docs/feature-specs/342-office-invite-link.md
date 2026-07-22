# Spec 342 — invite-only office onboarding (ลิงก์เชิญพนักงานออฟฟิศ)

**Status:** approved in chat 2026-07-22 (operator, answering "how can superadmin
invite and onboard new office staffs?" → "we want to track who invited, but also
we want to prevent new user picking wrong role", then choosing the invite-only
door). Ships as U1 (mint) + U2 (door) + U3 (approver prefill). **NO schema.**

**Spec number:** 342, not 341 — 341 is consumed by an unpushed
`spec341-removal-trace` commit (`e12d0ef9`, 2026-07-22 15:40) living in the
`../prc-ops-337approval` worktree. It has no PR, so `git ls-tree origin/main`
does not see it.

## Problem

There is no invite path for office staff at all. The only **staff
self-registration** link builder, `technicianOnboardUrl`
(`src/lib/register/onboard-link.ts`), mints `/register/technician` URLs for the
per-project SA QR and the per-firm subcon poster. (Two other invite-URL builders
exist for different audiences — `buildClaimUrl` in `src/lib/portal/claim-url.ts`
and `buildClientClaimUrl` in `src/lib/client-portal/claim-url.ts` — neither
touches the staff-registration queue.) An office hire is onboarded by being told
a bare URL, or by finding `/register/office` themselves as the second entry on
`/coming-soon` (`VISITOR_REGISTER_ENTRIES`).

Two consequences, both measured against live data 2026-07-22 (18
`staff_registrations` rows, created 2026-07-08 → 07-15, 15 approved):

1. **Who recruited whom is recorded nowhere.** `invited_by` is `0/18` and
   `invited_project_id` is `0/18` (`invited_contractor_id` is `1/18` — one
   pending subcon row from 2026-07-12, the lone attribution value in the
   table). The field QR's share of that was a real bug — the logged-out LINE
   round-trip dropped the params until `registerLoginNext()` landed
   (2026-07-21, PR #677) — but the office door never had attribution to drop in
   the first place. Note the last registration predates that fix by six days:
   **no prod row has ever exercised `registerLoginNext`**, so the param-threading
   leg is unproven in the field, not merely unproven here.
2. **The applicant's declared position is prose, and usually absent.**
   `declared_role_hint` is a free-text box (`คาดว่าจะทำงานตำแหน่งใด (ไม่บังคับ)`,
   placeholder `เช่น ช่างเทคนิค, จัดซื้อ`) filled on `7/18` rows. The approver
   reads it and picks the real role by hand; the selector always defaults to
   `technician` regardless.

The operator's framing is narrower than "add attribution": a new office user
should not be in a position to declare the wrong thing at all.

## Decisions

**D1 — reusable per-inviter link, not tracked invitations.** One URL per
inviter, reused forever. Rejected: a `staff_invitations` table with one-time
tokens, expiry, revoke and a `รอสมัคร` list.

⚠️ **The build-cost argument for this is weaker than it first looks** and the
decision should rest on the other leg. Single-use token invites are **already
shipped three times** — `worker_invites`, `contractor_invites` and
`client_invites` all exist live, with mint RPCs, 14-day single-use tokens, and
copy-link block components (`worker-invite-block.tsx`,
`contractor-invite-block.tsx`, `client-invite-block.tsx`). A staff equivalent
would be a fourth copy of a known pattern, not greenfield work. What still
argues for the reusable link: at 18 registrations ever, there is no queue to
manage; office hiring is a trickle where the inviter and the hire are in direct
contact; and revocation protects against a threat (an unwanted _application_)
that the approval floors already absorb. If office hiring volume rises, or if a
"invited but never signed up" list is ever wanted, porting the existing pattern
is the obvious upgrade path — this decision is reversible by construction, since
`invited_by` is written the same way either way.

**D2 — the invited role is read-only to the applicant.** With a link, the form
renders `ตำแหน่งที่เชิญ: <role label>` as text. No input, nothing to get wrong.
The free-text box does not render for invited applicants. A typo in the link is
caught by the approver, who confirms the role regardless (D5).

**D3 — the organic office door closes.** `/register/office` without an invite is
no longer an entry point. `/coming-soon` drops the office door and gains a
non-clickable line naming who to ask. **A bare hit on `/register/office`
renders a gate screen, never a 404** — a hard 404 on a URL someone was told to
open becomes a support call. The gate screen offers the field door and the
"ask HR" line.

**D4 — the gate is UX, not security.** U2 checks that `?by` is uuid-_shaped_,
not that it resolves to a user who may invite. Verifying the inviter means
reading another user's row from a page a logged-out visitor hits — an admin
client read on a public route, i.e. the danger path — and buys little: anyone
past the gate becomes an _applicant_, and every floor (`id_card`, `book_bank`,
bank fields, PDPA — `registrationApprovalFloor`) plus the approver's confirm sits
downstream. A hard gate would be a DEFINER `is_staff_inviter(uuid)` and its own
unit. Not in this spec, deliberately.

**D5 — the URL never binds a role.** `?role` is applicant-tamperable, so it is
advisory at every hop: it prefills the approver's selector only when it maps to
a `STAFF_ONBOARDABLE_ROLES` member, exactly the trust rule `invitedProjectId`
already follows (`registration-decision.tsx` — honored only when it matches one
of the approver's RLS-scoped options, else falls back to empty). `p_role` is
still whatever the approver confirms.

A precision the repo's own comments get loose about: **`STAFF_ASSIGNABLE_ROLES`
is not a DB object.** `approve_staff_registration`'s live body carries a
hardcoded inline `p_role not in (…)` list of **13** roles raising `42501`;
nothing in `pg_proc` or elsewhere in the schema is named that. The guard is real
and server-side, but its list is a _superset_ of the 8-member TS
`STAFF_ONBOARDABLE_ROLES` (it also admits `project_manager`,
`project_director`, `site_owner`, `subcon_manager`, `auditor`) — so it is a
floor against assigning `super_admin`/`client`/`contractor`/`visitor`, **not** a
backstop against a UI that widened the onboardable set by mistake. The
onboardable narrowing is enforced in TypeScript only.

**D6 — zero schema; `declared_role_hint` carries the role.** Confirmed against
`src/lib/db/database.types.ts`: `staff_registrations` already has `invited_by`,
`invited_project_id`, `invited_contractor_id` and
`declared_role_hint text`. No new column. Storing the invited role there is
semantically honest rather than a shortcut: the role arrives through the
applicant's own URL, which they can edit, so its trust level is precisely what
that column already means — applicant-side, unverified, advisory. New rows hold
a role key (`procurement`); legacy rows hold prose; consumers treat "parses as a
`STAFF_ONBOARDABLE_ROLES` member" as prefill-able and anything else as today's
display-only text.

**D7 — no `?project` on the office link.** Office staff are not project-bound.
The approver can still assign a site at approval, unchanged.

**D8 — one mint surface, super_admin only.** `/settings/roles` is already the
super_admin user-admin screen. HR recruits office staff but cannot reach it;
widening the minting gate is a follow-up, not v1.

## U1 — mint the link (code-only)

1. `officeInviteUrl(base, { inviterId, role })` in
   `src/lib/register/onboard-link.ts`, beside `technicianOnboardUrl` and in the
   same style: pure, no DB, no env, `URL`/`searchParams` so a Thai label would
   encode correctly. Sets `by` (uuid) and `role` (the `UserRole` key).

   **The refusal is at RUNTIME, via the existing `isStaffOnboardableRole()`.** A
   compile-time refusal is not available: `role-home.ts:463` annotates the
   constant `ReadonlyArray<UserRole>`, which erases the literal types, so
   `(typeof STAFF_ONBOARDABLE_ROLES)[number]` is just `UserRole`. Re-typing it
   would mean editing `src/lib/auth/**`, which the CI danger-path deny-regex
   holds for operator review — that would cost U1 its code-only auto-merge for
   a type-level nicety. Do not re-type it, and do not duplicate the list as a
   literal union in `onboard-link.ts` (a second SSOT for a set the operator
   tunes).

2. **Lift the role grouping into a pure module first.**
   `registration-decision.tsx:65-68` declares `FIELD_ROLE_OPTIONS` and
   `OFFICE_ROLE_OPTIONS` as module-private consts inside a `"use client"`
   component — `/settings/roles` cannot import them as they stand. Move both to
   a pure `src/lib/register/office-roles.ts`, re-export into the decision sheet
   (behavior-preserving, its rendered optgroups must not change), then consume
   from both surfaces.
3. `/settings/roles` gains a `คัดลอกลิงก์เชิญ` control: a role picker over
   `OFFICE_ROLE_OPTIONS` + a copy button. The inviter id is the calling
   super_admin's own id, server-supplied.

## U2 — the door (code-only)

1. `src/lib/register/register-entry.ts` gains a pure
   `officeInviteParams(searchParams)` returning the uuid-validated `by` and the
   `STAFF_ONBOARDABLE_ROLES`-validated `role`, or `null` when the link is not a
   valid invite. `registerLoginNext("office", …)` already threads `by` through
   the LINE round-trip (it is one of the three uuid `bindings`); `role` joins
   the **bindings** group, not the `site`/`firm` label group — a role key is
   neither a uuid nor display text, and it must survive the label-dropping
   fallback that fires when a label contains an encoded slash. Validate it
   against `STAFF_ONBOARDABLE_ROLES` on the way in, exactly as `isValidUuid`
   guards the others (see Risks — this is the leg that silently ate every field
   QR's params for 13 days).
2. `/register/office` renders the gate screen when `officeInviteParams` returns
   `null`: `หน้านี้ต้องเปิดจากลิงก์เชิญ`, a link to the field door, and the
   "ติดต่อ HR/ผู้จัดการเพื่อขอลิงก์" line. Otherwise the existing workspace, with
   the role shown read-only per D2 and the free-text hint not rendered.
3. `VISITOR_REGISTER_ENTRIES` drops its office entry, leaving the field door
   alone; `visitor-landing.tsx` (the component `/coming-soon` renders that list
   through) gains the ask-for-a-link line in its place.
4. The submit action writes `invited_by` from `by` and `declared_role_hint` from
   `role`. **The role must be written on first submit, not held in the URL** —
   post-submit, `comingSoonDecision` returns the applicant to
   `REGISTER_WORKSPACE_PATH` (= the field path), so a resumed registration has
   no query string left to read.

## U3 — approver prefill (code-only)

`registration-decision.tsx` defaults its role selector to
`declaredRoleHint` when that value maps to a `STAFF_ONBOARDABLE_ROLES` member;
otherwise the existing `technician` default stands, unchanged, and the prose is
displayed exactly as today. One deliberate confirming tap either way.

## Testing

Unit (RED first, each mutation-checked):

- `officeInviteUrl` — param names and encoding; a non-onboardable role is
  refused at runtime (`isStaffOnboardableRole`), since the type system cannot
  refuse it (U1.1).
- `office-roles.ts` — the lifted `FIELD_ROLE_OPTIONS`/`OFFICE_ROLE_OPTIONS`
  still partition `STAFF_ONBOARDABLE_ROLES` exactly, and the decision sheet's
  rendered optgroups are unchanged by the move.
- `registerLoginNext("office", …)` — `by` + `role` survive the round trip;
  `safeNextPath` still passes; a garbage `role` drops to the bindings-only form.
- `officeInviteParams` — missing / malformed / non-onboardable inputs all → `null`.
- Gate screen renders when uninvited; the workspace renders when invited.
- Invited form shows the role label as text and renders **no** hint input
  (assert absence of the input, not just presence of the label).
- U3 mapping: role key → prefilled selector; legacy prose → `technician` default
  with the prose still displayed.

**Two existing tests go RED on U2.3 and must be rewritten deliberately, not
weakened** (they are the guard doing its job):

- `tests/unit/register-entry.test.ts:151-163` — asserts
  `VISITOR_REGISTER_ENTRIES` paths `toEqual(["/register/technician",
"/register/office"])` and that `[1].label` is `REGISTER_OFFICE_HEADING`.
  Becomes a single-door assertion plus an **absence** pin on the office path.
- `tests/unit/visitor-landing.test.tsx:12-19` — asserts a rendered link named
  `REGISTER_OFFICE_HEADING` with `href="/register/office"`. Becomes: no such
  link, and the ask-for-a-link line renders instead.

`tests/unit/nav-back-affordance.test.ts:271` already exempts
`register/office/page.tsx` from the DetailHeader rule, so the gate screen does
not trip that guard.

Copy assertions follow the house rule: pin the retired literal's **absence**
bare (not quote-wrapped), assert a constant appears ≥2 times rather than
`toContain` (an import line satisfies `toContain` on its own), and do not let a
code comment quoting a UI string stand in for the render pin.

Real-flow (unit gate 4): drive the invite from `/settings/roles`, then open the
link **as a logged-out principal**, which is where a new office hire always
starts. Confirm `by` and `role` survive `/login → /auth/line/start → callback`
and that the submitted row carries a non-null `invited_by`.

Prod proof, one week after ship — the fill-rate-by-cohort query that caught the
field-QR bug at `0/18`:

```sql
select count(*) total, count(invited_by) with_inviter,
       count(nullif(trim(declared_role_hint), '')) with_role
from staff_registrations
where created_at > '<ship date>';
```

Zero `invited_by` on office-door rows after real attempts = dead on arrival,
however green the suite.

## Risks

- **A walk-in office hire is stranded** until someone sends them a link (D3).
  Mitigated by the gate screen and the `/coming-soon` line both naming who to
  ask, rather than dead-ending.
- **The link never expires and cannot be revoked** (D1). Blast radius of a
  leaked one is a spam _application_, gated by the approval floors.
- **Mixed value shapes in `declared_role_hint`** (D6). Legacy prose falls back
  to today's behavior; the fallback is a named test, not an assumption.
- **The logged-out param leg is the historically fragile one.** `?next=`
  threading dropped every field-QR param for 13 days and no test caught it —
  hence the explicit logged-out real-flow step above.

## Out of scope

Hard inviter verification (D4) · widening the mint gate to `hr` (D8) · one-time
or expiring tokens (D1) · any change to the field/subcon doors · role changes
for existing users (that is `/settings/roles` + `set_user_role`, already built).
