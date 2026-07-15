# Spec 319 — Login-keyed bank home for admin/office staff (self-service)

**Status:** 🔨 BUILDING (design approved in chat 2026-07-15)
**Requested by:** operator, 2026-07-15 — "SA needs to be able to edit bank info as well.
Edits are never on the same page as the detail page." Clarified in chat: **enable them to
edit their _own_ bank first, similar to technicians; then (Phase-2, deferred) SA editing
bank for no-phone technicians.**
**Operator decisions (2026-07-15, in-chat):** login-keyed bank home (not registration
backfill) · approver = the **staff trio** `procurement_manager / project_director /
super_admin` (matches identity + staff-bank changes) · Phase-1 scope = **bank only** (not
the full my-info contact/ID self-service) · the edit form lives on its **own route**, never
inline on the detail page.

## Problem (verified live 2026-07-15)

Every bank self-service in the app is anchored to a record the admin/office tier does not
have. Live counts (`users` ⋈ `staff_registrations` ⋈ `workers`):

| Role                      | Users | Bank home today               |
| ------------------------- | ----- | ----------------------------- |
| technician                | 3     | ✅ `workers.bank_*`           |
| **site_admin**            | **5** | ❌ none                       |
| procurement               | 4     | ❌ none                       |
| project_director          | 3     | ❌ none                       |
| legal                     | 2     | ❌ none                       |
| super_admin               | 2     | 1 has an approved reg, 1 none |
| accounting / procmgr / PM | 1 ea  | ❌ none                       |

Only technicians (bound workers) can record/edit a payout bank. The spec 317 U4 staff-bank
form only lights up for a login with an **approved `staff_registration`** — and in practice
exactly **one** user has that. So the entire admin/office staff tier (~17 logins, the 5 SA
included) has **no way to record or edit a bank account**, and no bank record anywhere.

`bank_*` columns are deliberately un-granted to `authenticated` (ADR 0079 money-gov; bank
PII walled from in-project site_admins) — so this cannot be a plain column edit; it needs
its own DEFINER-mediated home + staged-approval flow, exactly like the three that exist.

## Design — a login-keyed twin of the staff-bank flow

The app already has a **login(`user_id`)-keyed** approved-tier request table:
`identity_change_requests` (spec 317 U3 — "name/ID/DOB belong to the human"), decided by
the staff trio, surfaced on `/settings/my-info` for every login. Bank is the same category
for a login with no audience record. Spec 319 adds the bank sibling.

### Data model (twins of `staff_registration_bank` + `staff_bank_change_requests`, re-keyed on `user_id`)

