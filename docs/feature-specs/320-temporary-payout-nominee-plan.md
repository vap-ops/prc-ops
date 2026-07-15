# Spec 320 — Temporary payout nominee — Implementation Plan

> **For agentic workers:** each unit ships through the repo's `ship-unit` skill (6 gates: lane
> claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes review → prove the
> merge). Steps use checkbox (`- [ ]`) syntax. RED-first is binding — the failing test (pgTAP for
> U1, vitest/RTL for U2) exists and is seen to fail before production code.
>
> **BUILD GATE:** do not ship U2 to live payouts until the operator confirms the _Precondition_ in
> the spec (accountant/labor stance on third-party wage discharge + WHT stays under the worker).
> U1 + U2 may be built and reviewed before that; the flip-on waits.

**Goal:** Give the `procurement_manager` a manual, temporary way to route a bankless worker's wage
to a friend's / family member's account — with a signed-consent photo as discharge evidence, a soft
"who's still on a nominee" worklist to reclaim them, and wage/WHT/GL attribution untouched (per
worker).

**Architecture:** A PM-written **override record on the worker** (`worker_payout_nominee`,
append-history, zero-grant bank-PII posture) + four DEFINER RPCs gated to `procurement_manager`
(`set` / `clear` / `get` / `list`). Surfaced on a new PM-only `/settings/payout-nominees` (worklist +
per-row clear) with the add/edit form on its own `/edit` route. Consent photo reuses the spec 298
capture storage path. **No** approval flow, **no** new enum, **no** money movement — the disbursement
consumer is spec 128 (blocked, out of scope here).

**Tech Stack:** Next.js 16 App Router (Server Components; `'use client'` only for the form),
Supabase Postgres + RLS + DEFINER RPCs, pgTAP, Vitest/RTL, Tailwind token classes.

## Global Constraints

- Migration number **`075801`**, filename
  `supabase/migrations/20260813075801_spec320u1_payout_nominee.sql`. Single schema lane (claim lane
  `320nominee` in `../LANES.md` before writing the migration — the `require-lane-claim` hook blocks
  it otherwise). PR **held** (migration = danger-path) — self-merge on green under the
  additive-migration grant, or operator merge.
- `worker_payout_nominee` is **zero-grant** (`revoke all … from anon, authenticated`; RLS enabled, no
  `authenticated` policy) — bank PII, ADR 0079 money-gov posture, exactly like every bank table.
  Reads only via the DEFINER RPCs (own PM surface) — never a plain `authenticated` select.
- **Gate = `procurement_manager` ONLY** (operator: "only procurement manager"), **not** the staff
  trio. Every RPC begins with
  `if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then raise … 42501`.
  Coalesce-to-false is mandatory (the RLS self-check coalesce trap — an unbound caller's NULL must
  fail closed, memory `rls-self-check-coalesce`).
- **No new enum.** Active/cleared is a `boolean active` + `cleared_at` pair, not an enum (avoids the
  enum-exhaustiveness guard trips; `active` is not a free-text status). `payee_relationship` is
  descriptive text, not a status.
- Account-number floor: normalize `[\s-]` out, require `^[0-9]{6,20}$` (covers a 10-digit PromptPay
  phone, a 13-digit citizen-ID, and bank account numbers).
- **Consent photo** — gate-check RESOLVED 2026-07-15: the spec 298 capture path (`sa-bank-capture/…`)
  is scoped to `site_admin`/`super_admin`, so a `procurement_manager` cannot reuse it. U1 adds a **new
  `procurement_manager`-scoped INSERT-only policy** on `contact-docs`, path
  `nominee-consent/<worker_id>/<file>` (2 folder segments). No `authenticated` SELECT policy matches
  the prefix → owner cannot read back; PM surface reads via the service-role signed-URL reader. This
  is a second danger-path surface (storage RLS) — call it out in the PR body.
- All Thai UI copy via Edit/Write tools (PowerShell corrupts Thai). Token classes only
  (`src/lib/ui/classes.ts` / globals.css tokens); no raw Tailwind palette (design-system guard).
