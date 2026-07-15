# Spec 320 — Temporary payout nominee (PM-managed, bridge measure)

**Status:** 📝 DESIGN — approved in chat 2026-07-15. **BUILD HELD** pending one operator
sign-off (accountant / labor stance on third-party wage discharge — see _Precondition_ below).
Data-model + PM-UI units are buildable the moment that nod lands; no code moves money.
**Requested by:** operator, 2026-07-15 — "Not every employee has bank accounts, they requested
to bundle transfer with their friends or family."
**Operator decisions (2026-07-15, in-chat):**

- **Temporary bridge only.** Workers are given a grace period to register their _own_ account;
  the nominee is not a permanent home.
- **`procurement_manager` only, manual.** No worker self-service, no staged approval — the PM
  enters and clears nominees directly. (Explicitly _only_ PM, not the staff trio.)
- **Reclaim = soft worklist** (chosen over a hard expiry / warn-only date): the PM sees a list
  of workers on a nominee with an **age** (days since set) and chases them down manually. No
  auto-block, no payout disruption. The age column is the pressure.
- **PromptPay-first** (population shrink, policy not schema): before recording a nominee, prefer
  routing the worker to register their _own_ PromptPay (phone / national ID) in their own worker
  bank home — most "no bank account" workers can receive to PromptPay cross-bank. The nominee is
  the genuine remainder only.

## Problem (grounded 2026-07-15)

Payout bank is **1:1 with the person paid**: a worker's account lives on `workers.bank_*`
(worker bank home), office logins on `user_bank` (spec 319). There is no way to route worker A's
wage to a _different_ person's account. Some field workers (mostly DC — paid directly, daily,
per the pay model; some `own` staff too) have **no bank account** and have asked to receive their
wage into a friend's / family member's account until they open their own.

The disbursement itself does not block this — the pay model's money-out is a **KBank bulk file**
(spec 128) whose every line is just `account# + name + amount`, so the destination account is
plain data. The hard part is **not** the file; it is **discharge, consent, and attribution**:

- **Discharge / consent** — if PRC pays a cousin's account and the worker later says "I never got
  paid", PRC must prove the worker _authorized_ that account. → a signed authorization per worker,
  stored as evidence.
- **Attribution** — wage, WHT, and GL must stay booked **per worker** (A owes tax, A is the labor
  cost), never merged into the nominee. The nominee swaps only the **bank line**, never the ledger.

The dangerous shape to avoid is _sum several workers into one account with no per-worker consent_ —
it destroys discharge proof and tax attribution and reads as labor-broker skimming. This spec makes
each nominee a **per-worker, per-worker-consented** routing override; two workers _may_ point at the
same account, but each carries its own authorization and its own ledger line.

### Precondition (operator / accountant — BUILD gate, not a code question)

