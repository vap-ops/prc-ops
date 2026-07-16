# Spec 324 — Receipt Miscount Correction — Implementation Plan

> **For agentic workers:** each unit ships through the repo's `ship-unit` skill (6 gates: lane
> claim → dependency gate-check → RED-first → real-flow verify → fresh-eyes review → prove the
> merge). Steps use checkbox (`- [ ]`) syntax. RED-first is binding — the failing test (pgTAP for
> U1–U4/U7, vitest/RTL + browser for U5/U6) exists and is seen to fail before production code.
>
> **BUILD GATE (danger-path):** U1–U4 and U7 are **schema + GL/RLS** migrations — the danger-path
> guard holds every one. Build and review freely; **merge is operator-gated** (self-merge of an
> _additive_ migration on green is allowed under the standing grant; nothing here is destructive).
> Do NOT expose the UI (U5/U6) until U1–U4 are live, or the SA flag button points at absent RPCs.

**Goal:** Give back-office a sound, append-only way to correct an over-accepted store delivery down
to the true count — contra-ing Inventory **and** supplier AP proportionally — with an SA-raised
in-app flag, restricted to the "fresh pool" window where the correction is provably exact.

**Architecture:** Two new append-only tables (`receipt_correction_requests` = SA flag,
`stock_receipt_corrections` = applied correction) + a back-office DEFINER RPC
`correct_stock_receipt` that removes the surplus from `stock_on_hand` and enqueues a VAT-residual GL
contra (`Cr 1500 / Cr 1300 / Dr 2100`), gated behind a **fresh-pool** precondition (no
issue/return/count on the item since the receipt). SA flag + BO correct/queue UIs. A scheduled
`inventory_1500` integrity tie catches any drift.

**Tech Stack:** Next.js 16 App Router (Server Components; `'use client'` only for the flag/correct
forms), Supabase Postgres + RLS + DEFINER RPCs, `gl_posting_outbox` async drain (pg_cron), pgTAP,
Vitest/RTL, Playwright/browser verify, Tailwind token classes.

## Global Constraints

- **Migrations** (single schema lane — claim lane `324rcv` in `../LANES.md`; the `require-lane-claim`
  hook blocks migration writes otherwise, and always on `main`). Proposed numbers, **confirm live
  `max(version)` at each unit's gate-0 and bump if taken** (head at plan time = `20260813075805`):
  - U1 `20260813075806_spec324u1_receipt_correction_schema.sql`
  - U2 `20260813075807_spec324u2_correct_stock_receipt.sql`
  - U3 `20260813075808_spec324u3_correction_gl_posting.sql`
  - U4 `20260813075809_spec324u4_correction_flag_rpcs.sql`
  - U7 `20260813075810_spec324u7_inventory_1500_integrity.sql`
- **Source DEFINER bodies from LIVE, not a migration file.** For every `CREATE OR REPLACE` of an
  **existing** function (`reverse_stock_receipt`, `drain_gl_posting`, `_integrity_check_results`),
  dump the current body at gate-0 (`pnpm exec supabase db query --linked` /
  `pg_get_functiondef`) and apply the named edit to THAT. Editing an out-of-date copy silently
  reverts other lanes' work ([[prc-ops-db-migration-lessons]]).
- **Null-safe role gate (mandatory).** Every new RPC begins with
  `if v_role is null or v_role not in (...) then raise ... using errcode='42501'` (or
  `coalesce(... , false) is not true`). An unbound caller's NULL must fail **closed** — the RLS
  self-check coalesce trap ([[rls-self-check-coalesce]]).
- **GL contra is VAT-residual.** Compute `Cr 1500 = removed_net` and `Cr 1300 = removed_vat`, then
  `Dr 2100 = Cr1500 + Cr1300` (residual). **Never** round three legs independently — a 1-satang
  imbalance makes `post_journal_internal` raise, the drain marks the job `failed` (never retried),
  and stock/GL diverge. Subtract the **identical** rounded `removed_net` from
  `stock_on_hand.total_value` and credit it to 1500.