- `labels.ts` additions are **additive, distinct keys** (append, never rewrite — other lanes edit it).

---

## Task U1 — Schema + RPCs + pgTAP

**Files:**

- Create: `supabase/migrations/20260813075801_spec320u1_payout_nominee.sql`
- Create: `supabase/tests/database/320-payout-nominee.test.sql`

**Interfaces produced (consumed by U2):**

- `set_worker_payout_nominee(p_worker_id uuid, p_payee_name text, p_payee_relationship text, p_payee_bank_name text, p_payee_account_number text, p_payee_account_name text, p_consent_doc_path text) → uuid` — DEFINER, PM-only.
- `clear_worker_payout_nominee(p_worker_id uuid) → void` — DEFINER, PM-only, idempotent.
- `get_worker_payout_nominee(p_worker_id uuid) → table(payee_name text, payee_relationship text, payee_bank_name text, payee_account_number text, payee_account_name text, consent_doc_path text, set_at timestamptz)` — DEFINER, PM-only, the active nominee (0-or-1 row).
- `list_active_payout_nominees() → table(worker_id uuid, payee_name text, payee_bank_name text, payee_account_number text, set_at timestamptz, days_active int)` — DEFINER, PM-only, the worklist.
- Table `public.worker_payout_nominee` (unique-one-active on `worker_id`).

