# Spec 345 — implementation plan (accounting payment-document audit)

> **For agentic workers:** execute unit-by-unit with the `ship-unit` skill (lane claim →
> dependency gate-check → RED first → real-flow verify → fresh-eyes → gated ship). Each
> unit is its own PR. Steps use checkbox syntax for tracking.

**Goal:** a review layer over every money event — accounting verifies/flags/corrects each
payment document per project, with a stale-verify guarantee that "verified" always means
verified-as-of-the-current-numbers, and an AI ramp planned in from day one.

**Architecture:** two new zero-grant tables (`money_event_reviews`, `money_review_flags`)
addressed `(source_table, source_id)` exactly like the GL posting outbox; one generic
SECURITY DEFINER trigger function marks verified reviews stale when their source changes;
all human writes arrive via DEFINER RPCs (U3+); reads via a union RPC (U2). Reuses the GL
self-heal, the spec-324 flag→correct template, the notification outbox, and signed-URL doc
reads unchanged.

**Tech stack:** Postgres (Supabase) migrations + pgTAP · Next.js 16 App Router server
components + server actions · existing `notification-catalog.ts` / `resolve-recipients.ts`
· Railway worker (U8a only).

## Global constraints

- Spec: `docs/feature-specs/345-accounting-payment-audit.md` — implement exactly; deltas
  below are documented deviations, approved by evidence (§Deviations).
- Zero-grant posture on both new tables: RLS enabled, **no policies**, `revoke all … from
public, anon, authenticated`. Every read/write path is a SECURITY DEFINER function.
- Append-only discipline: reviews are never deleted; flags are never deleted (status
  transitions only, via U3 RPCs).
- Audit rows use `action='other'` + `payload->>'event'` (lane-344 convention), events:
  `money_review_verified · money_review_flag_raised · money_review_flag_resolved ·
money_review_flag_dismissed · money_review_corrected` (U3/U4).
- New role const `MONEY_REVIEW_ROLES = ['accounting','super_admin']` lands in
  `src/lib/auth/role-home.ts` at U3 (additive — never mutate existing sets).
- Thai copy used on 2+ surfaces single-sources in `src/lib/i18n/labels.ts`.
- Every new money read registers in `src/lib/accounting/money-read-policy.ts` (U2/U3).
- **Plan-staleness rule (313 lesson, 3× burned):** this plan is a 2026-07-23 snapshot.
  Every unit re-gate-checks its dependencies against the LIVE DB + HEAD before building.
  U1 is fully specified (built same-day as the evidence); U2–U8 are binding contracts +
  test lists, with the code shaped at build time after the gate-check.

## Evidence pinned 2026-07-23 (live DB probes, this plan's ground truth)

- All 15 allowlist sources exist; every one is addressable by a single uuid:
  14 have `id uuid` PK; **`wp_labor_costs` PK = `work_package_id`** (GL outbox uses the
  same: `enqueue_gl_posting_tg('labor_freeze','work_package_id')`).
- `project_id` exists on: client_billings, client_receipts, office_expenses,
  purchase_requests, retention_receivables, stock_receipts, stock_returns. The other 8
  sources are project-less at the row (derive via joins at U2 read time).
- Append-only sources (`*_no_update_delete` triggers, correct by superseding INSERT with
  `superseded_by` on the NEW row): wage_payments, client_receipts, rental_settlements,
  subcontract_payments, stock_receipts, stock_returns, stock_receipt_corrections.
- In-place-updatable sources (no block trigger): purchase_requests, office_expenses,
  purchase_order_charges, rental_charges, equipment_rental_batches, client_billings,
  retention_receivables, wht_certificates, wp_labor_costs.
- GL enqueue WHEN clauses (mirror source for change detection): purchase_requests upd =
  `amount/status distinct` (+ posting-eligibility conjuncts we deliberately drop, see
  Deviations D-2); wp_labor_costs upd = `own_cost/dc_cost distinct`; client_billings upd
  fires only on `status→certified`; retention_receivables upd only on `status→released`;
  equipment_rental_batches deposit GL keys on `deposit_paid_date`.