- **Append-only.** Both new tables carry block-mutation triggers (no UPDATE/DELETE); the correction
  row is the SSOT of "actually received" — do **not** mutate `purchase_requests.quantity` or the
  `stock_receipts` row.
- **Enum growth is deliberate.** New `audit_action` value `stock_receipt_correction` and new
  `notification event_type` values `receipt_correction_flagged` / `receipt_correction_resolved` are
  added in U1; update every exhaustiveness guard they trip (do not weaken a guard).
- **Thai UI copy via Edit/Write only** (PowerShell corrupts Thai). Token classes only
  (`src/lib/ui/classes.ts` / globals.css); no raw Tailwind palette (design-system guard).
- **`labels.ts` additions are additive, distinct keys** (append, never rewrite — parallel lanes edit it).
- **Money/GL scope discipline (CLAUDE.md):** implement exactly the spec. No extra fields/handlers.
  Out-of-scope surfacing → the tracker's open-questions, not the diff.

---

## Task U1 — Schema (tables, enums, indexes, append-only triggers)

**Files:**

- Create: `supabase/migrations/20260813075806_spec324u1_receipt_correction_schema.sql`
- Create: `supabase/tests/database/324-receipt-correction.test.sql`

**Interfaces produced (consumed by U2/U4):**

- Table `public.receipt_correction_requests` (cols per spec §4.1) — partial-unique `rcr_one_pending on (receipt_id) where status='pending'`.
- Table `public.stock_receipt_corrections` (cols per spec §4.2).
- `audit_action` gains `'stock_receipt_correction'`; `event_type` gains `'receipt_correction_flagged'`, `'receipt_correction_resolved'`.

- [ ] **Step 0 — Dependency gate-check (gate 2, binding).** Confirm at your branch HEAD / live DB:
  - `stock_receipts(id, qty, unit_cost, total_cost, vat_rate, supplier_id, received_at, created_by, purchase_request_id, project_id, catalog_item_id)` — column set + types (`pnpm exec supabase db query --linked "select column_name,data_type from information_schema.columns where table_name='stock_receipts'"`).
  - `audit_action` enum current values (`select unnest(enum_range(null::public.audit_action))`) — confirm `stock_receipt_correction` absent.
  - `notification_outbox` `event_type` enum current values — confirm the two new labels absent.
  - The append-only trigger pattern in `20260813023000_erd_audit_append_only_triggers.sql` (mirror it).
  - Live `max(version)` → confirm `075806` free.
- [ ] **Step 1 — Write the failing pgTAP test.** Create `324-receipt-correction.test.sql`, `plan(12)`, mirroring `185-store-reversal.test.sql` fixtures (`set local role`, `request.jwt.claims`; grant on `_tap_buf` + seq if switching to `authenticated`, per the pgTAP `_tap_buf` lesson). Assertions:
  1. `has_table('public','receipt_correction_requests')`, `has_table('public','stock_receipt_corrections')`.
  2. `col_is_pk`, `has_column` for each spec §4.1/§4.2 column (names + types).
  3. `has_index('public','receipt_correction_requests','rcr_one_pending')` and it is **partial-unique** (`indexdef` contains `where (status = 'pending'::text)`).
  4. Enum membership: `'stock_receipt_correction' = any(enum_range(null::audit_action)::text[])`; both `event_type` labels present.
  5. Append-only: after inserting a fixture row (as owner), `throws_ok($$ update public.stock_receipt_corrections set removed_qty=1 $$, 'P0001')` and the same for `delete`; likewise for `receipt_correction_requests`.
  6. One-pending uniqueness: insert a `pending` request for receipt R (fixture); a **second** `pending` insert for R `throws_ok(..., '23505')`; a `rejected` row for R inserts fine (partial index ignores non-pending).