- [x] **Step 0 — Dependency gate-check (binding, gate 2). DONE 2026-07-15:**
  - spec 298 storage (`20260813075720_spec298u1_sa_bank_capture.sql`, read live): path `sa-bank-capture/…`, INSERT policy scoped to `site_admin`/`super_admin` — **NOT PM-reusable** → U1 adds a new PM-scoped policy on `nominee-consent/<worker_id>/` (2-segment path), per Global Constraints.
  - `current_user_role`, `current_user_worker_id`, `current_user_contractor_id` exist (pg_proc); `procurement_manager` is a live `user_role` value (298 `complete_worker_bank` gates on it, and it's live). ✓
  - DB head = `20260813075800` (live `max(version)`); `075801` free. ✓
- [ ] **Step 1 — Write the failing pgTAP test.** Create `supabase/tests/database/320-payout-nominee.test.sql`, mirroring `319-user-bank.test.sql` (fixture users via the file's helper; `set local role authenticated` + `request.jwt.claims`; grant on `_tap_buf`/its seq if the file switches to `authenticated`, per the pgTAP `_tap_buf` lesson). `plan(16)`. Fixtures: a `procurement_manager` user, a `site_admin` user, and one `workers` row `W`. A `storage.objects` fixture row at the consent path for `W`. Assertions:
  1. `has_table('public','worker_payout_nominee')`.
  2. `has_function('public','set_worker_payout_nominee', …)`, `…clear…`, `…get_worker_payout_nominee`, `…list_active_payout_nominees`.
  3. **PM-gate**: as `site_admin`, each of `set_worker_payout_nominee(…)`, `clear_worker_payout_nominee(W)`, `get_worker_payout_nominee(W)`, `list_active_payout_nominees()` `throws_ok` `42501`.
  4. **set floors** as `procurement_manager` (each `throws_ok`): empty `p_payee_name` (P0001); account no `12ab` (P0001); null/empty `p_consent_doc_path` (P0001); consent path in the wrong folder e.g. `nominee-consent/<other-worker>/x.jpg` (42501); consent path not present in `storage.objects` (P0001); unknown `p_worker_id` (P0001).
  5. **happy set** as `procurement_manager` (valid consent fixture): `lives_ok`; `worker_payout_nominee` has exactly 1 `active` row for `W` with the submitted fields.
  6. **one-active on re-set**: a 2nd `set_worker_payout_nominee(W, …)` `lives_ok`; then `select count(*) from worker_payout_nominee where worker_id=W and active` = **1** and `select count(*) where worker_id=W` = **2** (prior row retained + cleared, `cleared_at` not null).
  7. **get** returns the active nominee's fields for `W` (1 row).
  8. **list** returns a row for `W` with `days_active >= 0` (fixture `set_at` = now → 0).
  9. **clear** on `W`: `lives_ok`; no `active` row remains; `get_worker_payout_nominee(W)` returns 0 rows; a 2nd `clear` (already cleared) `lives_ok` (idempotent, no throw).
  10. **RLS wall**: `set local role authenticated` as the `site_admin` and `select count(*) from public.worker_payout_nominee` → `throws_ok` `42501` (zero-grant; not merely 0 rows — the table is un-granted to `authenticated`). Use `throws_ok($$ select 1 from public.worker_payout_nominee $$, '42501')`.
- [ ] **Step 2 — Run it, verify RED.** `pnpm db:test 320-payout-nominee` → fails (objects absent). (Runner `scripts/run-pgtap.ts`; needs `pnpm db:link`.)
- [ ] **Step 3 — Write the migration.** Create the file with this content (align the storage folder-pin to Step 0's finding):

```sql
-- Spec 320 U1 — worker_payout_nominee: a PM-managed, TEMPORARY payout override
-- routing a bankless worker's wage to a friend/family account, with a signed-
-- consent photo as discharge evidence. Manual, procurement_manager-only, no
-- approval flow. Append-history (new active row per nominee; clearing flips the
-- active row to cleared, never deletes) so the row provenance is its own audit
-- trail. Attribution (wage/WHT/GL) stays per-worker elsewhere; this only swaps
-- the bank destination line, read by the spec 128 disbursement builder later.
--
-- Posture: zero-grant bank PII (ADR 0079), reads via DEFINER RPCs only; gate is
-- procurement_manager ONLY (operator, not the trio). Consent photo reuses the
-- spec 298 capture storage path (no new storage policy where it fits).

create table public.worker_payout_nominee (
  id                   uuid primary key default gen_random_uuid(),
  worker_id            uuid not null references public.workers(id),
  payee_name           text not null,
  payee_relationship   text not null,
  payee_bank_name      text not null,
  payee_account_number text not null,
  payee_account_name   text not null,
  consent_doc_path     text not null,
  active               boolean not null default true,
  set_by               uuid not null references public.users(id),
  set_at               timestamptz not null default now(),
  cleared_by           uuid references public.users(id),
  cleared_at           timestamptz,
  constraint wpn_payee_name_len    check (length(payee_name) <= 120),
  constraint wpn_relationship_len  check (length(payee_relationship) <= 60),
  constraint wpn_bank_name_len     check (length(payee_bank_name) <= 120),
  constraint wpn_account_no_shape  check (payee_account_number ~ '^[0-9]{6,20}$'),
  constraint wpn_account_name_len  check (length(payee_account_name) <= 120),
  constraint wpn_consent_len       check (length(consent_doc_path) <= 500),
  constraint wpn_cleared_shape     check (active = (cleared_at is null)
                                          and (cleared_at is null) = (cleared_by is null))
);
create unique index wpn_one_active_idx on public.worker_payout_nominee (worker_id)
  where active;
create index wpn_worker_idx on public.worker_payout_nominee (worker_id);

alter table public.worker_payout_nominee enable row level security;
revoke all on table public.worker_payout_nominee from anon, authenticated;
-- No authenticated policy: bank PII is DEFINER-only (ADR 0079). Reads go through
-- the RPCs below (procurement_manager) or the PM page's admin client.

-- set_worker_payout_nominee — PM only; validate; clear the prior active row;
-- insert the new active row. Returns the new row id.
create function public.set_worker_payout_nominee(
  p_worker_id           uuid,
  p_payee_name          text,
  p_payee_relationship  text,
  p_payee_bank_name     text,
  p_payee_account_number text,
  p_payee_account_name  text,
  p_consent_doc_path    text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := nullif(btrim(coalesce(p_payee_name, '')), '');
  v_rel    text := nullif(btrim(coalesce(p_payee_relationship, '')), '');
  v_bank   text := nullif(btrim(coalesce(p_payee_bank_name, '')), '');
  v_no     text := nullif(regexp_replace(coalesce(p_payee_account_number, ''), '[\s-]', '', 'g'), '');
  v_holder text := nullif(btrim(coalesce(p_payee_account_name, '')), '');
  v_path   text := nullif(btrim(coalesce(p_consent_doc_path, '')), '');
  v_id     uuid;
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'set_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_worker_id) then
    raise exception 'set_worker_payout_nominee: worker not found' using errcode = 'P0001';
  end if;
  if v_name is null or v_rel is null or v_bank is null or v_no is null or v_holder is null then
    raise exception 'set_worker_payout_nominee: all payee fields required' using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'set_worker_payout_nominee: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'set_worker_payout_nominee: consent photo required' using errcode = 'P0001';
  end if;
  -- Consent folder-pin: nominee-consent/<worker_id>/<file> (2 folder segments;
  -- the new PM-scoped storage policy below gates writes to this prefix).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 2
     or (storage.foldername(v_path))[1] is distinct from 'nominee-consent'
     or (storage.foldername(v_path))[2] is distinct from p_worker_id::text then
    raise exception 'set_worker_payout_nominee: consent path does not match worker/purpose'
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'contact-docs' and o.name = v_path) then
    raise exception 'set_worker_payout_nominee: consent photo not uploaded' using errcode = 'P0001';
  end if;

  -- Clear the prior active nominee (one-active invariant; index backstops the race).
  update public.worker_payout_nominee
     set active = false, cleared_by = v_uid, cleared_at = now()
   where worker_id = p_worker_id and active;

  insert into public.worker_payout_nominee
    (worker_id, payee_name, payee_relationship, payee_bank_name,
     payee_account_number, payee_account_name, consent_doc_path, set_by)
  values (p_worker_id, v_name, v_rel, v_bank, v_no, v_holder, v_path, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.set_worker_payout_nominee(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_worker_payout_nominee(uuid, text, text, text, text, text, text) to authenticated;

-- clear_worker_payout_nominee — PM only; flip the active row to cleared. Idempotent.
create function public.clear_worker_payout_nominee(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'clear_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  update public.worker_payout_nominee
     set active = false, cleared_by = auth.uid(), cleared_at = now()
   where worker_id = p_worker_id and active;
end;
$$;
revoke all on function public.clear_worker_payout_nominee(uuid) from public, anon;
grant execute on function public.clear_worker_payout_nominee(uuid) to authenticated;

-- get_worker_payout_nominee — PM only; the active nominee for one worker (0-or-1).
create function public.get_worker_payout_nominee(p_worker_id uuid)
returns table (
  payee_name           text,
  payee_relationship   text,
  payee_bank_name      text,
  payee_account_number text,
  payee_account_name   text,
  consent_doc_path     text,
  set_at               timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'get_worker_payout_nominee: role not permitted' using errcode = '42501';
  end if;
  return query
    select n.payee_name, n.payee_relationship, n.payee_bank_name, n.payee_account_number,
           n.payee_account_name, n.consent_doc_path, n.set_at
    from public.worker_payout_nominee n
    where n.worker_id = p_worker_id and n.active;
end;
$$;
revoke all on function public.get_worker_payout_nominee(uuid) from public, anon;
grant execute on function public.get_worker_payout_nominee(uuid) to authenticated;

-- list_active_payout_nominees — PM only; the soft worklist (age = days on nominee).
-- Returns worker_id only; the UI resolves name/PRC-code via the badge-codes seam.
create function public.list_active_payout_nominees()
returns table (
  worker_id            uuid,
  payee_name           text,
  payee_bank_name      text,
  payee_account_number text,
  set_at               timestamptz,
  days_active          int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_user_role() = 'procurement_manager', false) is not true then
    raise exception 'list_active_payout_nominees: role not permitted' using errcode = '42501';
  end if;
  return query
    select n.worker_id, n.payee_name, n.payee_bank_name, n.payee_account_number, n.set_at,
           (now()::date - n.set_at::date)::int as days_active
    from public.worker_payout_nominee n
    where n.active
    order by (now()::date - n.set_at::date) desc;
end;
$$;
revoke all on function public.list_active_payout_nominees() from public, anon;
grant execute on function public.list_active_payout_nominees() to authenticated;

-- Storage: new PM-scoped INSERT policy for the consent photo. The spec 298
-- capture path (sa-bank-capture/…) is site_admin/super_admin-scoped, so a PM
-- cannot reuse it. No authenticated SELECT policy matches this prefix => the
-- uploader cannot read it back; the PM surface reads via the service-role
-- signed-URL reader. (Second danger-path surface — call out in the PR.)
create policy "nominee-consent uploads by procurement_manager"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'nominee-consent'
    and coalesce(public.current_user_role() = 'procurement_manager', false));
```

- [ ] **Step 4 — Apply + regenerate types.** `pnpm db:push` (auto-Y on this box), then `pnpm db:types` (regenerates `src/lib/db/database.types.ts` — needed for U2 typing).
- [ ] **Step 5 — Run the test, verify GREEN.** `pnpm db:test 320-payout-nominee` → 16/16. (Re-run once on a pooler/circuit-breaker flake; a NEW file must pass — do NOT add it to `known-red.json`.)
- [ ] **Step 6 — Gate-check the guards.** `pnpm typecheck && pnpm lint` (regen types compile). Confirm `pnpm db:test` full suite has no NEW red beyond the pinned 200/221.
- [ ] **Step 7 — Ship U1** via `ship-unit` (commit `feat(payroll): worker_payout_nominee + PM RPCs (spec 320 U1)`; PR held — migration danger-path; self-merge on green under the additive-migration grant, or operator merge). If Step 0 forced a new storage INSERT policy, call it out in the PR body (extra danger-path surface).

---

## Task U2 — PM surface: worklist + add/edit form

**Files:**

- Create: `src/lib/payroll/payout-nominee.ts` — server readers `listActivePayoutNominees()` + `getWorkerPayoutNominee(workerId)` (wrap the RPCs) + the age-threshold constant.
- Create: `src/app/settings/payout-nominees/page.tsx` — the worklist (PM-gated).
- Create: `src/app/settings/payout-nominees/edit/page.tsx` — the add/edit form page (PM-gated).
- Create: `src/components/features/payroll/payout-nominee-form.tsx` — `PayoutNomineeForm` (client; payee inputs + required consent upload).
- Create: `src/app/settings/payout-nominees/actions.ts` — `setPayoutNominee(...)` + `clearPayoutNominee(workerId)` server actions.
- Modify: `src/lib/i18n/labels.ts` — additive, distinct keys.
- Modify: the nav-back-affordance guard list (spec 63) — classify both new `page.tsx` routes.
- Test: `tests/unit/payout-nominee-form.test.tsx`, `tests/unit/payout-nominee-worklist.test.tsx`.

**Interfaces:**

- Consumes (U1): `set_worker_payout_nominee`, `clear_worker_payout_nominee`, `get_worker_payout_nominee`, `list_active_payout_nominees`. Worker name/code via the existing `src/lib/muster/badge-codes.ts` service-role seam (spec 306).
- `listActivePayoutNominees() → Array<{ workerId; payeeName; payeeBankName; accountNumber; setAt; daysActive }>`.
- `getWorkerPayoutNominee(workerId) → { payeeName; relationship; bankName; accountNumber; accountName; consentDocPath; setAt } | null`.
- `setPayoutNominee(input) → { ok: true } | { ok: false; error: string }` where `input = { workerId; payeeName; relationship; bankName; accountNo; accountName; attachmentId; ext }`.
- `clearPayoutNominee(workerId) → { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1 — RED: form test.** `tests/unit/payout-nominee-form.test.tsx`: render `PayoutNomineeForm`; assert (a) submitting with no consent photo shows the validation error `"กรุณาแนบรูปหนังสือยินยอม"`; (b) submitting with a non-numeric account number shows the account error. Run `pnpm test payout-nominee-form` → FAIL (module missing). **State: "Writing failing test first."**
- [ ] **Step 2 — RED: worklist test.** `tests/unit/payout-nominee-worklist.test.tsx`: given a fake `listActivePayoutNominees` returning one row `daysActive: 60`, the worklist renders the worker (name resolved via a mocked badge seam) + a `บนบัญชีตัวแทน 60 วัน` chip with the over-threshold (danger) class. Run → FAIL.
- [ ] **Step 3 — Readers.** Create `src/lib/payroll/payout-nominee.ts`:

```ts
import "server-only";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

// Spec 320 — soft-worklist reclaim threshold (display-only; no enforcement).
export const PAYOUT_NOMINEE_STALE_DAYS = 45;

export async function listActivePayoutNominees(supabase: ServerClient) {
  const { data } = await supabase.rpc("list_active_payout_nominees");
  return (data ?? []).map((r) => ({
    workerId: r.worker_id,
    payeeName: r.payee_name,
    payeeBankName: r.payee_bank_name,
    accountNumber: r.payee_account_number,
    setAt: r.set_at,
    daysActive: r.days_active,
  }));
}

export async function getWorkerPayoutNominee(supabase: ServerClient, workerId: string) {
  const { data } = await supabase.rpc("get_worker_payout_nominee", { p_worker_id: workerId });
  const row = Array.isArray(data) ? data[0] : null;
  return row
    ? {
        payeeName: row.payee_name,
        relationship: row.payee_relationship,
        bankName: row.payee_bank_name,
        accountNumber: row.payee_account_number,
        accountName: row.payee_account_name,
        consentDocPath: row.consent_doc_path,
        setAt: row.set_at,
      }
    : null;
}
```

- [ ] **Step 4 — Actions.** Create `src/app/settings/payout-nominees/actions.ts`. `setPayoutNominee`: `getClaims` → require `current_user_role() === 'procurement_manager'` (defense-in-depth; the RPC re-gates); rebuild the consent path server-side via the spec-298 capture-path helper (`buildWorkerCapturePath(workerId, "nominee_consent", attachmentId, ext)` — confirm the helper name in U1 Step 0; if 298 exposes a different builder, reuse it); `supabase.rpc("set_worker_payout_nominee", { p_worker_id, p_payee_name, p_payee_relationship, p_payee_bank_name, p_payee_account_number, p_payee_account_name, p_consent_doc_path })`; map the PG error to a friendly `{ ok:false, error }` (reuse spec 319's action error-map). `clearPayoutNominee`: same gate → `rpc("clear_worker_payout_nominee", { p_worker_id })`. Both `revalidatePath("/settings/payout-nominees")`.
- [ ] **Step 5 — Form.** Create `src/components/features/payroll/payout-nominee-form.tsx` (`'use client'` — justify in PR: file upload + client validation). Clone the consent-upload flow from spec 319's `user-bank-change-form.tsx` (`preparePhotoForUpload`, upload to `CONTACT_DOCS_BUCKET`, pass `attachmentId`+`ext` to the action). Fields: worker (hidden/prefilled from the page), payee name, relationship, bank (`BankSelect`), account number, account name, and the required consent photo. Inline PromptPay-first hint text. Validation: consent required, account numeric.
- [ ] **Step 6 — Edit page.** Create `src/app/settings/payout-nominees/edit/page.tsx`: `getClaims` → if `current_user_role() !== 'procurement_manager'` redirect to `roleHome(role)`; read `?worker=` (worker picker if absent — reuse an existing worker-picker component, else a simple select fed by the badge seam); prefill via `getWorkerPayoutNominee`; render `<PageShell>` + `<DetailHeader backHref="/settings/payout-nominees" backLabel="กลับ">` + `<PayoutNomineeForm workerId={…} initial={…} />`.
- [ ] **Step 7 — Worklist page.** Create `src/app/settings/payout-nominees/page.tsx`: same PM redirect gate; `listActivePayoutNominees` → resolve each `workerId` to name + PRC code via `badge-codes.ts`; render rows (worker name + code, payee name + masked account, `บนบัญชีตัวแทน {daysActive} วัน` chip — danger token class when `daysActive >= PAYOUT_NOMINEE_STALE_DAYS`), a `ล้างบัญชีตัวแทน` button per row (calls `clearPayoutNominee`), and an `เพิ่มบัญชีตัวแทน` link → `/settings/payout-nominees/edit`. Empty state `"ยังไม่มีช่างที่ใช้บัญชีตัวแทน"`.
- [ ] **Step 8 — Labels.** Append to `labels.ts` (distinct keys): `PAYOUT_NOMINEE_TITLE = "บัญชีตัวแทนรับเงิน (ชั่วคราว)"`, `PAYOUT_NOMINEE_ADD = "เพิ่มบัญชีตัวแทน"`, `PAYOUT_NOMINEE_CLEAR = "ล้างบัญชีตัวแทน"`, `PAYOUT_NOMINEE_EMPTY = "ยังไม่มีช่างที่ใช้บัญชีตัวแทน"`, `PAYOUT_NOMINEE_AGE = "บนบัญชีตัวแทน {n} วัน"` (or an equivalent formatter), `PAYOUT_NOMINEE_CONSENT_REQUIRED = "กรุณาแนบรูปหนังสือยินยอม"`, `PAYOUT_NOMINEE_PROMPTPAY_HINT = "ถ้าช่างมีพร้อมเพย์ ให้ลงทะเบียนบัญชีตัวเองแทนการใช้บัญชีตัวแทน"`.
- [ ] **Step 9 — Guards.** Classify `/settings/payout-nominees` and `/settings/payout-nominees/edit` in the nav-back-affordance guard list (spec 63 — a new `page.tsx` trips it, per the spec 298 lesson). If the settings surface trips the danger-path guard, note it for operator-merge.
- [ ] **Step 10 — GREEN.** `pnpm test payout-nominee && pnpm lint && pnpm typecheck` all green.
- [ ] **Step 11 — Real-flow verify** (dev-preview, memory `dev-preview-login`; sign in as a **procurement_manager** — impersonate/view-as if no direct login): `/settings/payout-nominees` empty state → เพิ่มบัญชีตัวแทน → pick a bankless worker, fill payee + attach a consent image → submit → the worker shows on the worklist with `บนบัญชีตัวแทน 0 วัน`. Re-set a second nominee for the same worker → still one row. `ล้างบัญชีตัวแทน` → drops off. As a **non-PM** role, `/settings/payout-nominees` redirects home. Zero console errors. Screenshot.
- [ ] **Step 12 — Ship U2** via `ship-unit` (code-only; auto-merge on green — but two new settings `page.tsx` + a payroll-adjacent surface; if the danger-path guard holds it, operator-merge). **Do not merge to a live-payout environment before the spec _Precondition_ nod.**

---

## Self-review (against the spec)

- **Coverage:** `worker_payout_nominee` + 4 PM RPCs + pgTAP → U1. Worklist (age chip) + add/edit form (consent upload) + per-row clear + PromptPay hint + PM gate → U2. Disbursement consumer + worker-detail indicator + office-tier nominee are spec-declared **out of scope** (spec 128 blocked / deferred) — no task, by design.
- **Placeholder scan:** the one live-dependent value is the spec-298 storage path (folder-pin + `buildWorkerCapturePath` name) — bounded by U1 Step 0's gate-check with an explicit "align to 298" instruction and a concrete default, not a bare TODO.
- **Type consistency:** RPC arg names `p_worker_id / p_payee_* / p_consent_doc_path` identical in U1 SQL and the U2 action; reader shapes (`listActivePayoutNominees` / `getWorkerPayoutNominee`) and action signatures (`setPayoutNominee` / `clearPayoutNominee`) stable across U1→U2; the one-active invariant asserted in U1 pgTAP (Step 1.6) matches the clear-then-insert in the SQL and the "still one row" real-flow check in U2 Step 11.
- **Attribution invariant:** the nominee never touches wage/WHT/GL — this spec adds only a routing record + PM surface; the ledger stays per-worker (the disbursement snapshot that makes it durable is spec 128, out of scope). Consistent with the spec's _Problem_ section.
- **No new enum, gate = `procurement_manager` only** (not the trio), consent required + folder-pinned + existence-checked — matches Global Constraints and the operator's "only procurement manager, manual, temporary" decision.

```

```