- Correction ledgers pointing at stock_receipts: `stock_receipt_corrections.receipt_id`
  (spec 324) and `stock_reversals.receipt_id` (nullable — issue reversals carry
  `issue_id` instead). stock_returns has **no** correction ledger → no stale path exists.
- `office_expenses` has **no status column** (cols: amount, expense_date, payment_source,
  reimbursed_at/by, …) and **zero triggers** (fact-check ③ confirmed: no GL enqueue).
- All GL trigger functions are `SECURITY DEFINER` — the stale-verify function follows.
- `public.set_updated_at()` exists (reused for `updated_at`).
- **audit_log SELECT "internal privileged" arm already includes `accounting`** (reads ALL
  events, alongside super_admin/PD/PM); only site_admin/procurement/procurement_manager
  are event-allowlisted. See Deviations D-3.
- Migration head `20260813075837_spec344_merge_fixes.sql` → this unit claims
  **`20260813075838`** (schema lane claim in `../LANES.md` required BEFORE the file is
  written — the `require-lane-claim` hook blocks otherwise).

## Deviations from the spec's literal text (all evidence-driven, else spec governs)

- **D-1 — stale-verify lands `status='pending'` + a system flag born `'suggested'`,**
  not an open flag. The spec says both "flip back to pending" and "any open flag forces
  flagged"; an open system flag would contradict the pending flip. `suggested` reconciles
  the two sentences, and is right for the workflow: `changed_after_verified` has nothing
  for an uploader to fix (the change may itself be the correction), so it must not enter
  the D3 route-to-uploader loop. U3's verify RPC dismisses the review's outstanding
  `suggested` system flags as part of verifying (interface note in U3).
- **D-2 — stale WHEN clauses mirror only the change-detection predicates of the GL
  WHENs, not the posting-eligibility conjuncts.** GL's PR trigger requires
  `work_package_id is not null` + status in (purchased, site_purchased) because that's
  what posts; a review is stale on ANY entered-number change — mirroring eligibility
  would blind the layer on store-first PRs (wp force-nulled, 124/553 rows) and on
  pre-certify billing edits.