- [ ] **Step 2 — Run it, verify RED.** `pnpm db:test 324-receipt-correction` → fails (tables/enums absent).
- [ ] **Step 3 — Write the migration.** Full DDL from spec §4.1/§4.2 (the two `create table`s, the `check` constraints, FKs, `create unique index rcr_one_pending ... where status='pending'`, the plain btree `stock_receipt_corrections (receipt_id)` for the cumulative-guard scan). `alter type public.audit_action add value if not exists 'stock_receipt_correction'`; two `alter type ... event_type add value if not exists ...`. `revoke all ... from anon, authenticated` + RLS enable; `grant select` only where a surface needs it (BO reads corrections; both tables otherwise RPC-written). Append-only block-mutation triggers on both tables (copy the `erd_audit_append_only_triggers` shape). **Enum `add value` cannot run in the same txn as its use** — put the three `alter type` statements in their own migration-leading block or a separate earlier migration if `db:push` complains (known Postgres constraint; gate-0 note).
- [ ] **Step 4 — Run tests, verify GREEN.** `pnpm db:test 324-receipt-correction` → 12/12. `pnpm db:types` (regenerate `database.types.ts`).
- [ ] **Step 5 — Real-flow verify (schema unit).** Run the two live inserts + the update/delete-blocked probes via `supabase db query --linked` and paste output (gate 4 for a schema unit = execute the artifact, not a browser).
- [ ] **Step 6 — Commit.** `git add supabase/migrations/20260813075806_* supabase/tests/database/324-receipt-correction.test.sql src/lib/db/database.types.ts && git commit -m "feat(324): receipt-correction schema (tables, enums, append-only)"`

---

## Task U2 — `correct_stock_receipt` RPC + `reverse_stock_receipt` mutual guard

**Files:**

- Create: `supabase/migrations/20260813075807_spec324u2_correct_stock_receipt.sql`
- Modify (test): `supabase/tests/database/324-receipt-correction.test.sql` (extend plan)

**Interfaces produced (consumed by U4/U5):**

- `correct_stock_receipt(p_receipt_id uuid, p_true_qty numeric, p_reason text, p_request_id uuid default null) → uuid` — DEFINER, BO-gated. Returns the `stock_receipt_corrections.id`.

**Interfaces consumed:** U1 tables/enums; LIVE `reverse_stock_receipt`, `current_user_role`, `stock_on_hand`, `stock_issues`, `stock_returns`, `stock_counts`.

