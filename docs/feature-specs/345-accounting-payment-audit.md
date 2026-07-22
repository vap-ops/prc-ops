# Spec 345 — accounting payment-document audit (ตรวจเอกสารการเงิน)

**Status:** designed (2026-07-23), approved in chat; build not started
**Origin:** operator ask, 2026-07-23 — _"Accounting team needs to be able to
track and audit every payment happening under each project, materials, delivery
cost, labors, rentals, anything else I missed. We will have an admin in
accounting reviewing every documents uploaded, correcting any information. …
items may have not added up to the sum, docs may not be receipts or tax
invoices, accounting admin needs to be able to flag this asap"_ — plus a
follow-up directive: _"Don't forget to plan for AI adoption."_

## 1. What exists today (live map, 2026-07-23)

Two investigators swept the schema, migrations and app surfaces. The picture:

### 1.1 Money events and their documents

Roughly fifteen money-event families move money (all but `office_expenses`,
which has no GL poster yet — its category table carries a phase-2 GL mapping —
post to the GL). Only five carry documents:

| Event                                            | Docs today                                                                        | Bucket                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------- |
| `purchase_requests` (materials + site purchases) | invoice · delivery photo · payment proof · quote (`purchase_request_attachments`) | `pr-attachments`             |
| `purchase_orders`                                | source doc · proof of delivery (`purchase_order_attachments`)                     | `po-attachments`             |
| `office_expenses` (spec 310)                     | receipt (`office_expense_attachments`)                                            | `expense-attachments`        |
| `rental_settlements` (spec 275/323)              | payment slip · tax invoice (`rental_settlement_attachments`)                      | `rental-settlement-receipts` |
| `subcontracts` (header only)                     | contract PDF (`document_path`)                                                    | —                            |

Ten event families move money with **no document path at all**:

| Event                             | Note                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `wage_payments`                   | biggest recurring outflow; `method` + free-text `reference` only     |
| `subcontract_payments`            | advance/progress/final — no slip                                     |
| `client_receipts`                 | money IN — no bank-slip upload                                       |
| `client_billings`                 | no copy of the issued billing doc                                    |
| `wht_certificates`                | data only, no PND 3/53 PDF                                           |
| `purchase_order_charges`          | transport/discount amounts (the operator's "delivery cost") — no doc |
| `stock_receipts` (manual, non-PO) | no receipt doc                                                       |
| `stock_returns`                   | internal movement                                                    |
| `equipment_rental_batches`        | no rental agreement doc                                              |
| `labor_logs` / `wp_labor_costs`   | **by design** — muster + logs are the evidence, not paper            |

Every attachment table records `created_by`/`created_at` (or `uploaded_by/at`),
so flag routing has a target. **No document anywhere carries a
verified/reviewed state** — the review layer is genuinely missing, not
half-built.

### 1.2 Machinery already in place (reuse, do not rebuild)

- **GL self-heals.** Spec 149's posting outbox re-fires when a source row's
  amount changes (`gl_posting_enqueue_triggers`), and every poster
  reverse-and-reposts. Spec 324 additionally proved the full
  flag → decide → append-correction → GL-contra loop for stock receipts
  (`receipt_correction_requests` + `stock_receipt_corrections` +
  `post_stock_receipt_correction_to_gl` posting into the **current open
  period** to dodge closed-period P0002). That pattern is this spec's template.
- **Append-only money rows.** `wage_payments`, `client_receipts`,
  `rental_settlements`, `subcontract_payments` correct by supersede RPCs, never
  UPDATE. Any review layer must live **beside** these tables, not as columns on
  them (block-mutation triggers would refuse the UPDATE).
- **Notification outbox** → LINE push, with a typed event enum, a catalog SSOT
  (`notification-catalog.ts`) and `resolve-recipients.ts` routing. Flags can
  ride this unchanged.
- **Audit convention** (lane 344 finding): new audit events are written as
  `action='other'` + `payload->>'event'`, **not** new `audit_action` enum
  values.
- **Signed URLs** (`mintSignedUrls`, admin client, short TTL) are the only doc
  read path — private buckets have no SELECT RLS.
- **Roles.** `ACCOUNTING_ROLES = [accounting, super_admin]`. The accounting
  role today is **read-only** apart from office-expense reimburse
  (`mark_expense_reimbursed`); billing/WHT/journal writes are `PM_ROLES`.
  Fact-check finding: the period RPCs (`open_accounting_period`,
  `set_accounting_period_status`) gate `project_manager + super_admin` only,
  while the periods page action gates `ACCOUNTING_ROLES` — an accounting user
  pressing close today would hit 42501. U7 reconciles this (open item 5).
  Review + correct is a new write authority.
- **`money-read-policy.ts`** — every new money read registers firm-wide vs
  project-scoped (test-enforced).

### 1.3 What the operator's list missed (folded into scope or the phase-2 menu)

Money IN (billings, receipts, retention, advances) · subcontract payments ·
WHT certificates · **credit notes (ใบลดหนี้) — not modeled anywhere** ·
office expenses/petty cash · PO transport/discount charges · rental deposits
and refunds/forfeits · duplicate-doc reuse (same photo on two PRs — nothing
detects) · doc-type taxonomy (ใบกำกับภาษีเต็มรูป vs อย่างย่อ vs ใบเสร็จ vs
บิลเงินสด — an abbreviated tax invoice is not VAT-claimable) · VAT arithmetic
(net + VAT = gross vs the entered amount) · structured bank references (today
free-text — future bank reconciliation is impossible without them).

## 2. Operator decisions (2026-07-23, in chat)

1. **Direct correct.** The accounting admin corrects money fields directly —
   append-only correction/supersede, GL auto-reposts, origin notified. No
   propose-and-confirm round-trip.
2. **Layer + top gaps.** Phase 1 = the review layer over everything, plus slip
   upload for the two biggest doc-less flows: `wage_payments` and
   `client_receipts`. The other gaps stay on the menu.
3. **Flags route to the uploader.** LINE push + worklist for whoever uploaded
   the doc (or owns the event); they fix/re-upload/reply; the item returns to
   the admin's queue. Self-governance doctrine.
4. **Soft-gate period close.** The close screen shows outstanding flags,
   unverified and doc-less counts for the month; warns, never hard-blocks.
5. **AI adoption is planned in from the start** (§4), gated on proven value
   per the AI-first doctrine.

## 3. Design

### D1 — data model (zero-grant, RPC-write, money posture)

**`money_event_reviews`** — one row per money event, created **on first admin
action** (not eagerly):

- `source_table` text + CHECK against the allowlist:
  `purchase_requests · purchase_order_charges · office_expenses ·
stock_receipts · stock_returns · wage_payments · wp_labor_costs ·
equipment_rental_batches · rental_charges · rental_settlements ·
subcontract_payments · client_billings · client_receipts ·
retention_receivables · wht_certificates`
- `source_id` uuid, `unique (source_table, source_id)` — the same addressing
  scheme the GL outbox uses to point at source rows (there it is a non-unique
  index; here one review per event, so unique).
- `project_id` nullable (several sources are project-less — the queue gets a
  "no project" bucket).
- `status` enum `money_review_status`: `pending | verified | flagged`.
  Any open flag forces `flagged`; when the last flag resolves the row returns
  to `pending` for re-verification. `verified` is a terminal state **only
  until the source changes** (see the stale-verify trigger).
- `verified_by`, `verified_at`, `verified_via` enum (`reviewer | agent`) —
  `agent` reserved for phase C (§4), `note`.

**`money_review_flags`** — append-only:

- review FK · `flag_type` enum:
  `missing_doc · wrong_doc_type · amount_mismatch · sum_mismatch ·
unreadable · duplicate_doc · wrong_vendor · changed_after_verified · other`
- `raised_by_kind` enum `reviewer | agent | system` (the AI hook, in the
  schema from day one — mirrors `feedback_author_kind`'s precedent).
- `status` enum `money_flag_status`: `suggested | open | resolved | dismissed`.
  Human flags are born `open`. Agent flags are born `suggested` and become
  `open` only when the admin confirms (§4 phase B). `system` is reserved for
  trigger-raised flags.
- `detail` text · `flagged_by/at` · `resolved_by/at` + `resolution` text.

**Stale-verify guard.** AFTER-UPDATE triggers on the amount-bearing sources
(mirroring the GL enqueue WHEN clauses — amount/status distinct-from) flip a
`verified` review back to `pending` and raise a `system` flag
`changed_after_verified`. "Verified" always means verified-as-of-the-current
numbers. Sources whose corrections arrive as **new rows** (supersedes,
correction ledgers) get the same effect from an AFTER-INSERT trigger on the
correcting table keyed back to the superseded row's review.

Audit: every verify/flag/resolve/dismiss writes `audit_log` with
`action='other'` + `payload->>'event'` per the lane-344 convention. ⚠️ The
`audit_log` SELECT policy is an event **allowlist** — extend it (or accept
super_admin-only readability) so the accounting surfaces can show their own
trail; check the reader's RLS at U1 build (standing memory gotcha).

### D2 — queue + voucher

- **`/accounting/review`** — definer RPC `list_money_events_for_review`
  unioning the source allowlist LEFT JOIN reviews (absent row = `pending`).
  Tabs: **รอตรวจ / ติดธง / ไม่มีเอกสาร / ตรวจแล้ว**. Filters: project, month.
  Rank: flagged first, then oldest, then largest amount. Paginated.
- The ไม่มีเอกสาร tab derives from a per-source `docs_expected` constant:
  `expected` (has an upload path — actionable now) · `no_path_yet` (doc-less
  families pending their upload unit — shown, labeled, not flaggable to a
  person who cannot act) · `not_expected` (labor family — muster is the
  evidence; excluded from doc pressure entirely).
- **`/accounting/review/[source]/[id]`** voucher — documents (signed URLs)
  side-by-side with the entered fields (amount, VAT, vendor, method,
  reference) + the posted GL entry link. Actions: ✅ verify · 🚩 flag (type +
  note) · ✏️ correct (D4). Follows the `/accounting/purchases/[id]` voucher
  pattern; both queue and voucher register in `money-read-policy` as
  firm-wide reads.

### D3 — flag loop (two-way, spec-201/324 shape)

- New notification events `money_doc_flagged` (→ the doc's `created_by`,
  falling back to the event's owner/recorder, falling back to a per-source
  role pool — procurement pool for purchase/stock sources, back-office pool
  for the rest; the exact per-source map is fixed at U5 build) and
  `money_flag_resolved` (→ accounting pool). Catalog entries + recipient arms
  as usual.
- The source page (PR detail and expense detail first) renders a flag banner
  with the flag text and a **ตอบกลับ/แก้ไขแล้ว** action → `resolve_money_flag`
  (uploader-side, self-or-owner gated) → review returns to `pending`, admin
  re-checks. Deep link from the LINE push lands on the source page.

### D4 — corrections (append-only, GL self-heals)

New role const `MONEY_REVIEW_ROLES = [accounting, super_admin]` gates
verify/flag/dismiss and the correction paths below. Per source:

- `purchase_requests` — new gated `correct_purchase_amount` RPC
  (amount/vat_rate + reason; plain UPDATE — the existing GL enqueue trigger
  already reverse-and-reposts on amount change).
- `stock_receipts` — widen `decide_receipt_correction_request` /
  `correct_stock_receipt` (spec 324) from back-office to include accounting.
- `wage_payments · client_receipts · rental_settlements ·
subcontract_payments` — widen the existing supersede RPC gates to include
  accounting.
- `office_expenses` — reuse/extend its edit path if one exists; otherwise a
  small correct RPC (verify at build).
- `client_billings` — **flag-only.** Client-facing paper; accounting flags,
  PM re-certifies. Same for `wht_certificates` (re-record by PM).

Every correction is audited and notifies the origin (D3's events carry it).
No in-place edits anywhere an append path exists.

### D5 — top doc gaps closed

`wage_payment_attachments` + `client_receipt_attachments` (+ two private
buckets + uploader components + signed-URL loaders) — a straight copy of the
`rental_settlement_attachments` pattern, offered at payout/receipt recording
time and attachable later from the voucher.

### D6 — period soft-gate

`/accounting/periods` close card gains three counts for the month being
closed: open flags · unverified money events · doc-less events (expected
class only). Closing with any outstanding shows a confirm-with-warning.
Never hard-blocks. Note: the close **RPCs** today gate PM + super_admin while
the page gates `ACCOUNTING_ROLES` (§1.2 finding) — U7 reconciles the two
(open item 5).

## 4. AI adoption plan (operator directive)

The manual flow **is** the training ground: every admin verify/flag/dismiss
labels real documents against real entered data. Three phases, each gated on
the previous one's measured value (AI-first doctrine: agents where they help,
prove value before expanding).

**Phase A — manual (U1–U7).** No AI. The schema already carries
`raised_by_kind`, flag `status='suggested'`, and `verified_via` so later
phases are additive migrations only.

**Phase B — assist (U8a).** A worker job (the Railway worker already runs
cron loops) walks new objects in the money buckets and, per document, calls a
vision model once (Claude, latest available; model id via env) to extract:

```
{ doc_kind, doc_no, doc_date, vendor_name, vendor_tax_id,
  subtotal, vat, total, line_item_sum, currency, content_hash, confidence }
```

stored in **`money_review_doc_extractions`** (`bucket + storage_path` unique —
one extraction per object, ever; `extracted jsonb`, `model`, `confidence`,
`extracted_at`). A plain rule layer then compares extraction vs the source
row and INSERTs flags `raised_by_kind='agent', status='suggested'`:

- `doc_kind` not a receipt/tax-invoice class → `wrong_doc_type`
- `total` ≠ source amount (beyond ฿1 rounding) → `amount_mismatch`
- `line_item_sum` ≠ `total` → `sum_mismatch` (the operator's "items may not
  add up to the sum")
- unreadable/low confidence → `unreadable`
- same `content_hash` already attached to a different event → `duplicate_doc`

The voucher shows the extraction beside the entered fields with one-tap
**ยืนยันธง** (suggested → open, routes to uploader per D3) or **ปัดตก**
(→ dismissed). **The agent never corrects data, never resolves flags, and
nothing reaches an uploader without the admin's confirm.**

**Phase C — autopilot (U8b).** Per-source-type auto-verify: an event whose
docs are present, whose extraction raised zero suggestions, and whose amounts
tie within tolerance is auto-verified (`verified_via='agent'`); the admin
works exceptions only. Enable gate, per source type: agent-vs-admin agreement
≥ 95% over a trailing 4 weeks (measured by joining suggested flags to the
admin's final outcomes — the schema above makes this one query) **and** an
operator toggle. Auto-verify only ever verifies — flags always keep a human
in the loop. Documented in `docs/automations.md` with its toggle, per the
automation-documentation doctrine. Toggle off = instant kill switch.

## 5. Units (ship order; each independently shippable)

| Unit | Contents                                                                                            | Class                                                   |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| U1   | enums + `money_event_reviews` + `money_review_flags` + stale-verify triggers + audit events + pgTAP | schema (lane claim)                                     |
| U2   | `list_money_events_for_review` + `/accounting/review` queue page                                    | schema (RPC) + code                                     |
| U3   | verify/flag/resolve/dismiss RPCs + voucher page + `MONEY_REVIEW_ROLES`                              | schema + code                                           |
| U4   | correction RPC/gate widening per D4                                                                 | schema, **danger-path** (money RPC gates)               |
| U5   | notification events + recipient map + source-page flag banners + uploader resolve                   | schema (enum) + code                                    |
| U6   | wage/client-receipt attachments + buckets + uploaders                                               | schema + code                                           |
| U7   | period soft-gate counts + confirm                                                                   | code                                                    |
| U8a  | extraction table + worker vision job + suggested flags + voucher confirm/dismiss                    | schema + worker, **operator-gated** (API cost)          |
| U8b  | auto-verify toggle + agreement measurement + automations.md                                         | schema + code, **operator-gated** (doctrine value gate) |

U1–U3 alone deliver a usable audit queue. U4 makes flags fixable in-place;
U5 closes the loop with the field; U6 extends coverage; U7 adds the monthly
pressure; U8 is the AI ramp.

## 6. Out of scope (phase-2 menu, deliberately named)

Credit-note (ใบลดหนี้) entity · remaining doc gaps (subcontract payment
slips, WHT PND PDFs, PO-charge docs, billing doc copies, rental agreements)
· structured bank references + bank-statement reconciliation · per-project
audit-coverage % on the accounting project drill · per-doc classification
table beyond the extraction jsonb · an accountant Q&A assistant over the GL.

## 7. Open items (non-blocking, resolved at their unit's build)

1. Per-source fallback recipient map for `money_doc_flagged` (U5).
2. Amount-match tolerance default (฿1) — confirm with the accountant (U8a).
3. Whether `office_expenses` already has an edit/correct RPC (U4).
4. Rental deposit granularity — deposits ride `rental_settlements` rows or
   need their own review entry (U1 allowlist check at build).
5. Period-close authority mismatch (§1.2): widen
   `open_accounting_period`/`set_accounting_period_status` to
   `ACCOUNTING_ROLES`, or re-gate the page to PM — operator call at U7.