Paying a third party's account touches labor law (wage must reach the worker), WHT attribution, and
PDPA (PRC stores a non-employee's name + bank + consent). Before U2 goes live, confirm:

1. A **per-worker signed authorization** is acceptable as wage discharge to the accountant / labor
   stance.
2. WHT stays filed under the **worker**, not the nominee.

U1 (schema) + U2 (PM UI) can be _built_ and reviewed against this spec; flipping the feature on for
real payouts waits on (1)+(2).

## Design — a PM-managed routing override on the worker, with consent evidence

A nominee is **not** a fourth bank home and **not** a staged change-request (there is no worker
self-service and no approval step — the PM _is_ the authority, spec-319 trio deliberately narrowed
to the single `procurement_manager`). It is a small, PM-written **override record** attached to a
worker, carrying the consent evidence and its own set/clear provenance, read at disbursement time.

### Data model

- **`worker_payout_nominee`** — the payout override for a worker. **Append-history**: a new active
  row per nominee; clearing flips the active row to cleared (never deleted) so the change history is
  its own audit trail (no `audit_action` enum touched).
  - `id uuid pk default gen_random_uuid()`
  - `worker_id uuid not null references public.workers(id)` — the person **owed** the wage.
  - `payee_name text not null` — the account holder (the friend / family member).
  - `payee_relationship text not null` — free text (`พี่ชาย`, `คู่สมรส`, …); descriptive, not a
    status, so text is correct.
  - `payee_bank_name text not null` — bank, or `พร้อมเพย์ (PromptPay)` when the nominee account is a
    PromptPay proxy (the bulk-file rail is derived from this string at spec-128 build; the nominee
    table stays rail-agnostic — no new enum).
  - `payee_account_number text not null` — normalized `[\s-]`-stripped; a bank account **or** a
    PromptPay ID (phone / national ID). CHECK `^[0-9]{6,20}$` (covers 10-digit phone, 13-digit
    citizen-ID, and bank account numbers).
  - `payee_account_name text not null` — the name as it appears on the destination account.
  - `consent_doc_path text not null` — storage path of the signed authorization photo (discharge
    evidence). Required — a nominee with no consent cannot be created.
  - `active boolean not null default true`
  - `set_by uuid not null references public.users(id)`, `set_at timestamptz not null default now()`
  - `cleared_by uuid references public.users(id)`, `cleared_at timestamptz`
  - CHECK `nominee_cleared_shape`: `(active) = (cleared_at is null)` — an active row has no
    clear-stamp; a cleared row has both `cleared_by` and `cleared_at`.
  - CHECK length floors on the text fields (mirror `ub_*` / `ubcr_*` in spec 319).
  - **Unique one-active** partial index `(worker_id) where active` — a worker has at most one active
    nominee; the RPC clears the prior active row before inserting a new one (atomic, index-backed).
  - **Zero-grant** (`revoke all … from anon, authenticated`; RLS enabled, no `authenticated`
    policies) — this is bank PII, ADR 0079 posture, identical to every bank table. All reads go
    through the DEFINER readers below or the PM surface's admin client.

### RPCs (DEFINER, `set search_path = public`, gated to `procurement_manager` only)

The gate is `coalesce(public.current_user_role() = 'procurement_manager', false) is not true` →
`42501` (coalesce-to-false so an unbound caller never trips the gate open — the RLS self-check
coalesce trap). **Not** the trio — operator said only the PM.

- **`set_worker_payout_nominee(p_worker_id uuid, p_payee_name text, p_payee_relationship text, p_payee_bank_name text, p_payee_account_number text, p_payee_account_name text, p_consent_doc_path text) → uuid`**
  - PM-gate; `p_worker_id` must exist in `workers`;
  - all fields required (nullif/btrim); account number normalized + `^[0-9]{6,20}$`;
  - **consent required**: `p_consent_doc_path` present + folder-pin to `nominee-consent/<worker_id>/`
    (the new PM-scoped path — see _Storage_) + existence check against `storage.objects`
    (dangling-evidence guard, as spec 319 does for passbooks);
  - **clear-then-insert** in one statement: `update worker_payout_nominee set active=false,
cleared_by=auth.uid(), cleared_at=now() where worker_id=p_worker_id and active`, then insert the
    new active row with `set_by = auth.uid()`; return its id. (The unique-one-active index backstops
    the race.)
- **`clear_worker_payout_nominee(p_worker_id uuid) → void`**
  - PM-gate; flip the active row (if any) to cleared (`cleared_by=auth.uid()`, `cleared_at=now()`).
    Idempotent — no active row is a no-op, not an error. Used when the worker registers their own
    account (the reclaim action).
- **`get_worker_payout_nominee(p_worker_id uuid) → table(payee_name, payee_relationship, payee_bank_name, payee_account_number, payee_account_name, consent_doc_path, set_at)`**
  - PM-gate; the active nominee for one worker (the edit-form prefill + worker-context read). Empty
    when none.
- **`list_active_payout_nominees() → table(worker_id uuid, payee_name text, payee_bank_name text, payee_account_number text, set_at timestamptz, days_active int)`**
  - PM-gate; **the soft worklist**. Every worker with an active nominee, with
    `days_active = (now()::date - set_at::date)` as the age-pressure column. Ordered
    `days_active desc` (longest-on-nominee first — the ones to chase). The RPC returns `worker_id`
    only; U2 resolves each worker's display name + PRC code through the **existing badge-codes
    service-role seam** (`src/lib/muster/badge-codes.ts`, spec 306 — the established PII-safe way to
    read workers name/code), so this spec adds no new coupling to `workers` PII columns.

### Storage — a new PM-scoped INSERT policy (gate-check resolved 2026-07-15)

The consent authorization photo is **PM-uploaded, about a worker**. The spec 298 capture path
(`sa-bank-capture/…`, `075720`) was the candidate to reuse, but its INSERT policy is scoped to
**`site_admin`/`super_admin`** (verified live) — a `procurement_manager` cannot write there. So U1
adds a **new `procurement_manager`-scoped INSERT-only policy** on `contact-docs`:

```sql
create policy "nominee-consent uploads by procurement_manager" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'nominee-consent'
    and coalesce(public.current_user_role() = 'procurement_manager', false));
```

Path shape `nominee-consent/<worker_id>/<file>` (2 folder segments). No `authenticated` SELECT
policy matches this prefix → the uploader cannot read it back; the PM surface views the photo via the
page's existing **service-role** signed-URL reader. This adds a second danger-path surface to U1's
migration (a storage RLS policy) — call it out in the PR body.

### UI / routes

- **`/settings/payout-nominees`** (NEW, `procurement_manager`-gated; unserved roles → their role
  home) — the PM surface, two parts on one page:
  - **The worklist** — `list_active_payout_nominees()` rendered as rows: worker name + PRC code,
    payee name + masked account, and a **`บนบัญชีตัวแทน N วัน`** age chip (red past a soft threshold,
    e.g. ≥ 45 days — display-only, no enforcement). A **`ล้างบัญชีตัวแทน`** (clear) action per row →
    `clear_worker_payout_nominee` (the reclaim, used when the worker registers their own account).
  - An **`เพิ่มบัญชีตัวแทน`** entry → the add/edit form on its own route (edit ≠ list, the standing
    IA rule).
- **`/settings/payout-nominees/edit?worker=<id>`** (NEW) — the add/edit form: a worker picker (or
  pre-filled from `?worker=`), payee name / relationship / bank / account number / account name
  inputs, and the **required consent-photo upload**. Submit → `set_worker_payout_nominee` → back to
  the worklist. Prefill an existing active nominee via `get_worker_payout_nominee`. A short inline
  **PromptPay-first hint** ("ถ้าช่างมีพร้อมเพย์ ให้ลงทะเบียนบัญชีตัวเองแทน") nudges the population down.

## Units

- **U1 — schema + RPCs + pgTAP** (migration `075801`, single schema lane, PR **held** — migration is
  danger-path). `worker_payout_nominee` + `set_/clear_/get_worker_payout_nominee` +
  `list_active_payout_nominees`, all PM-gated. **No new enum.** Storage: reuse the spec 298 capture
  path (gate-checked Step 1) or add a PM-scoped INSERT policy (danger-path, flagged). pgTAP
  `320-payout-nominee`: PM-only gate on every RPC (non-PM → 42501); set floors (missing field / bad
  account / missing consent / dangling consent / wrong-folder consent); unknown worker refused;
  set clears the prior active row (one-active invariant); clear is idempotent;
  `get`/`list` return the active row(s) with correct `days_active`; RLS — a plain `authenticated`
  (non-PM) select on `worker_payout_nominee` sees **zero** rows (bank-PII wall).
- **U2 — PM surface** (`/settings/payout-nominees` worklist + `/edit` form; code-only). The worklist
  from `list_active_payout_nominees`, the age chip, the clear action, the add/edit form + consent
  upload wired to `set_worker_payout_nominee`, the PromptPay-first hint. `procurement_manager` route
  gate. Labels additive/distinct in `labels.ts`. New `page.tsx` × 2 → classify both in the
  nav-back-affordance guard (spec 63 lesson).

## Out of scope / integration points (deferred)

- **Disbursement consumption (the payout hook).** When the spec 128 KBank bulk-file builder (or any
  payment-recording surface, spec 127) runs for a worker with an **active** nominee, it must (a) use
  the nominee's account as the destination line and (b) **snapshot** `{payee_name, account,
nominee_id}` onto the immutable payment/ledger row — that snapshot is the permanent discharge
  proof, and it keeps `worker_payout_nominee` a mere current-routing hint. **Spec 128 is blocked on
  the operator's K BIZ sample file** — so this hook lands there, not here. Spec 320 delivers the data
  - PM capture + worklist so nominees are ready when 128 builds.
- **Office-tier nominees.** Office / admin logins (`user_bank`, spec 319) are on company payroll with
  their own accounts; no nominee for them. If ever needed, a parallel `user_payout_nominee` — its own
  spec.
- **Worker-detail read-only indicator** ("จ่ายเข้าบัญชีตัวแทน") on the worker profile — nice-to-have,
  not this pass.
- **Auto-expiry / hard reclaim** — deliberately rejected (soft worklist chosen). No scheduled job.

## Verification

- pgTAP `320-payout-nominee` green (new file; not a known-red).
- Real-flow (dev-preview, memory `dev-preview-login`): sign in as **procurement_manager** →
  `/settings/payout-nominees` (empty worklist) → เพิ่มบัญชีตัวแทน → pick a bankless worker, fill
  payee + upload the signed consent → submit → the worker appears on the worklist with a
  `บนบัญชีตัวแทน 0 วัน` chip. Set a second nominee for the same worker → the worklist still shows one
  row (prior cleared). `ล้างบัญชีตัวแทน` → the worker drops off the list. Sign in as a **non-PM**
  role → `/settings/payout-nominees` is not reachable (routed home) and a direct
  `worker_payout_nominee` select returns nothing.
- `pnpm lint && pnpm typecheck && pnpm test` green.