- [ ] **Step 0 — Dependency gate-check.** Dump LIVE bodies: `pg_get_functiondef('public.reverse_stock_receipt'::regprocedure)` (its current gate, on-hand lock ordering, error codes), and confirm `stock_issues`/`stock_returns`/`stock_counts` timestamp columns (`created_at` / `counted_at`) used by the fresh-pool gate. Confirm the `site_purchase_use_now` receipt marker (note text / null `purchase_request_id` + same-txn issue) to encode the origin refusal. Confirm live `max(version)` → `075807`.
- [ ] **Step 1 — Write the failing pgTAP test** (extend `324-receipt-correction.test.sql`, bump `plan`). Fixtures: project P, catalog item I, a `procurement` user, a `site_admin` user; a VAT receipt Rv (qty 100, unit_cost 10 net, vat_rate 7, supplier S), a zero-VAT receipt Rz, a zero-cost receipt R0 (unit_cost 0), and matching `stock_on_hand(P,I)` rows. Assertions:
  1. **Role gate:** as `site_admin` and as anon, `correct_stock_receipt(Rv,80,'x')` `throws_ok '42501'`.
  2. **Range:** as `procurement`, `true_qty` = `-1`, `100` (==booked), `120` (>booked) each `throws_ok` (P0001).
  3. **Fresh-pool — issue:** insert a `stock_issues(P,I)` row with `created_at >= Rv.received_at`; `correct_stock_receipt(Rv,80,'x')` `throws_ok '22023'`. Repeat with a `stock_returns` row, and a `stock_counts` row → each `22023`. Remove them for the happy path.
  4. **Value floor:** craft `stock_on_hand(P,I).total_value` below `removed_net` (blend a cheap 2nd receipt then an issue is already covered by #3; for a pure-value case set total_value low via fixture) → `throws_ok '22023'`.
  5. **Origin refuse:** a `site_purchase_use_now`-shaped receipt (marker) → `throws_ok` (P0001 'ไม่รองรับ…').
  6. **Happy (VAT):** `lives_ok correct_stock_receipt(Rv,80,'miscount')`; then `stock_on_hand(P,I).qty_on_hand` dropped by 20, `total_value` dropped by `round(20*10,2)=200`; a `stock_receipt_corrections` row exists with `removed_qty=20, removed_net=200, removed_vat=round(200*7/100,2)=14, removed_gross=214, supplier_id=S`.
  7. **Cumulative cap:** a second `correct_stock_receipt(Rv,70,'x')` (remove 10 more → cum 30 ≤ 100) `lives_ok`; a further `correct_stock_receipt(Rv,-…)` that would push `Σremoved_qty > 100` `throws_ok`.
  8. **Cross-guard A:** on a fresh receipt Rz, run `reverse_stock_receipt(Rz)` then `correct_stock_receipt(Rz,…)` → `throws_ok` (already reversed).
  9. **Cross-guard B:** on a fresh receipt, `correct_stock_receipt` then `reverse_stock_receipt` → `throws_ok` (already corrected).
  10. **Flag auto-resolver:** insert a fixture `pending` `receipt_correction_requests` for receipt Rz; `reverse_stock_receipt(Rz)` → that request row is now `status='obsolete'`.
- [ ] **Step 2 — Run it, verify RED.** `pnpm db:test 324-receipt-correction` → new assertions fail (function absent).
- [ ] **Step 3 — Write the migration.** `create or replace function public.correct_stock_receipt(...)` implementing spec §5 preconditions **in order**, all before any write; `select ... from stock_on_hand where (project_id,catalog_item_id) for update`; insert the correction row (computing `removed_net/vat/gross` per spec §6); decrement on-hand by the identical `removed_net`; if `p_request_id` given, lock that request row `for update`, assert `status='pending'`, set `applied`; write the `audit_log` row (`action='stock_receipt_correction'`). **Then** `create or replace function public.reverse_stock_receipt(...)` = **LIVE body (gate-0 dump) +** (a) a refusal `if exists (select 1 from stock_receipt_corrections where receipt_id = p_receipt_id) then raise ...`; (b) after its reversal insert, `update receipt_correction_requests set status='obsolete', decided_at=now() where receipt_id=p_receipt_id and status='pending'`. Grant execute to `authenticated` (gate is in-body).
- [ ] **Step 4 — Run tests, verify GREEN.** `pnpm db:test 324-receipt-correction` all pass.
- [ ] **Step 5 — Real-flow verify.** Via `supabase db query --linked`, run a real `correct_stock_receipt` on a scratch fixture receipt inside a `begin; ... rollback;` and show the on-hand delta + inserted correction row.
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): correct_stock_receipt RPC + reverse mutual guard"`

---

## Task U3 — GL contra poster + enqueue trigger + drain route

**Files:**

- Create: `supabase/migrations/20260813075808_spec324u3_correction_gl_posting.sql`
- Create: `supabase/tests/database/324-receipt-correction-gl.test.sql`

**Interfaces produced:** `post_stock_receipt_correction_to_gl(p_correction_id uuid)`; AFTER-INSERT enqueue trigger on `stock_receipt_corrections`; a `drain_gl_posting` CASE for `source_table='stock_receipt_corrections'`.