- **D-3 — no audit_log policy migration in U1.** The accounting role already sits in the
  privileged read-all arm (probed live) — the fact-check-④ risk ("review trail
  super_admin-only readable") is moot for the admin-facing trail. Re-check at U5 only if
  a NON-privileged surface must render audit rows (uploader surfaces read
  `money_review_flags` via RPC, not audit_log).
- **D-4 — `verified_by/at/via` are retained when a review goes stale** (status is the
  SSOT; the columns keep the last-verify trail). The CHECK is one-directional:
  a `verified` row must carry `verified_at + verified_via` (+ `verified_by` when via =
  `reviewer`); a pending row MAY carry them.
- **D-5 — stock_returns gets no stale trigger** — append-only with no correction ledger;
  there is nothing to hook. If a returns-correction mechanism ever ships, it must add the
  hook (noted in the migration comment).

## File map (whole spec)

| Unit | Files                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | `supabase/migrations/20260813075838_spec345_money_review_schema.sql` · `supabase/tests/database/345-money-reviews.test.sql`                                                                         |
| U2   | mig `list_money_events_for_review` RPC · `src/app/accounting/review/page.tsx` (+ queue components) · `src/lib/accounting/review-docs-expected.ts` · labels · money-read-policy row · pgTAP `345b-*` |
| U3   | mig verify/flag/resolve/dismiss RPCs · `src/app/accounting/review/[source]/[id]/page.tsx` voucher + actions · `MONEY_REVIEW_ROLES` in `role-home.ts` · pgTAP                                        |
| U4   | mig `correct_purchase_amount` + gate widenings (danger-path) · voucher ✏️ actions · pgTAP                                                                                                           |
| U5   | mig notification enum values · `notification-catalog.ts` + `resolve-recipients.ts` arms · source-page flag banners + uploader resolve action                                                        |
| U6   | mig `wage_payment_attachments` + `client_receipt_attachments` + 2 buckets + storage policies · uploader components · loaders                                                                        |
| U7   | period close card counts + confirm (code) · operator call on open item 5                                                                                                                            |
| U8a  | mig `money_review_doc_extractions` · `worker/` vision job · voucher confirm/dismiss UI                                                                                                              |
| U8b  | auto-verify toggle + agreement query + `docs/automations.md`                                                                                                                                        |

---

## U1 — review schema + flags + stale-verify triggers (schema; lane claim `075838`)

**Interfaces produced (later units consume):**

- `public.money_event_reviews` (id uuid PK · source_table text CHECK-allowlisted ·
  source_id uuid · unique(source_table, source_id) · project_id uuid null FK →
  projects · status `money_review_status` default `'pending'` · verified_by uuid null FK
  → users · verified_at timestamptz · verified_via `money_review_verified_via` · note
  text · created_at/updated_at).
- `public.money_review_flags` (id uuid PK · review_id uuid FK → money_event_reviews ·
  flag_type `money_flag_type` · raised_by_kind `money_flag_raised_by_kind` · status
  `money_flag_status` · detail text · flagged_by uuid null FK → users · flagged_at ·
  resolved_by uuid null FK · resolved_at · resolution text).
- Enums: `money_review_status(pending|verified|flagged)` ·
  `money_review_verified_via(reviewer|agent)` ·
  `money_flag_status(suggested|open|resolved|dismissed)` ·
  `money_flag_raised_by_kind(reviewer|agent|system)` ·
  `money_flag_type(missing_doc|wrong_doc_type|amount_mismatch|sum_mismatch|unreadable|duplicate_doc|wrong_vendor|changed_after_verified|other)`.
- Behavior contract: any qualifying source change flips that source's `verified` review
  to `pending` and appends exactly one system flag `changed_after_verified` born
  `suggested`; non-verified reviews are untouched; sources without a review are untouched.

**Stale-verify trigger matrix (15 triggers → one generic fn
`money_review_mark_stale_tg(source_table, id_column)`):**

| Source                    | Path         | WHEN (any `is distinct from`)                                                          | id column                       |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------- | ------------------------------- |
| purchase_requests         | AFTER UPDATE | amount, vat_rate, status                                                               | id                              |
| office_expenses           | AFTER UPDATE | amount, expense_date, payment_source                                                   | id                              |
| purchase_order_charges    | AFTER UPDATE | amount, vat_rate, charge_type                                                          | id                              |
| rental_charges            | AFTER UPDATE | amount, vat_rate                                                                       | id                              |
| equipment_rental_batches  | AFTER UPDATE | deposit_amount, monthly_rate, rate_period, status, deposit_paid_date                   | id                              |
| client_billings           | AFTER UPDATE | gross_amount, vat_amount, retention_amount, vat_rate, retention_rate, wht_rate, status | id                              |
| retention_receivables     | AFTER UPDATE | amount_withheld, status                                                                | id                              |
| wht_certificates          | AFTER UPDATE | base_amount, wht_amount, wht_rate                                                      | id                              |
| wp_labor_costs            | AFTER UPDATE | own_cost, dc_cost                                                                      | **work_package_id**             |
| wage_payments             | AFTER INSERT | superseded_by not null                                                                 | **superseded_by**               |
| client_receipts           | AFTER INSERT | superseded_by not null                                                                 | superseded_by                   |
| rental_settlements        | AFTER INSERT | superseded_by not null                                                                 | superseded_by                   |
| subcontract_payments      | AFTER INSERT | superseded_by not null                                                                 | superseded_by                   |
| stock_receipt_corrections | AFTER INSERT | — (every correction)                                                                   | receipt_id → `'stock_receipts'` |
| stock_reversals           | AFTER INSERT | receipt_id not null                                                                    | receipt_id → `'stock_receipts'` |

### Steps

- [ ] **1. Claim the lane.** Append to `../LANES.md` ACTIVE LANES: lane 345audit, branch
      `spec345-u1-review-schema`, **schema claim `075838`**; re-read to confirm single writer.
- [ ] **2. Write the failing pgTAP** `supabase/tests/database/345-money-reviews.test.sql`
      (full file in the build; skeleton below) and see it RED (`pnpm db:test -- 345` →
      "relation … does not exist" class failures) BEFORE the migration exists. Assertions:
  - tables + RLS enabled + **zero privileges** for anon AND authenticated on both tables
    (has_table_privilege false × select/insert/update/delete)
  - 5 enums exist with exact value sets (`enum_has_labels`)
  - unique (source_table, source_id) → duplicate insert raises 23505
  - allowlist CHECK → `source_table='users'` raises 23514
  - reviewer flag without flagged_by raises 23514; closed-shape CHECK (resolved ⇔
    resolved_at) raises 23514
  - verified-attrib CHECK: status='verified' without verified_at/via raises 23514
  - `money_review_mark_stale_tg` exists + `prosecdef = true`
  - all 15 triggers exist by name (pin the set with a count over pg_trigger)
  - **UPDATE path** (fixture: project → work_package → wp_labor_costs, adapted from
    `82-gl-posting-outbox.test.sql`): seed review `verified`; update `own_cost` → review
    `pending`, verified_at retained, exactly one flag (`changed_after_verified`,
    `system`, `suggested`); update `frozen_by` (non-WHEN column) → no change, still 1
    flag; second `own_cost` update while pending → still exactly 1 flag (idempotence)
  - **INSERT path** (fixture: worker + wage_payment from 82): review `verified` on
    payment A; insert superseding payment B (`superseded_by = A`) → A's review flips +
    flag; a fresh non-superseding insert → no flag
  - **corrections path** (fixture: adapt the stock_receipts seed from the spec-324 pgTAP
    file): verified review on a receipt; insert `stock_receipt_corrections` row →
    receipt's review flips
  - update on a source row with NO review → zero flag rows created
- [ ] **3. Write the migration** `supabase/migrations/20260813075838_spec345_money_review_schema.sql`:
      5 enums → 2 tables (columns/CHECKs per Interfaces + D-4; named constraints
      `money_event_reviews_source_allowlist`, `money_event_reviews_verified_attrib`,
      `money_review_flags_reviewer_attrib`, `money_review_flags_closed_shape`) → index
      `money_review_flags_review_idx (review_id)` → `updated_at` trigger reusing
      `public.set_updated_at()` → RLS enable + revoke-all both tables → generic
      `money_review_mark_stale_tg()` (SECURITY DEFINER, `set search_path=''`, reads
      `tg_argv[0/1]`, extracts uuid via `to_jsonb(new)->>id_col`, `update … where source_table
and source_id and status='verified' returning id`, inserts the system flag with Thai
      detail `ข้อมูลเงินต้นทางเปลี่ยนหลังตรวจแล้ว ต้องตรวจซ้ำ`; revoke execute from
      public/anon/authenticated) → the 15 triggers per the matrix (D-5 comment for
      stock_returns).
- [ ] **4. Push + GREEN.** `pnpm db:push` (auto-Y) → `pnpm db:test -- 345` green →
      **full `pnpm db:test`** (doctrine: once per session, any unexpected red = everyone's
      blocker; tolerated known-red = 221 only).
- [ ] **5. Types + suite.** `pnpm db:types` → `git status` (mutation-capable command —
      inspect) → `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **6. Commit, then mutation-check** (doctrine order): with the unit committed,
      hand-break one WHEN clause equivalence in the TEST fixture (e.g. assert flag count 2)
      → RED → restore; drop the `status='verified'` guard expectation (seed review
      `pending`, update amount, assert 0 flags) is already a live negative in the file.
- [ ] **7. Real-flow verify (schema-only unit):** in one rolled-back live transaction,
      exercise the artifact end-to-end on prod data shapes: create a review on a REAL
      purchase_requests row (verified) → update its amount → observe flip + flag → ROLLBACK.
      Zero committed writes, no notification side effects (outbox rows roll back too).
- [ ] **8. Fresh-eyes review** (code-review subagent, full diff) → address findings.
- [ ] **9. Ship.** `scripts/ship-pr.sh` — danger-path guard WILL hold it (migration);
      admin-merge on green under the additive-mig standing grant. On merge: LANES block
      update (head `075838`, lane free, next `075839`), progress tracker row.

## U2 — union queue RPC + `/accounting/review` page (schema RPC + code)

**Contract:** DEFINER RPC `list_money_events_for_review(p_tab text, p_project uuid
default null, p_month date default null, p_limit int default 50, p_offset int default 0)`
gated `MONEY_REVIEW_ROLES` (inline role check; 42501 otherwise), unioning the 15 sources
LEFT JOIN reviews (absent row ⇒ `pending`); returns
`(source_table, source_id, project_id, project_name, amount numeric, event_date date,
counterparty text, doc_count int, review_status, open_flag_count int)`.
Tabs: `pending | flagged | no_docs | verified` (Thai: รอตรวจ / ติดธง / ไม่มีเอกสาร /
ตรวจแล้ว). Rank: flagged first → oldest → largest amount.
`review-docs-expected.ts` per-source constant:
`expected` = purchase_requests, office_expenses, rental_settlements (+ wage_payments,
client_receipts after U6) · `not_expected` = wp_labor_costs · `no_path_yet` = the rest.
**Gate-check at build:** per-source amount/date/counterparty/doc-count columns; page
registers firm-wide in `money-read-policy.ts`; nav door on `/accounting` hub; pgTAP for
the RPC gate + one tab's shape; RTL for tabs/empty states; docs_expected classes each
pinned by a test.

## U3 — verify / flag / resolve / dismiss RPCs + voucher (schema + code)

**Contract:** 4 DEFINER RPCs, all writing audit events (Global constraints):

- `verify_money_event(p_source_table, p_source_id, p_note default null)` — upserts the
  review row (first admin action creates it), sets `verified/by/at/via='reviewer'`;
  **refuses while an `open` flag exists (P0001)**; dismisses the review's outstanding
  `suggested` SYSTEM flags (closes D-1's loop). Gate `MONEY_REVIEW_ROLES`.
- `flag_money_event(p_source_table, p_source_id, p_flag_type, p_detail)` — upserts
  review → `flagged`, inserts flag born `open`, `raised_by_kind='reviewer'`.
- `resolve_money_flag(p_flag_id, p_resolution)` — U3 ships the ADMIN side; status →
  `resolved`, review returns to `pending` when no open flags remain. (U5 widens the gate
  to the uploader: self-or-owner check.)
- `dismiss_money_flag(p_flag_id, p_resolution default null)` — admin-only, → `dismissed`,
  same review-status recompute.
  Voucher `/accounting/review/[source]/[id]`: docs via `mintSignedUrls`, entered fields,
  GL entry link, ✅/🚩 actions. `MONEY_REVIEW_ROLES` const lands here.
  **Gate-check at build:** status-recompute rule (any open flag ⇒ flagged; else pending
  unless verified) lives in ONE pl/pgsql helper used by all four; pgTAP covers the full
  verify→flag→resolve→re-verify loop + the open-flag verify refusal + gates (42501
  negatives with pinned messages); RTL voucher actions; mutation-check the recompute.

## U4 — corrections (schema, danger-path: money RPC gates)

Per spec D4 exactly; **gate-check every live RPC def (`pg_get_functiondef`) before
widening** — the list to widen: `decide_receipt_correction_request`,
`correct_stock_receipt`, the 4 supersede RPCs (wage/client-receipt/rental-settlement/
subcontract-payment), + new `correct_purchase_amount(p_purchase, p_amount, p_vat_rate,
p_reason)` (plain UPDATE — U1's stale trigger + GL's own enqueue react). Open item 3
(office_expenses edit path) answered here. client_billings + wht = flag-only (NO RPC).
Audit `money_review_corrected` + notify origin (U5's event if merged order allows, else
existing notify shape). pgTAP: each widened gate positive+negative.

## U5 — flag loop notifications + banners (schema enum + code)

`notification_event_type` += `money_doc_flagged`, `money_flag_resolved` (enum add —
expect the guard trips: catalog exhaustiveness + pgTAP enum pins; update alongside).
Catalog + `resolve-recipients.ts` arms: flagged → doc `created_by` ▸ event
owner/recorder ▸ per-source role pool (fix the map at build; procurement pool for
purchase/stock, back-office for the rest); resolved → accounting pool. Source-page
banners (PR detail + expense detail first) + uploader-side `resolve_money_flag` gate
widening (self-or-owner). Deep link from LINE push to the source page.
**Gate-check:** recipient resolver signatures; D-3 re-check (does any non-privileged
surface read audit_log?); RTL banner + resolve; pgTAP widened resolve gate.

## U6 — wage/client-receipt attachments (schema + code)

Straight copy of the `rental_settlement_attachments` pattern: 2 tables (uploaded_by/at,
kind enums if the source pattern has them), 2 private buckets
(`wage-payment-attachments`, `client-receipt-attachments`), storage INSERT/SELECT
policies (⚠️ storage.objects policies — the 2026-07 parity-sweep lesson: scan
`storage.objects`, not just `public`), uploader components at payout/receipt recording +
voucher attach-later, signed-URL loaders. Flip `review-docs-expected.ts`: both sources →
`expected`. pgTAP storage policies + table RLS; RTL uploaders.

## U7 — period soft-gate (code) + authority reconciliation

Close card: 3 counts for the closing month (open flags · unverified · doc-less among
`expected`) via one DEFINER count RPC or U2's RPC re-used with `p_month`; confirm-with-
warning, never hard-block. 🔔 **Operator call (open item 5):** widen
`open_accounting_period`/`set_accounting_period_status` to ACCOUNTING_ROLES vs re-gate
the page to PM — surface BEFORE building; the counts card ships either way.

## U8a — extraction worker (operator-gated: API cost)

`money_review_doc_extractions` (bucket+storage_path unique · extracted jsonb · model ·
confidence · content_hash · extracted_at) + worker cron job (vision model, env-pinned id)

- rule layer inserting `agent`/`suggested` flags (mapping per spec §4B) + voucher
  ยืนยันธง/ปัดตก. ⚠️ Railway deploys on `worker/**` watch-paths. Tolerance default ฿1
  (open item 2 — ask accountant). Never corrects, never resolves, nothing reaches an
  uploader unconfirmed.

## U8b — auto-verify (operator-gated: value gate)

Per-source toggle + trailing-4-week agreement query (suggested flags × admin outcomes ≥
95%) + `verified_via='agent'` verify-only writes + `docs/automations.md` entry with the
kill switch. Flags always keep a human in the loop.

## Self-review (writing-plans checklist, done 2026-07-23)

- **Spec coverage:** D1→U1 · D2→U2 · D3→U3+U5 · D4→U4 · D5→U6 · D6→U7 · §4→U8a/U8b ·
  §7 open items each named in their owning unit. Credit notes etc. stay §6 out-of-scope.
- **Placeholders:** later-unit code intentionally contract-level per the plan-staleness
  rule (stated, bounded, with gate-check blocks) — no TBDs inside U1.
- **Type consistency:** RPC names/enums match across units (`list_money_events_for_review`,
  `verify_money_event`, `flag_money_event`, `resolve_money_flag`, `dismiss_money_flag`,
  `MONEY_REVIEW_ROLES`, enum names as in U1 Interfaces).