- **`user_bank`** — current payout bank for a login.
  - `user_id uuid primary key references public.users(id)`, `bank_name text not null`,
    `bank_account_number text not null`, `bank_account_name text not null`,
    `book_bank_path text` (latest passbook evidence), `updated_at`, `updated_by`.
  - **Zero-grant**: `revoke all … from anon, authenticated` (service_role / DEFINER only —
    every bank table's posture, spec 296). RLS enabled, no `authenticated` policies.
  - DEFINER `get_own_user_bank()` returns the caller's own row (keyed on `auth.uid()`) —
    the my-info prefill/display reader, mirroring `get_own_staff_bank()`.

- **`user_bank_change_requests`** — staged change (audit trail; writes RPC-only).
  - `id`, `user_id → users`, `bank_name/bank_account_number/bank_account_name`,
    `book_bank_path text not null`, `status contractor_change_status default 'pending'`,
    `requested_by → users`, `decided_by → users`, `decided_at`, `created_at`.
  - Length CHECKs on the bank fields + path (mirror `sbcr_*`); `decided_shape` CHECK
    (`(status='pending') = (decided_by is null)`).
  - Index `(user_id, status)`; **unique one-pending** `(user_id) where status='pending'`
    (atomic — the RPC pre-check alone races).
  - RLS: `grant select to authenticated`; policy own-row (`user_id = auth.uid()`) + policy
    trio (`current_user_role() in (procurement_manager, project_director, super_admin)`).
    A site_admin matches neither arm → zero rows (money; the trio is the decider — identical
    to `identity_change_requests` / `staff_bank_change_requests`).

### RPCs (DEFINER, `set search_path = public` — twins of `submit`/`decide_staff_bank_change`)

- **`submit_user_bank_change(p_bank_name, p_bank_account_number, p_bank_account_name, p_book_bank_path)` → uuid**
  - self only (`auth.uid()` not null);
  - **single-bank-home guard** — refuse if the login already has another bank home:
    `current_user_worker_id()` is not null (worker home) **OR** `current_user_contractor_id()`
    is not null (contractor home) **OR** an **approved** `staff_registrations` row exists for
    the user (staff home). This makes `user_bank` strictly the home for logins with none of
    the three, so no login ever carries two banks that can drift.
  - all three bank fields required; account number normalized (`[\s-]` stripped) +
    `^[0-9]{6,20}$` (the decide-side upsert targets NOT NULL columns — floor mirrors
    `record_own_staff_bank`);
  - **passbook photo required**: `p_book_bank_path` present; folder-pin
    `technician/<auth.uid()>/book_bank` (3-segment `storage.foldername` check, **identical to
    `submit_staff_bank_change`**) + existence check against `storage.objects` (bucket
    `contact-docs`) — the dangling-evidence guard;
  - one PENDING per user (explicit check + the unique index backstop);
  - insert the request, return its id.

- **`decide_user_bank_change(p_id uuid, p_approve boolean)` → void**
  - **trio only** (`coalesce(current_user_role() in (…), false) is not true` → 42501);
  - `select … for update`; refuse not-found / already-decided;
  - **re-check the single-home guard at decide time** — if the requester acquired a worker /
    contractor / approved-registration home since submitting, refuse (approving would write
    the wrong/duplicate home) — mirrors the staff-bank late-bind recheck;
  - approve: **upsert `user_bank`** (`on conflict (user_id) do update` all fields +
    `book_bank_path` + `updated_at/by`), `updated_by = requested_by` (bank = the login's
    own declaration; the decider is on the request row);
  - set the request `approved`/`rejected`, `decided_by = auth.uid()`, `decided_at = now()`.

### Storage

- Passbook uploads to `contact-docs` at `technician/<uid>/book_bank/<file>` via the shared
  `buildTechnicianDocPath(uid, "book_bank", …)`, **reusing the spec 315 U2 INSERT-only policy**
  (`20260813075787`) — it is already scoped to `auth.uid()`, so every login can write its own
  folder, and the immediate sibling (`submit_staff_bank_change`, office staff who are not
  technicians) already uses this exact path. **No new storage policy** — U1's danger-path
  surface is the migration (tables + RPCs) only. The trio views the photo in the queue via the
  page's existing **service-role** signed-URL reader; no `authenticated` SELECT policy exists
  or is added (owner uploads, cannot read back).

### UI / routes

- **`/settings/my-info`** — new **บัญชีธนาคาร** section, shown when
  `isEmployeeRole(role) && !workerId && !contractorId && !isStaffHome` (the ~17 logins with
  no other bank home; visitors/clients/contractors excluded via `isEmployeeRole` +
  the existing worker/contractor link branches). Renders:
  - current bank display from `get_own_user_bank()` (or a "ยังไม่ได้เพิ่มบัญชี" empty state);
  - a pending banner when a `user_bank_change_requests` row is `pending`;
  - an **แก้ไขบัญชี** link → `/settings/my-info/bank` (navigates away — the edit is never on
    this detail page).
- **`/settings/my-info/bank`** (NEW route) — the edit page. `UserBankChangeForm`
  (`BankSelect` + account-number + account-name inputs + required passbook upload), submit →
  `submit_user_bank_change` → redirect back to `/settings/my-info`. Blocks a second submit
  while one is pending. Auth = `getClaims` (mirrors my-info; unserved roles not bounced).
- **`/contacts/bank-changes`** — add a 5th kind `user-bank` (chip **เจ้าหน้าที่** — distinct
  from the spec 317 U4 `staff-bank` chip พนักงาน, which is registration-backed office staff;
  operator may rename). Read via the
  page's admin client, gated by the existing `canSeeTrioKinds` (identity + staff-bank + now
  user-bank are trio-only). `bank-change-decision.tsx` routes `kind === 'user-bank'` →
  `decideUserBankChange` action → `decide_user_bank_change`. Passbook shown via the existing
  admin-signed-URL reader.

## Units

- **U1 — schema + RPCs + pgTAP** (migration `075800`, single schema lane, PR **held** —
  migration is danger-path). `user_bank`, `user_bank_change_requests`, `get_own_user_bank`,
  `submit_user_bank_change`, `decide_user_bank_change`. **No storage policy** — reuses the
  spec 315 U2 `technician/<uid>/book_bank` INSERT policy. pgTAP `319-user-bank`: submit floors
  (missing field / bad account no /
  missing photo / dangling photo), single-home refusal (worker/contractor/approved-reg),
  one-pending, trio-only decide, approve upserts `user_bank`, RLS (owner sees own request,
  trio sees all, site_admin sees none).
- **U2 — my-info bank section + edit route + form + submit action** (code-only). The
  `บัญชีธนาคาร` section on `/settings/my-info`, the `/settings/my-info/bank` page,
  `UserBankChangeForm`, the `submitUserBankChange` server action, `get_own_user_bank` reader.
  Touches `labels.ts` (additive, distinct keys — coordinate with lane 312ui).
- **U3 — bank-changes queue 5th kind** (code-only). `user-bank` kind in
  `bank-change-queue.ts` + `bank-change-decision.tsx` + `decideUserBankChange` action + the
  admin-signed passbook URL. Chip label additive in `labels.ts`.

## Out of scope (deferred)

- **Phase-2 — SA edits bank for no-phone technicians** (the "then" of the operator's ask).
  Separate spec; builds on the live spec 298 capture-blind flow.
- Full my-info self-service (contact / ID card) for the admin tier — bank only this pass.
- Consolidating the four bank homes (worker / staff_registration / contractor /
  user_bank) — noted; not this spec.
- Any downstream payroll wiring for admin-staff banks — this spec only records/edits the
  account; no payout consumer is added.

## Verification

- pgTAP `319-user-bank` green (added to the suite; not a known-red).
- Real-flow (dev-preview, memory `dev-preview-login`): sign in as a **site_admin** →
  `/settings/my-info` shows the empty บัญชีธนาคาร section → แก้ไขบัญชี → fill + upload passbook
  → submit → pending banner appears. Then as **super_admin** → `/contacts/bank-changes` →
  the พนักงาน row with the passbook → approve → the site_admin's `get_own_user_bank()` now
  returns the account. Reject path leaves `user_bank` unchanged.
- `pnpm lint && pnpm typecheck && pnpm test` green.