**Interfaces consumed:** U1/U2; LIVE `post_journal_internal`, `resolve_posting_period`, `drain_gl_posting`, `enqueue_gl_posting_tg`, the `post_stock_receipt_to_gl` VAT-residual pattern.

- [ ] **Step 0 — Dependency gate-check.** Dump LIVE `drain_gl_posting` (the CASE structure, the `skipped`/`failed` handling, no `SKIP LOCKED`) and `post_stock_receipt_to_gl` (the exact `post_journal_internal` call shape, `source_event`, period resolution). Confirm the redrain self-guard idiom from `receipt_poster_redrain_guard` (`20260813064200`). Confirm live head → `075808`.
- [ ] **Step 1 — Write the failing pgTAP test** (`324-receipt-correction-gl.test.sql`, mirror the store-GL tests). Fixtures as U2. Assertions:
  1. After `correct_stock_receipt(Rv,80,'x')` + `perform drain_gl_posting(100)`: exactly one `journal_entries` row with `source_table='stock_receipt_corrections'`, `source_event='stock_receipt_correction'`, `entry_date = current_date`.
  2. Its lines: `Cr 1500 = 200`, `Cr 1300 = 14`, `Dr 2100 = 214` (`supplier_id=S`); `sum(debit)=sum(credit)`.
  3. **Zero-VAT:** correction on Rz → 2 lines only (`Cr 1500 / Dr 2100`, no 1300).
  4. **Zero-value skip:** correction on R0 (unit_cost 0) → **no** `journal_entries` row (poster returns null); `gl_posting_outbox` job `posted` with no entry.
  5. **Residual balance under awkward rounding:** a receipt with `unit_cost=3.33, vat_rate=7, remove 7 of 8` → entry still `sum(debit)=sum(credit)` (residual `Dr 2100`).
  6. **Redrain idempotency:** run `drain_gl_posting(100)` a second time → still exactly one net correction entry (reverse-and-repost self-guard), 1500 net effect unchanged.
  7. **Routing:** the enqueued job is `posted` (not `skipped`) — asserts the CASE label matches the enqueue `source_table`.
- [ ] **Step 2 — Run it, verify RED.**
- [ ] **Step 3 — Write the migration.** `post_stock_receipt_correction_to_gl` (VAT-residual per Global Constraints; zero-net → `return null`; period = `resolve_posting_period(current_date)`; redrain self-guard keyed `(source_table, source_id, source_event)`). AFTER-INSERT trigger `stock_receipt_corrections_enqueue_gl_posting ... execute function enqueue_gl_posting_tg('stock_receipt_correction','id')` — **verify the enqueued `source_table` string matches the drain CASE label exactly.** `create or replace function public.drain_gl_posting(...)` = **LIVE body + a new CASE** `when 'stock_receipt_corrections' then v_entry := public.post_stock_receipt_correction_to_gl(v_job.source_id)`. (Same migration — a mismatch or missing CASE silently marks jobs `skipped`, which `posting_backlog_zero` does not count.)
- [ ] **Step 4 — Run tests, verify GREEN.** Also run `213-store-cost-integrity` to prove no regression: `pnpm db:test 213-store-cost-integrity`.
- [ ] **Step 5 — Real-flow verify.** Scratch `begin; correct_stock_receipt(...); perform drain_gl_posting(100); select account_code, debit, credit ...; rollback;` — paste the balanced 3-line entry.
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): GL contra poster + drain route for receipt corrections"`

---

## Task U4 — Flag RPCs (submit / decide) + notification routing

**Files:**

- Create: `supabase/migrations/20260813075809_spec324u4_correction_flag_rpcs.sql`
- Create: `supabase/tests/database/324-correction-flag.test.sql`
- Modify: `src/lib/notifications/resolve-recipients.ts` (route the two new events)
- Create: `src/app/store/actions.ts` server actions (or extend) — thin RPC relays.

**Interfaces produced (consumed by U5/U6):**

