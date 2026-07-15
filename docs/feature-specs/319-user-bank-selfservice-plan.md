# Spec 319 — Login-keyed bank home — Implementation Plan

> **For agentic workers:** each unit ships through the repo's `ship-unit` skill (6 gates: lane
> claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes review → prove the
> merge). Steps use checkbox (`- [ ]`) syntax. RED-first is binding — the failing test (pgTAP
> for U1, vitest for U2/U3) exists and is seen to fail before production code.

**Goal:** Give the admin/office staff tier (login-keyed, no worker/contractor/registration
record) a self-service bank home — record + edit their own payout account, staged for
staff-trio approval, with the edit on its own route.

**Architecture:** A login(`user_id`)-keyed twin of the spec 317 U4 staff-bank flow —
`user_bank` (current) + `user_bank_change_requests` (staged) + `get_own_user_bank` /
`submit_user_bank_change` / `decide_user_bank_change` DEFINER RPCs. Surfaced on
`/settings/my-info` (display + link) with the edit on a new `/settings/my-info/bank` page;
decided in the existing `/contacts/bank-changes` queue (5th kind). Passbook reuses the spec
315 U2 `technician/<uid>/book_bank` storage policy — no new storage RLS.

**Tech Stack:** Next.js 16 App Router (Server Components; `'use client'` only for the form),
Supabase Postgres + RLS + DEFINER RPCs, pgTAP, Vitest/RTL, Tailwind token classes.

## Global Constraints

- Migration number **`075800`**, filename `supabase/migrations/20260813075800_spec319u1_user_bank.sql`. Single schema lane (lane 319ub claimed). PR **held** (migration = danger-path) — self-merge on green under the additive-migration grant, or operator merge.
- Bank tables are **zero-grant** (`revoke all … from anon, authenticated`) — ADR 0079 money-gov; bank PII walled from in-project site_admins. No `authenticated` policy on `user_bank`. Reads only via `get_own_user_bank` (own) or the admin client (trio queue).
- Status enum = **reuse** `public.contractor_change_status` (`pending`/`approved`/`rejected`). Do NOT add an enum value.
- Approver set = the **staff trio** `procurement_manager, project_director, super_admin` (hardcode in the RPC gate exactly as `submit/decide_staff_bank_change` do — matches identity + staff-bank).
- Account number floor: normalize `[\s-]` out, require `^[0-9]{6,20}$` (mirror `record_own_staff_bank` — the decide-side upsert targets NOT NULL columns).
- Passbook path pin: `technician/<auth.uid()>/book_bank` (3-segment `storage.foldername`), identical to `submit_staff_bank_change`; reuse `buildTechnicianDocPath` and the spec 315 U2 INSERT policy — do NOT author a new storage policy.
- All Thai UI copy via Edit/Write tools (PowerShell corrupts Thai). Reuse token classes from `src/lib/ui/classes.ts`; no raw Tailwind palette.
- `labels.ts` additions are **additive, distinct keys** (lane 312ui also edits it — append, never rewrite).

---

## Task U1 — Schema + RPCs + pgTAP

**Files:**

- Create: `supabase/migrations/20260813075800_spec319u1_user_bank.sql`
- Create: `supabase/tests/database/319-user-bank.test.sql`

**Interfaces produced (consumed by U2/U3):**

- `get_own_user_bank() → table(bank_name text, bank_account_number text, bank_account_name text)` — DEFINER, own row.
- `submit_user_bank_change(p_bank_name text, p_bank_account_number text, p_bank_account_name text, p_book_bank_path text) → uuid` — DEFINER, self.
- `decide_user_bank_change(p_id uuid, p_approve boolean) → void` — DEFINER, trio.
- Tables `public.user_bank` (pk `user_id`), `public.user_bank_change_requests` (pk `id`, unique-one-pending on `user_id`).

