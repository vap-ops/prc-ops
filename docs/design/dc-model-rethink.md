# Design proposal — rethink the DC model (DC is confusing in ตั้งค่า)

**Status:** RESOLVED → **ADR 0062** (2026-06-21). Operator chose **unify the data**
and confirmed **"there is no DC firm — we hire DC directly"**, so the target is
"DC = a worker, no contractor party." This file is the analysis; the decision +
unit plan live in `docs/decisions/0062-dc-is-a-worker.md`. (Option A in §Options.)
**Trigger:** operator (2026-06-21): _"DC is confusing again, recheck DC in setting"_ →
chose **"rethink the DC model"** over relabel/regroup.
**Relates to:** spec 168 (split crews → /contacts/dc + /contacts/subcontractors),
spec 46/69/127 (workers, payroll, DC payments), spec 130/131 (contractor portal),
spec 160 (worker→project), spec 161 / ADR 0060 (Nova economics), [[pay-model]].

## Current model (what's actually there)

Two tables model "DC" (direct contractor — paid directly, daily):

- **`contractors`** = the **party** you engage. `contractor_category='dc'`,
  `contractor_subtype ∈ {dc_company, dc_regular, dc_temporary}`, + contact info,
  status, tax id. Surfaced at **/contacts/dc**.
- **`workers`** = the **individual** person. `worker_type='dc'`, `contractor_id`
  → parent party (nullable since spec 160), `day_rate`, `level`, `user_id`,
  `project_id`. Surfaced at **/workers** (รายชื่อทีมงานและค่าแรง).

What keys on which entity today:

| Concern                          | Keyed on                                        | Where                           |
| -------------------------------- | ----------------------------------------------- | ------------------------------- |
| Daily wage rate                  | **worker** (`day_rate`)                         | /workers, `set_worker_day_rate` |
| Labor logging on a WP            | **worker** (`worker_id`)                        | `log_labor_day`, roster picker  |
| Nova level / coin share          | **worker** (`level`)                            | `distribute_project_coins`      |
| **Payment** (DC wage payout)     | **party** (`contractor_id`)                     | `record_dc_payments`, /payroll  |
| **Portal** access (self-service) | **party** (`contractor_users.contractor_id`)    | /portal                         |
| **Nova "external"** flag         | **party** (`contractor_subtype='dc_temporary'`) | coin distribution               |
| Onboarding docs / status         | **party**                                       | /contacts/dc, portal            |

## The problems

1. **Individual DCs are double-entered.** A DC company (firm + crew) maps cleanly:
   party = firm, workers = its people. But an _individual_ DC (one person paid
   daily — the common case) needs a `contractors` row (to be **paid** + get
   **portal** + carry the **dc_temporary/"external"** flag) **and** a `workers`
   row (to carry a **rate** + be **logged**). The same human is created and
   maintained in two places, under two ตั้งค่า doors both labelled around "DC".

2. **Two "DC" doors.** After spec 168, ตั้งค่า shows **DC** (`/contacts/dc`, the
   party directory) and **ทีมงาน** (`/workers`, hint "ทะเบียนทีมงาน DC") side by
   side — indistinguishable to a non-dev.

3. **The subtype mixes two axes.** `dc_company / dc_regular / dc_temporary`
   conflates _firm vs individual_ (บริษัท vs ประจำ/ชั่วคราว) with _permanent vs
   temporary_. And the Nova "external" rule piggybacks on `dc_temporary`, so a
   labeling change risks the economics.

## Options (the depth choice)

### Option B — Unify the **surface**, keep the backend (pragmatic, ship now)

One **DC management surface** instead of two doors. Creating an _individual_ DC is a
**single action** that creates **both** the `contractors` party row and its
`workers` row, linked, and lists them as **one** record. A _DC company_ is created
as a party, then its workers added under it (today's flow, clearly framed). Merge
the two ตั้งค่า doors into one "ทีมงาน DC" area; clarify the subtype into **kind**
(company vs individual). Keep `dc_temporary` as the data value behind a clearer
"external/temporary" toggle so Nova is untouched.

- **Backend:** essentially unchanged (payment, portal, Nova all keep keying on the
  party — which still exists for every DC). Mostly UI + one combined create RPC.
- **Solves:** the operator-visible confusion (one place, one entry, one door).
- **Leaves:** the two-table reality underneath (hidden behind one flow).
- **Risk:** low. No data migration; no change to money/portal/economics keys.

### Option A — Unify the **schema** (deep, worker-centric, phased)

Make the **worker the single record for an individual DC**; the `contractors`
party stays **only for real DC companies**. Repoint **payment**, **portal binding**,
and **Nova "external"** to read from the worker for individuals (e.g. a
`worker.dc_kind`/`is_external` + pay/portal keyed on worker). One human = one row,
always.

- **Solves:** the root cause — no double-entry, ever.
- **Cost:** large, migration-heavy — `dc_payments` FK, `contractor_users` binding,
  `distribute_project_coins` external rule, RLS portal policies, payroll
  aggregation all key on `contractor_id` today and would move. Needs its **own ADR**
  - data migration + phased rollout. Higher risk on money + the live portal.

### Recommendation

**Do Option B now** (it removes the confusion the operator hit, fast and low-risk),
and **only escalate to Option A** if, after B, the operator still wants a true
one-record model. B is reversible and does not foreclose A; A without B first would
be a big bet on the money/portal/economics layer for a mostly-cosmetic complaint.

## If Option B — rough unit breakdown (for a later spec, not built yet)

- U1: a combined `create_dc_individual` RPC (party + worker in one txn, linked) +
  `create_dc_company` framing for the firm case.
- U2: one **/contacts/dc** (or renamed "ทีมงาน DC") surface that lists DC
  companies and DC individuals distinctly, with single-entry add; fold
  `/workers`' DC half in (keep /workers for own-company techs + rates, or merge).
- U3: ตั้งค่า — one DC door; clarify subtype wording (kind = company/individual;
  arrangement = ประจำ/ชั่วคราว) without changing the `dc_temporary` data value Nova
  depends on.
- U4: indicators — show whether a DC individual has a portal account
  (`workers.user_id`) and a rate, so a PM sees the record is complete.

## Open questions for the operator

1. **Depth:** Option B (unify the screen now) or commit to Option A (unify the
   data, bigger)?
2. For an **individual DC**, should `/workers` and `/contacts/dc` become **one**
   screen, or stay two with clearer roles?
3. Is the distinction PRC cares about **company vs individual**, or
   **permanent (ประจำ) vs temporary (ชั่วคราว)**, or both as separate fields?