- `submit_receipt_correction_request(p_receipt_id uuid, p_proposed_qty numeric, p_reason text, p_photo_path text) → uuid` — DEFINER, gated to receive/site roles.
- `decide_receipt_correction_request(p_request_id uuid, p_approve boolean, p_true_qty numeric default null, p_note text default null) → uuid` — DEFINER, BO-gated; on approve calls `correct_stock_receipt`, on reject sets `rejected` + closes the receipt to further flags.
- Server actions `submitReceiptCorrectionRequest`, `decideReceiptCorrectionRequest`.

- [ ] **Step 0 — Dependency gate-check.** Dump LIVE `submit_identity_change` / `decide_identity_change` (the row-lock + `status<>'pending'` re-check idiom to mirror) and the `resolve-recipients.ts` switch at HEAD. Confirm `RECEIVE_ROLES` / `BACK_OFFICE_ROLES` membership in `src/lib/auth/role-home.ts`. Confirm live head → `075809`.
- [ ] **Step 1 — Write the failing pgTAP test** (`324-correction-flag.test.sql`). Fixtures: receipt Rv, a `site_admin` SA (with `project_members` row), a `procurement` BO. Assertions:
  1. **submit gate:** a `visitor`/unrelated role → `throws_ok '42501'`.
  2. **submit floors:** `proposed_qty` `>= booked` or `< 0`, or empty `reason`, or empty `p_photo_path` → `throws_ok` (P0001).
  3. **submit happy:** as SA `lives_ok`; one `pending` request for Rv; a 2nd submit for Rv `throws_ok '23505'` (partial-unique).
  4. **decide gate:** as `site_admin`, `decide_receipt_correction_request(req,true,80)` → `throws_ok '42501'`.
  5. **decide approve:** as `procurement` `lives_ok`; request → `applied`, `correction_id` set, a `stock_receipt_corrections` row exists, on-hand reduced.
  6. **double-apply:** a 2nd `decide(req, true, …)` → `throws_ok` (status `<>` pending).
  7. **decide reject:** a fresh flag; `decide(req2,false,note:'ok')` → `rejected`; empty note on reject `throws_ok`.
  8. **reject closes receipt:** after a reject on Rv, `submit_receipt_correction_request(Rv,…)` → `throws_ok` ('ปิดรับการรายงานแล้ว').
- [ ] **Step 2 — Run it, verify RED.**
- [ ] **Step 3 — Write the migration + code.** The two RPCs (mirror the identity-change lock/re-check; `submit` enqueues `notification_outbox` `receipt_correction_flagged`; `decide` enqueues `receipt_correction_resolved`). In `resolve-recipients.ts` add `case 'receipt_correction_flagged': return backOfficePool(context)` (procurement/BO ids) and `case 'receipt_correction_resolved': return payload.requestedBy ? [payload.requestedBy] : []`. Server-action relays with the standard `{ok,error}` shape + error-code → Thai mapping (`22023` → the fresh-pool guide; `42501` → 'ไม่มีสิทธิ์'; `23505` → 'มีรายการรออยู่แล้ว').
- [ ] **Step 4 — Verify GREEN.** `pnpm db:test 324-correction-flag` + `pnpm lint && pnpm typecheck && pnpm test` (resolve-recipients unit test — add a case to its existing spec).
- [ ] **Step 5 — Real-flow verify.** Scratch `begin; submit...; decide... ; rollback;` showing the state transitions + the enqueued outbox rows.
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): correction flag submit/decide RPCs + notification routing"`

---

## Task U5 — Back-office correct UI + queue

**Files:**