- [ ] **Step 1 — Write the failing pgTAP test.** Create `supabase/tests/database/319-user-bank.test.sql`, mirroring `317-staff-bank-change.test.sql` (fixture users via `tests.create_supabase_user` / the file's existing helper; `set local role authenticated` + `request.jwt.claims` per that file; grant `_tap_buf` if the file switches to `authenticated`, per the pgTAP \_tap_buf lesson). `plan(18)`. Assertions:
  1. `has_table('public','user_bank')`, `has_table('public','user_bank_change_requests')`.
  2. `has_function('public','get_own_user_bank','{}')`, `…submit_user_bank_change`, `…decide_user_bank_change`.
  3. submit floors (each `throws_ok`): missing bank_name (P0001), account no `12ab` (P0001), null path (P0001), path in wrong folder e.g. `technician/<other-uid>/book_bank/x.jpg` (42501), path not present in `storage.objects` (P0001).
  4. single-home refusal: fixture a `workers` row with `user_id = caller` → submit `throws_ok` 42501; a `staff_registrations` row `status='approved'` for the caller → submit `throws_ok` 42501.
  5. happy submit (caller with NO home, a `storage.objects` fixture row at `technician/<uid>/book_bank/x.jpg`): `lives_ok`, `user_bank_change_requests` has 1 pending for the user.
  6. one-pending: a 2nd submit `throws_ok` P0001.
  7. decide gate: as a non-trio role (e.g. `site_admin`) `decide_user_bank_change(id,true)` `throws_ok` 42501.
  8. decide approve as `super_admin`: `lives_ok`; `user_bank` row now exists for the user with the submitted fields; request `status='approved'`.
  9. decide reject path (fresh request): `user_bank` unchanged; request `status='rejected'`.
  10. RLS: as the owner, `select count(*) from user_bank_change_requests` = their rows; as `site_admin` (not owner, not trio) = 0.
- [ ] **Step 2 — Run it, verify RED.** `pnpm db:test 319-user-bank` → fails (objects absent). (Runner: `scripts/run-pgtap.ts`; needs `pnpm db:link`.)
- [ ] **Step 3 — Write the migration.** Create the migration file with this exact content:

```sql
-- Spec 319 U1 — user_bank + user_bank_change_requests: a login(user_id)-keyed
-- bank home for the admin/office tier, which has no worker/contractor/approved-
-- registration record to anchor a bank on (verified live 2026-07-15: ~17 logins
-- incl. all 5 site_admins have none). Twins of staff_registration_bank +
-- staff_bank_change_requests (spec 317 U4), re-keyed on users(id); decided by the
-- staff-approval trio (matches identity_change_requests). Passbook reuses the
-- spec 315 U2 technician/<uid>/book_bank INSERT policy — no new storage RLS.
--
-- Posture: bank tables zero-grant (ADR 0079, bank PII walled from site_admins);
-- request row = audit trail, writes RPC-only, status enum reused
-- (contractor_change_status); reads = own row + the trio.

create table public.user_bank (
  user_id             uuid primary key references public.users(id),
  bank_name           text not null,
  bank_account_number text not null,
  bank_account_name   text not null,
  book_bank_path      text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid not null references public.users(id),
  constraint ub_bank_name_len    check (length(bank_name) <= 120),
  constraint ub_account_no_shape check (bank_account_number ~ '^[0-9]{6,20}$'),
  constraint ub_account_name_len check (length(bank_account_name) <= 120),
  constraint ub_book_bank_len    check (book_bank_path is null or length(book_bank_path) <= 500)
);
alter table public.user_bank enable row level security;
revoke all on table public.user_bank from anon, authenticated;
-- No authenticated policies: bank PII is DEFINER-only (ADR 0079). Reads go through
-- get_own_user_bank (own row) or the admin client (trio queue).

create table public.user_bank_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id),
  bank_name           text,
  bank_account_number text,
  bank_account_name   text,
  book_bank_path      text not null,
  status              public.contractor_change_status not null default 'pending',
  requested_by        uuid not null references public.users(id),
  decided_by          uuid references public.users(id),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint ubcr_bank_name_len    check (bank_name is null or length(bank_name) <= 120),
  constraint ubcr_account_no_len   check (bank_account_number is null or length(bank_account_number) <= 50),
  constraint ubcr_account_name_len check (bank_account_name is null or length(bank_account_name) <= 120),
  constraint ubcr_book_bank_len    check (length(book_bank_path) <= 500),
  constraint ubcr_decided_shape    check ((status = 'pending') = (decided_by is null))
);
create index ubcr_user_status_idx on public.user_bank_change_requests (user_id, status);
create unique index ubcr_one_pending_idx on public.user_bank_change_requests (user_id)
  where status = 'pending';

alter table public.user_bank_change_requests enable row level security;
revoke all on table public.user_bank_change_requests from anon, authenticated;
grant select on public.user_bank_change_requests to authenticated;
create policy "user bank change requests readable by owner"
  on public.user_bank_change_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy "user bank change requests readable by staff approvers"
  on public.user_bank_change_requests for select to authenticated
  using ((select public.current_user_role())
           in ('procurement_manager', 'project_director', 'super_admin'));

-- get_own_user_bank — caller's own current bank (my-info prefill/display).
create function public.get_own_user_bank()
returns table (bank_name text, bank_account_number text, bank_account_name text)
language sql
security definer
set search_path = public
as $$
  select bank_name, bank_account_number, bank_account_name
  from public.user_bank
  where user_id = auth.uid();
$$;
revoke all on function public.get_own_user_bank() from public, anon;
grant execute on function public.get_own_user_bank() to authenticated;

-- submit_user_bank_change — self only; refuse if another bank home exists;
-- all-3 required + account 6-20 digits; passbook required + own-folder pin +
-- existence check; one pending per user.
create function public.submit_user_bank_change(
  p_bank_name           text,
  p_bank_account_number text,
  p_bank_account_name   text,
  p_book_bank_path      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_no   text := nullif(regexp_replace(coalesce(p_bank_account_number, ''), '[\s-]', '', 'g'), '');
  v_own  text := nullif(btrim(coalesce(p_bank_account_name, '')), '');
  v_path text := nullif(btrim(coalesce(p_book_bank_path, '')), '');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'submit_user_bank_change: not authenticated' using errcode = '42501';
  end if;
  -- Single bank home per login (worker / contractor / approved-staff own theirs).
  if public.current_user_worker_id() is not null then
    raise exception 'submit_user_bank_change: bound workers use the worker bank flow'
      using errcode = '42501';
  end if;
  if public.current_user_contractor_id() is not null then
    raise exception 'submit_user_bank_change: contractors use the contractor bank flow'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations
             where user_id = v_uid and status = 'approved') then
    raise exception 'submit_user_bank_change: approved staff use the staff bank flow'
      using errcode = '42501';
  end if;
  if v_name is null or v_no is null or v_own is null then
    raise exception 'submit_user_bank_change: bank name, account number and account name required'
      using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'submit_user_bank_change: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'submit_user_bank_change: passbook photo required' using errcode = 'P0001';
  end if;
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[1] is distinct from 'technician'
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from 'book_bank' then
    raise exception 'submit_user_bank_change: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'contact-docs' and o.name = v_path) then
    raise exception 'submit_user_bank_change: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.user_bank_change_requests
             where user_id = v_uid and status = 'pending') then
    raise exception 'submit_user_bank_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.user_bank_change_requests
    (user_id, bank_name, bank_account_number, bank_account_name, book_bank_path, requested_by)
  values (v_uid, v_name, v_no, v_own, v_path, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_user_bank_change(text, text, text, text) from public, anon;
grant execute on function public.submit_user_bank_change(text, text, text, text) to authenticated;

-- decide_user_bank_change — trio only. Approve upserts user_bank.
create function public.decide_user_bank_change(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.user_bank_change_requests%rowtype;
begin
  if coalesce(public.current_user_role()
                in ('procurement_manager', 'project_director', 'super_admin'), false) is not true then
    raise exception 'decide_user_bank_change: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.user_bank_change_requests where id = p_id for update;
  if not found then
    raise exception 'decide_user_bank_change: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_user_bank_change: request already decided' using errcode = 'P0001';
  end if;
  -- Late-bind recheck (worker / approved-reg have a user_id column; contractor
  -- binding is not a path for an existing admin login, so not rechecked here).
  if p_approve and (
       exists (select 1 from public.workers w where w.user_id = v_req.user_id)
    or exists (select 1 from public.staff_registrations r
               where r.user_id = v_req.user_id and r.status = 'approved')
  ) then
    raise exception 'decide_user_bank_change: requester now has another bank home'
      using errcode = 'P0001';
  end if;

  if p_approve then
    insert into public.user_bank
      (user_id, bank_name, bank_account_number, bank_account_name, book_bank_path, updated_by)
    values (v_req.user_id, v_req.bank_name, v_req.bank_account_number,
            v_req.bank_account_name, v_req.book_bank_path, v_req.requested_by)
    on conflict (user_id) do update
      set bank_name           = excluded.bank_name,
          bank_account_number = excluded.bank_account_number,
          bank_account_name   = excluded.bank_account_name,
          book_bank_path      = excluded.book_bank_path,
          updated_at          = now(),
          updated_by          = excluded.updated_by;
  end if;

  update public.user_bank_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.contractor_change_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end;
$$;
revoke all on function public.decide_user_bank_change(uuid, boolean) from public, anon;
grant execute on function public.decide_user_bank_change(uuid, boolean) to authenticated;
```

- [ ] **Step 4 — Apply + regenerate types.** `pnpm db:push` (auto-Y on this box), then `pnpm db:types` (regenerates `src/lib/db/database.types.ts` — needed for U2/U3 typing).
- [ ] **Step 5 — Run the test, verify GREEN.** `pnpm db:test 319-user-bank` → 18/18. (Re-run once if a pooler/circuit-breaker flake; known-red files are only 200/221 — a new file must pass. Do NOT add it to `known-red.json`.)
- [ ] **Step 6 — Gate-check the guards.** `pnpm typecheck && pnpm lint` (types regen must compile). pgTAP enum/table pins: a new table doesn't trip the enum pins; confirm `pnpm db:test` suite has no NEW red beyond 200/221.
- [ ] **Step 7 — Ship U1** via `ship-unit` (commit `feat(bank): user_bank + change-request RPCs (spec 319 U1)`; PR held — migration danger-path).

---

## Task U2 — my-info bank section + edit page + form + action

**Files:**

- Create: `src/lib/register/own-user-bank.ts` — `getOwnUserBank(supabase)` reader (mirrors `getOwnStaffBank`).
- Modify: `src/app/settings/my-info/page.tsx` — add the บัญชีธนาคาร section for the user-bank audience.
- Create: `src/app/settings/my-info/bank/page.tsx` — the separate edit page.
- Create: `src/components/features/profile/user-bank-change-form.tsx` — `UserBankChangeForm` (clone of `staff-bank-change-form.tsx`, wired to the new action).
- Modify: `src/app/settings/my-info/actions.ts` — add `submitUserBankChange`.
- Modify: `src/lib/i18n/labels.ts` — additive labels (distinct keys).
- Test: `tests/unit/user-bank-change-form.test.tsx`, `tests/unit/my-info-user-bank-section.test.tsx` (or extend the existing my-info test).

**Interfaces:**

- Consumes (U1): `get_own_user_bank`, `submit_user_bank_change`.
- Produces (U3 consumes none of U2; U3 is independent): —
- `getOwnUserBank(supabase) → { bankName, accountNumber, accountName } | null`.
- `submitUserBankChange({ bankName, accountNo, accountName, attachmentId, ext }) → { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1 — RED: form test.** `tests/unit/user-bank-change-form.test.tsx`: renders `UserBankChangeForm`; asserts a validation error when submitting with no passbook (`"กรุณาแนบรูปสมุดบัญชีของบัญชีใหม่"`), and that a `hasPending` prop renders the "กำลังรอการอนุมัติ" banner instead of the form. Run `pnpm test user-bank-change-form` → FAIL (module missing).
- [ ] **Step 2 — Reader.** Create `src/lib/register/own-user-bank.ts`:

```ts
import "server-only";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

// Spec 319 — the caller's own login-keyed bank (get_own_user_bank is DEFINER,
// keyed on auth.uid(); user_bank is zero-grant like every bank table).
export async function getOwnUserBank(
  supabase: ServerClient,
): Promise<{ bankName: string; accountNumber: string; accountName: string } | null> {
  const { data } = await supabase.rpc("get_own_user_bank");
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? {
        bankName: row.bank_name,
        accountNumber: row.bank_account_number,
        accountName: row.bank_account_name,
      }
    : null;
}
```

- [ ] **Step 3 — Action.** In `src/app/settings/my-info/actions.ts` add `submitUserBankChange`, mirroring `submitStaffBankChange`: rebuild the path server-side via `buildTechnicianDocPath(uid, "book_bank", attachmentId, ext)`, call `supabase.rpc("submit_user_bank_change", { p_bank_name, p_bank_account_number, p_bank_account_name, p_book_bank_path })`, map the PG error to a friendly `{ ok:false, error }` (reuse the staff action's error mapping). Auth = `getClaims` + `sub` for uid.
- [ ] **Step 4 — Form.** Create `src/components/features/profile/user-bank-change-form.tsx` by cloning `staff-bank-change-form.tsx`; change the import to `submitUserBankChange` and the heading copy (`USER_BANK_*` labels). Keep the passbook-required flow verbatim (`buildTechnicianDocPath`, `preparePhotoForUpload`, upload-to-`CONTACT_DOCS_BUCKET`).
- [ ] **Step 5 — Edit page.** Create `src/app/settings/my-info/bank/page.tsx`: `getClaims` guard (redirect `/login` if none), render `<PageShell>` + `<DetailHeader backHref="/settings/my-info" backLabel="กลับ">` + `<UserBankChangeForm uid={sub} hasPending={…} />`. Compute `hasPending` from `user_bank_change_requests` (own-row RLS select, status pending). Show the current bank via `getOwnUserBank` above the form (read-only) for edit context.
- [ ] **Step 6 — my-info section.** In `src/app/settings/my-info/page.tsx`: compute `isUserBankHome = isEmployeeRole(role) && !workerId && !contractorId && !isStaffHome` (fetch `role` from `current_user_role` or the `users` row; `isEmployeeRole` from `@/lib/auth/role-home`). When true, render a บัญชีธนาคาร section: current bank display from `getOwnUserBank` (or empty state "ยังไม่ได้เพิ่มบัญชี"), a pending banner if a pending request exists, and an **แก้ไขบัญชี** `<Link href="/settings/my-info/bank">`. Do NOT render the edit form inline (edit ≠ detail page).
- [ ] **Step 7 — Labels.** Append to `labels.ts` (distinct keys): `USER_BANK_SECTION_LABEL = "บัญชีธนาคาร"`, `USER_BANK_EMPTY = "ยังไม่ได้เพิ่มบัญชี"`, `USER_BANK_EDIT_LINK = "แก้ไขบัญชี"`, `USER_BANK_PENDING = "คำขอเปลี่ยนบัญชีธนาคารกำลังรอการอนุมัติ"`.
- [ ] **Step 8 — GREEN + guards.** `pnpm test user-bank && pnpm lint && pnpm typecheck`. New page.tsx trips the nav-back-affordance guard — classify `/settings/my-info/bank` in that guard's list (per the spec 298 lesson).
- [ ] **Step 9 — Real-flow verify** (dev-preview, memory `dev-preview-login`): sign in as a **site_admin** → `/settings/my-info` shows the empty บัญชีธนาคาร section → แก้ไขบัญชี navigates to `/settings/my-info/bank` → fill + attach passbook → submit → pending banner. Zero console errors. Screenshot.
- [ ] **Step 10 — Ship U2** via `ship-unit` (code-only; auto-merge on green — but touches `my-info` + a new page; if the danger-path guard trips on the settings surface, operator-merge).

---

## Task U3 — bank-changes queue: 5th `user-bank` kind

**Files:**

- Modify: `src/lib/approvals/bank-change-queue.ts` — add the `user-bank` kind + its row builder + a trio-gated fetch (mirror the `staff-bank` block).
- Modify: `src/app/contacts/bank-changes/page.tsx` — fetch user-bank rows (admin client, trio-gated) + merge into the list; sign the passbook URL like staff-bank.
- Modify: `src/components/features/portal/bank-change-decision.tsx` — route `kind === "user-bank"` → `decideUserBankChange`.
- Modify: `src/lib/portal/actions.ts` — add `decideUserBankChange(id, approve)` (gate `[procurement_manager, project_director, super_admin]`, honor `applyAssumedRole`, call `decide_user_bank_change`).
- Modify: `src/lib/i18n/labels.ts` — chip label `USER_BANK_KIND_CHIP = "เจ้าหน้าที่"` (additive).
- Test: `tests/unit/bank-change-queue.test.ts` (extend — user-bank row shape), `tests/unit/…decision…` (route to the new action).

**Interfaces:**

- Consumes (U1): `decide_user_bank_change`; the `user_bank_change_requests` table (admin read).
- `decideUserBankChange(id: string, approve: boolean) → { ok: true } | { ok: false; error: string }`.
- Queue row: `{ kind: "user-bank"; id; name; bankName; accountNumber; accountName; bookBankPath; … }` — same field shape as the `staff-bank` row.

- [ ] **Step 1 — RED: queue test.** In `tests/unit/bank-change-queue.test.ts` add a case: given a raw user-bank request row + a `usersById` name map, the builder returns a row with `kind: "user-bank"` and the bank fields + `bookBankPath`. Run → FAIL.
- [ ] **Step 2 — Queue builder.** In `bank-change-queue.ts`: extend the `kind` union with `"user-bank"`; add a `buildUserBankRows(rows, usersById)` mirroring the staff-bank builder (name from `usersById.get(user_id)`); export the request row type. Passbook `bookBankPath` carried for the photo render.
- [ ] **Step 3 — Decide action.** In `src/lib/portal/actions.ts` add `decideUserBankChange` cloning `decideWorkerBankChange` (gate `[procurement_manager, project_director, super_admin]` — note: NOT `[...PM_ROLES, procurement_manager]`; the trio, matching staff-bank/identity — `applyAssumedRole` for super_admin view-as), calling `rpc("decide_user_bank_change", { p_id, p_approve })`.
- [ ] **Step 4 — Decision routing.** In `bank-change-decision.tsx` add the `kind === "user-bank"` branch → `decideUserBankChange`.
- [ ] **Step 5 — Queue page.** In `contacts/bank-changes/page.tsx`: under the existing `canSeeTrioKinds` gate, admin-fetch pending `user_bank_change_requests` + the `users` name map, build rows, merge into the list; sign `bookBankPath` via the page's existing admin signed-URL reader (same call the staff-bank rows use). Chip label `USER_BANK_KIND_CHIP`.
- [ ] **Step 6 — GREEN + guards.** `pnpm test bank-change && pnpm lint && pnpm typecheck`.
- [ ] **Step 7 — Real-flow verify** (dev-preview): as **super_admin** → `/contacts/bank-changes` shows the เจ้าหน้าที่ row (from the U2 submission) with the passbook photo → approve → the site_admin's `get_own_user_bank` returns the account (re-check on `/settings/my-info`). Reject path leaves `user_bank` empty. Screenshot.
- [ ] **Step 8 — Ship U3** via `ship-unit` (code-only; the bank-changes queue is money-adjacent — if the guard holds it, operator-merge).

---

## Self-review (against the spec)

- **Coverage:** `user_bank`/`user_bank_change_requests`/3 RPCs → U1. my-info section + separate edit route + form + pending banner + single-home gate on the section → U2. Queue 5th kind + trio decide + passbook render → U3. All spec sections mapped.
- **Single-home guard:** submit checks worker+contractor+approved-reg (U1); the my-info section shows only when `!worker && !contractor && !isStaffHome` (U2) — the two are consistent (a pending-reg employee, a non-issue for the 0-reg admin tier, would see the section and submit; approved-reg is refused both places). decide rechecks worker+approved-reg (contractor has no `user_id` column — documented asymmetry).
- **Type consistency:** RPC arg names `p_bank_name/p_bank_account_number/p_bank_account_name/p_book_bank_path` used identically in U1 SQL and the U2 action; `getOwnUserBank` / `submitUserBankChange` / `decideUserBankChange` signatures stable across tasks; `kind: "user-bank"` identical in queue builder + decision router.
- **No new enum, no new storage policy** (reuse `contractor_change_status` + the 315 U2 path) — matches Global Constraints.
