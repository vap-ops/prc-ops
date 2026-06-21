# ADR 0062 — A DC is a worker, not a contractor party

## Status

Proposed (2026-06-21). Pending operator go-ahead to start the units. Extends/relifts
ADR 0051 (external partner portal), ADR 0055 (equipment owners — unrelated party
table), ADR 0060/0061 (Nova economics), and specs 46 (workers) · 69 (payroll) ·
127 (DC payments) · 130/131 (contractor portal) · 160 (worker→project) · 168 (split
/contacts/dc). Supersedes the spec-168 treatment of DC as a contact directory.

## Context

The operator (2026-06-21): _"DC is confusing again, recheck DC in setting."_ Asked
how deep to fix it, they chose **"rethink the DC model"** and stated the decisive
domain fact:

> **"There is no DC firm — we do not hire DC from companies, we only hire
> directly."**

Today, "DC" (direct contractor — paid directly, daily) is modelled by **two**
entities (see `docs/design/dc-model-rethink.md` for the full map):

- **`contractors`** (`contractor_category='dc'`, `contractor_subtype ∈
{dc_company, dc_regular, dc_temporary}`) — the **party**. Payment
  (`dc_payments.contractor_id`), portal binding (`contractor_users.contractor_id`),
  and the Nova "external" flag (`contractor_subtype='dc_temporary'`) all key here.
- **`workers`** (`worker_type='dc'`, `contractor_id` → the party, `day_rate`,
  `level`, `user_id`, `project_id`) — the **individual**. Rate, labor logging, and
  Nova level live here.

Because a DC is hired as a person, an _individual_ DC must be created **twice** —
a `contractors` row (to be paid / get portal / carry the external flag) **and** a
`workers` row (to carry a rate / be logged) — under two ตั้งค่า doors both labelled
around "DC". `dc_company` is meaningless (there are no DC firms), and the subtype
jams _firm-vs-individual_ together with _permanent-vs-temporary_.

**Live-data finding (2026-06-21, queried against prod):** `workers` = **0 rows**,
`contractors` with `category='dc'` = **0**, `dc_payments` = **0**,
`contractor_users` = **0** (the only contractors are 2 subcontractors). The
DC-party machinery is **unused in production** — so this reshape carries **no data
migration risk**; it is the right moment to do it cleanly, before real DC data
exists.

## Decision

**A DC is a `worker`.** There is no DC contractor party.

1. The **`workers` row is the single, canonical record** for a DC person. It
   carries everything a DC needs: name, **arrangement** (ประจำ regular /
   ชั่วคราว temporary), status, `day_rate`, `level`, portal link (`user_id`),
   `project_id`, and payee identity.

2. **`contractors` is only for ผู้รับเหมาช่วง (subcontractors)** —
   `category='contractor'`, the one real "firm / party that pays its own crew"
   concept (ADR 0051 / spec 168). DC no longer uses the `contractors` table.

3. **Repoint the three party-keyed concerns onto the worker:**
   - **Payment** — `dc_payments` keys on `worker_id` (was `contractor_id`); the
     payee is the DC person.
   - **Portal** — a DC person's self-service binds on `workers.user_id` (which
     already exists), replacing the `contractor_users` binding for the DC tier.
   - **Nova "external"** — derived from the worker's arrangement
     (`= temporary`), replacing `contractor_subtype='dc_temporary'`.

4. **The DC ⇄ contractor link is removed.** `dc_regular` / `dc_temporary` /
   `dc_company` subtypes and the `contractor_category='dc'` usage are retired
   (enum _values_ may remain unused — dropping a Postgres enum value is avoided,
   per ADR 0008 precedent — but nothing writes them). The arrangement moves to a
   new `workers` column.

5. **UI collapses to one DC home.** `/contacts/dc` (the spec-168 DC contact
   directory) and its ตั้งค่า door are **removed**; DC people are created and
   managed in the worker roster (`/workers`, "ทีมงาน") — directly, no parent
   picker. ตั้งค่า keeps one DC door (the roster). `/contacts/subcontractors`
   (ผู้รับเหมาช่วง) is unaffected.

## Consequences

- **One record per DC person** — no double entry, one door. The mental model
  matches reality ("we hire people directly").
- **Money + portal + economics move tables** (`contractor_id` → `worker_id`).
  Because production has **zero** DC rows/payments/bindings, this is a code
  reshape with no backfill — but it still touches money (`dc_payments`), the live
  portal RLS (ADR 0051), and Nova (`distribute_project_coins`), so each unit is
  flagged, TDD'd, and pgTAP-covered before `db:push`.
- **`/contacts/dc` is reverted** (added only the same day in spec 168). Spec 168's
  subcontractor split stands; only its DC half is folded into the worker roster.
- The `contractor`-tier user role + portal stay (ADR 0051) but now bind a DC
  _worker_ rather than a _contractor_ row; RLS portal policies change.

## Units (proposed — built one per session, flagged, TDD + pgTAP)

- **U1 — worker becomes a self-sufficient DC.** Add `workers.dc_arrangement`
  (`regular` | `temporary`, nullable — only meaningful for `worker_type='dc'`)
  and the **payee fields** (operator 2026-06-21: add now): `phone`, `tax_id`,
  `bank_name`, `bank_account_number`, `bank_account_name`. The **bank + tax**
  columns are **money-sensitive → zero authenticated grant**, read only via the
  admin client behind `requireRole(pm/super)` or by the owner on the portal —
  the `day_rate` isolation pattern (spec 46 C3), NOT broadly-SELECTable like
  name. `create_worker` / `update_worker` accept the new fields; **drop the
  contractor-parent requirement for DC creation** (`worker_type='dc'` with null
  `contractor_id` is valid — spec 160 already nulled the column + dropped the
  CHECK), and remove the ผู้รับเหมา parent picker from `/workers`. Status stays
  the existing `active` boolean (operator: active/inactive is enough — no
  probation/blacklist on workers). Additive migration; nothing removed yet, so
  payment/portal/Nova (still party-keyed) keep working until U2–U4 repoint them.
- **U2 — repoint Nova "external"** from `contractor_subtype='dc_temporary'` to
  `worker.dc_arrangement='temporary'` in `distribute_project_coins`; update
  pgTAP 106.
- **U3 — repoint DC payment** `dc_payments` → `worker_id`; update
  `record_dc_payments`, `/payroll`, `fetch-payroll`, pgTAP 35.
- **U4 — repoint the portal** to `workers.user_id` (DC self-service binds a
  worker); update ADR-0051 RLS policies + portal loaders; pgTAP 38.
- **U5 — remove the DC contact surface.** Delete `/contacts/dc` + its door + the
  `dc` ContactsTabs machinery; stop writing `contractor_category='dc'` /
  `contractor_subtype`; settings shows one DC door (the roster). Update spec-168
  tests.
- **U6 — labels + cleanup.** "DC" wording pass; retire `contractor_users` for DC
  if fully unused.

## Open questions — resolved (operator, 2026-06-21)

1. **Payee/bank fields on the worker:** YES, add now — `tax_id` + bank
   (`bank_name`, `bank_account_number`, `bank_account_name`), money-isolated.
2. **Status:** the existing `active` boolean is sufficient — no
   probation/blacklist on workers.