- Create: `src/components/features/store/receipt-correction-panel.tsx` (`'use client'` — the correct/reject form; justify in PR).
- Create: `src/app/.../corrections/page.tsx` — the BO correction **queue** (Server Component; pending flags across the user's projects).
- Modify: `src/components/features/store/store-manager.tsx` — a "แก้จำนวนที่รับ" correct control on each receipt row (BO-gated).
- Modify: `src/lib/i18n/labels.ts` (additive keys).
- Test: `tests/unit/receipt-correction-panel.test.tsx`.

**Interfaces consumed:** U4 server actions; the correction/flag reads.

- [ ] **Step 0 — Gate-check.** Read `store-manager.tsx` + the store page role gate at HEAD; confirm `WP_DETAIL_ROLES` / the BO predicate available for gating; confirm the queue's data source (pending `receipt_correction_requests` joined to receipts).
- [ ] **Step 1 — Failing test (RTL).** `receipt-correction-panel.test.tsx`: renders the true-count + reason inputs; **apply** calls `decideReceiptCorrectionRequest({requestId, approve:true, trueQty})`; a `22023` result renders the fresh-pool guide message (not a raw error); **reject** requires a note. Assert exact accessible names (Thai). `await act()` around the transition (the useTransition flake lesson).
- [ ] **Step 2 — Verify RED** (`pnpm exec vitest run receipt-correction-panel`).
- [ ] **Step 3 — Implement** the panel + queue page + the BO-gated row control. Token classes only.
- [ ] **Step 4 — Verify GREEN** + **browser verify** (dev-preview login, super_admin = BO): open the queue, apply a correction on a scratch flagged receipt, confirm on-hand drops and the row clears; reject another and confirm the note is required; zero console errors. Screenshot.
- [ ] **Step 5 — Fresh-eyes review** (cavecrew-reviewer / code-review on the diff).
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): back-office receipt-correction queue + correct panel"`

---

## Task U6 — SA flag UI + dead-button fix

**Files:**

- Create: `src/components/features/store/receipt-flag-sheet.tsx` (`'use client'` — true count + reason + required live-camera photo).
- Modify: `src/components/features/store/store-manager.tsx` — SA sees **"รายงานว่าบันทึกผิด"** (flag), and the existing **"แก้รายการที่บันทึกผิด"** full-reverse control is **role-gated to BO** (removes the dead button the SA currently sees and the RPC rejects).
- Modify: `src/app/projects/[projectId]/store/items/[catalogItemId]/page.tsx` — surface the flag + the ⚠ รอแก้ไข state on the receipt in the item timeline.
- Modify: `src/lib/i18n/labels.ts` (additive).
- Test: `tests/unit/receipt-flag-sheet.test.tsx`.

**Interfaces consumed:** U4 `submitReceiptCorrectionRequest`.

- [ ] **Step 0 — Gate-check.** Confirm the live-camera capture pattern (`capture="environment"`, spec 303) + the store-photo storage path/policy the flag photo reuses; confirm the SA store-page role admission (`site_admin` in the store page gate); confirm the current reverse-button render condition in `store-manager.tsx:~334` (the dead-button locus).
- [ ] **Step 1 — Failing test (RTL).** `receipt-flag-sheet.test.tsx`: the sheet requires a photo before submit; submit calls `submitReceiptCorrectionRequest({receiptId, proposedQty, reason, photoPath})`; a flagged receipt shows `⚠ รอแก้ไข`. **Dead-button regression:** render `store-manager` as `site_admin` → the full-reverse control is **absent** (assert not in the accessible tree); as BO → present.
- [ ] **Step 2 — Verify RED.**
- [ ] **Step 3 — Implement** the flag sheet + the role-gate on the reverse control + the ⚠ state. Decorative icons `aria-hidden` (the a11y decorative-vs-labelled lesson).
- [ ] **Step 4 — Verify GREEN** + **browser verify** as `site_admin` (temp-role recipe from [[spec302-receive-doc-clarity]]: `update users set role='site_admin'` + a `project_members` row, verify, **revert both**): flag a receipt with a photo, confirm ⚠ รอแก้ไข appears and no dead reverse button; revert role. Screenshot.
- [ ] **Step 5 — Fresh-eyes review.**
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): SA receipt-flag sheet + reverse-button role-gate fix"`

---

## Task U7 — `inventory_1500` tie in the scheduled integrity scan

**Files:**

- Create: `supabase/migrations/20260813075810_spec324u7_inventory_1500_integrity.sql`
- Modify (test): `supabase/tests/database/284-integrity-console.test.sql` (or a new `324-integrity-inventory.test.sql`).

**Interfaces consumed:** LIVE `_integrity_check_results` (spec 283/`20260813075470`), `gl_reconciliation`'s `inventory_1500` definition (`20260809002100`).

- [ ] **Step 0 — Gate-check.** Dump LIVE `_integrity_check_results` (its registry shape, the `control_tie_single_feeder` rows, the `backlog` semantics) and the `inventory_1500` tie from `gl_reconciliation`. Confirm live head → `075810`.
- [ ] **Step 1 — Failing pgTAP test.** Assert the scheduled results set now includes an `inventory_1500` check id, and that with a **deliberately injected** 1500-vs-on-hand drift the check reports `fail` (inject in a `begin; ... rollback;` scratch: post a lone 1500 credit with no on-hand change). Assert it reports `pass` on a clean fixture.
- [ ] **Step 2 — Verify RED.**
- [ ] **Step 3 — Write the migration.** `create or replace function public._integrity_check_results(...)` = **LIVE body +** an `inventory_1500` tie row: `(Σ debit−credit where account_code='1500') = Σ stock_on_hand.total_value`, backlog-cleared (only meaningful when `gl_posting_outbox` backlog is 0). Reuse the `gl_reconciliation` expression verbatim so the two never diverge.
- [ ] **Step 4 — Verify GREEN.**
- [ ] **Step 5 — Real-flow verify.** Run the scan RPC live and show the new `inventory_1500` row = `pass`.
- [ ] **Step 6 — Commit.** `git commit -m "feat(324): inventory_1500 tie in scheduled integrity scan"`

---

## Self-Review

**Spec coverage (§ → task):** §2.1 authority → U2/U4 gates. §2.2 both surfaces → U5 (BO) + U6 (SA). §2.3 fresh-pool block+guide → U2 Step 3 gate + U4/U5 error mapping. §2.4 close-short → U2 (no remainder). §4.1/§4.2 tables → U1. §5 RPC preconditions → U2. §6 GL contra → U3. §7 provenance branching → U2 origin refuse + U3 VAT-leg-conditional. §8 concurrency/lifecycle → U1 partial-unique, U2 cross-guard + auto-resolver, U4 row-lock/reject-closes. §9 audit/notify/integrity → U2 audit row, U4 routing, U7 tie. §10 UI + dead-button → U5/U6. **All spec sections mapped.**

**Placeholder scan:** LIVE-function bodies (`reverse_stock_receipt`, `drain_gl_posting`, `_integrity_check_results`) are intentionally "source at gate-0 + apply this named edit" — that is the repo's mandated practice ([[prc-ops-db-migration-lessons]]), not a TBD; the exact edit is specified in each case. New objects have full DDL/signatures. No "handle edge cases"/"add validation" placeholders — each guard is enumerated.

**Type consistency:** `correct_stock_receipt(p_receipt_id, p_true_qty, p_reason, p_request_id)` returns `uuid` (the correction id) — consumed by U4 `decide_...` (approve branch) and U2 tests with that arity. `removed_net/removed_vat/removed_gross` names match spec §4.2 columns and §6 math. `submit_receipt_correction_request` / `decide_receipt_correction_request` signatures match the U5/U6 server-action call sites. Event labels `receipt_correction_flagged` / `receipt_correction_resolved` consistent across U1 enum, U4 enqueue, and `resolve-recipients.ts`.

**Open questions (do not implement — surface only):** dirty-pool guided WIP unwind (Appendix B); over-received variance; the `site_purchase_use_now` origin detector precision (heuristic to firm up at U2 gate-0).
