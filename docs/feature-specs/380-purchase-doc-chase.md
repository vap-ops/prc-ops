# Spec 380 — Missing purchase-document visibility (ตามเอกสารซื้อ)

> **Status:** approved 2026-07-30 (operator, in chat) · design + doc-definition round done same day
> **Origin:** operator — "procurement team finds it hard to determine which order lacks accounting
> documents. need to make it prominent. … procurement manager must see in dashboard as well",
> followed by "Must define first, what are the types of documents are needed and what to do if
> suppliers do not provide, look them up."
> **Related:** spec 345 (accounting review layer — its `ไม่มีเอกสาร` tab is the accounting-side
> sibling of this), spec 302/304 (per-PR doc sections + `invoiceMissingFlag`), spec 134 (PO docs).

## 1. Problem + live evidence (measured 2026-07-30)

The per-order signal exists (`invoiceMissingFlag`, amber line on `/requests/[id]` since spec 302)
but only at the leaf — to find gaps the team must open each of 529 delivered orders one by one.
No list, no count, no dashboard presence.

- **242 of 529 delivered PRs have no accounting document at all** under the union predicate
  (current PR attachment `invoice`/`payment` ∪ current PO attachment `source_document`).
  Aging: 42 <7d · 90 7–14d · 110 >14d, across 20 suppliers (ตั้งเง็กฮะ 58 · 4 อ.เจริญ 40 ·
  ไทวัสดุ 27 · Shopee 14 …).
- **195 of the 242 are VAT-registered suppliers** (`suppliers.is_vat_registered`, tax_id on file):
  ฿737,945 gross ≈ **฿48,277 input VAT unclaimable** until tax invoices arrive.
- Trend: Jun 0/7 POs had a source doc; Jul 45/124 — an ongoing behaviour gap, not a backlog.
- Telemetry 14d (procurement roles): `/procurement` 780 · `/requests` 417 · `/requests/orders` 45.
  The signal must live on the hub + the requests list; the PO list is quiet.
- ⚠ Found in passing: `list_money_events_for_review` computes `doc_count` for purchases from
  `purchase_request_attachments` ONLY — blind to all 341 PO-level docs — and **purpose-blind**
  (a `reference`/`quote` photo counts as a doc). So the ไม่มีเอกสาร tab both over-counts
  (~500 vs the true 242) and under-counts (a PR carrying only a `delivery_confirmation` photo
  reads as documented). U6 fixes BOTH: union in PO `source_document` AND purpose-filter the PR
  half to `invoice`/`payment` + typed-satisfying rows.

## 2. Document model (defined with operator 2026-07-30, RD-grounded)

Per-supplier-class requirement — class derived live from `suppliers`:

> **Amended post-fact-check (same day):** `suppliers.is_vat_registered` is **NOT NULL DEFAULT
> false** — a null flag is unreachable, so `unknown` = **no supplier row at all** (free-text
> `pr.supplier` only). Corollary: an un-flagged VAT vendor silently classes `non_vat` and a cash
> bill would satisfy it — the exact VAT gap this spec closes. v1 mitigation (U3): a display-only
> mis-flag hint when the supplier name carries a juristic marker (บริษัท/หจก./บมจ.) while classed
> `non_vat` — "ตรวจสถานะ VAT" — plus an operator data-fix list. Not auto-upgraded (juristic ≠
> VAT-registered in law; the flag stays the SSOT).

| Class     | Derivation                  | Satisfying doc (typed)                                                                                                                                           |
| --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vat`     | `is_vat_registered = true`  | `tax_invoice_full` (ใบกำกับภาษีเต็มรูป, ม.86/4 — enables 7% input-VAT claim)                                                                                     |
| `non_vat` | `is_vat_registered = false` | `receipt_cash_bill` (มี ชื่อ+เลขภาษีผู้ขาย ม.105 ทวิ) · `payment_voucher` (ใบสำคัญรับเงิน + สำเนาบัตร, บุคคลธรรมดา) · `cert_in_lieu` (ใบรับรองแทนใบเสร็จรับเงิน) |
| `unknown` | no supplier row / flag null | any of the 4 above                                                                                                                                               |

Fallback ladder when the supplier won't provide (per กรมสรรพากร manual — this IS the answer to
"what to do if suppliers do not provide"; surfaced on the chase row per class):

1. VAT vendor is legally obliged (ม.86) → keep chasing (most issue at monthly วางบิล).
2. Seller will sign but has no bill → ใบรับเงิน (business) / ใบสำคัญรับเงิน + ID copy (individual).
3. Seller won't sign anything → ใบรับรองแทนใบเสร็จรับเงิน (internal, approver signs) + slip.
4. Shopee → press ขอใบกำกับภาษี in-app (e-Tax).
5. True dead end (VAT vendor refuses) → **accounting-recorded waiver** (VAT becomes cost) — U1/U6.

Supporting docs `delivery_note` and `transfer_slip` NEVER satisfy the requirement (they prove
goods/payment, not the payee — ม.65 ตรี (18)).

**Operator decisions locked:** ① coverage counted per class (above) ② `doc_type` ships in v1 —
new uploads pick a type; **legacy untyped attachments grandfather as covered-loose** (else 287
covered orders flip to missing and the team re-tags 341 old docs) ③ waiver is accounting-only.

Sources: RD คู่มือเอกสารประกอบการลงบัญชีฯ (rd.go.th/fileadmin/download/15277290359.pdf) ·
ม.86/4 (rd.go.th/fileadmin/images/image_pramoun/mata86_4_6.pdf) · ป.86/2542 (rd.go.th/3568.html).

## 3. Scope predicate (the SSOT — one place, U2)

An order is **in scope** when `purchase_requests.status ∈ {delivered, site_purchased}` (money
spent, goods received; today that is 529 rows, all `delivered`).
An in-scope order is **covered** when any of:

- a current (`superseded_by is null`) attachment whose `doc_type` satisfies its class (table §2);
- a current attachment with `doc_type IS NULL` and a qualifying purpose — PR `invoice`/`payment`
  or PO `source_document` (covered-loose, legacy);
- a `purchase_doc_waivers` row exists (state `waived`, reason shown).
  Otherwise it is **missing** → chase list + all counts. Aging clock = `delivered_at`
  (fallback `purchased_at`, then `created_at`).

## 4. Units

### U1 — schema (mig `20260813075877`, additive; pgTAP `380-purchase-doc-types.test.sql`) — ✅ BUILT 2026-07-30

> As-built notes: applied via `db query --file` + `migration repair --status applied` because
> `db:push` refuses while migrations `075875`/`075876` (two open danger-held lanes) exist on the
> remote with no files on main. RED-first proven (42704 pre-migration). The waiver upserts on
> re-waive (idempotent correction; every call audits).

- `create type purchase_doc_type as enum ('tax_invoice_full','receipt_cash_bill',
'payment_voucher','cert_in_lieu','delivery_note','transfer_slip','other')`.
- `alter table purchase_request_attachments add column doc_type purchase_doc_type` (nullable);
  same on `purchase_order_attachments`.
- `create type purchase_doc_waiver_reason as enum ('vendor_refused','docs_unobtainable','other')`.
- `purchase_doc_waivers` (id pk · `purchase_request_id` unique FK cascade · reason · note text ·
  `check (reason <> 'other' or note is not null)` · created_by FK users · created_at). RLS:
  SELECT via parent-PR-exists (mirrors `purchase_request_attachments` "select via parent");
  no INSERT/UPDATE/DELETE policies — writes via DEFINER only.
- DEFINER RPCs `waive_purchase_docs(p_purchase_request uuid, p_reason purchase_doc_waiver_reason,
p_note text default null)` + `unwaive_purchase_docs(p_purchase_request uuid)` — gate
  `current_user_role()::text in ('accounting','super_admin')` else 42501 (coalesce-hardened per
  rls-self-check-coalesce); `revoke all … from public, anon` (house 336/372 pattern — new fn =
  PUBLIC EXECUTE by default); waive audits to `audit_log` via the existing audit helper if one is
  house-standard for DEFINER writes (gate-check at build; 345 used `action='other'` + event name).
- pgTAP RED-first: enum values pinned · both columns exist · waiver unique + note-CHECK both
  directions · RPC 42501 for procurement/site_admin/anon + success for accounting (positive
  control) · unwaive removes · SELECT policy visible to authenticated via parent.
- Gate-checks at build: live head = `075875`+`075876` state (re-query; claim `075877`);
  `database.types.ts` regen + worker vendored copy (house rule from 377 U1).

### U2 — SSOT lib `src/lib/purchasing/doc-chase.ts` (+ `tests/unit/doc-chase.test.ts`)

Pure, no IO. Produces everything U3–U6 render.

- `type DocRequirementClass = "vat" | "non_vat" | "unknown"`;
  `docRequirementClass(s: { isVatRegistered: boolean } | null): DocRequirementClass` — null =
  no supplier row (the only reachable unknown; the column is NOT NULL).
- `SATISFYING_DOC_TYPES: Record<DocRequirementClass, readonly PurchaseDocType[]>` (§2 table);
  `NEVER_SATISFYING: readonly ["delivery_note","transfer_slip","other"]`.
- `type DocAttachment = { docType: PurchaseDocType | null; source: "pr" | "po";
purpose: string }`.
- `docCoverage(input: { status: PurchaseRequestStatus; cls: DocRequirementClass;
attachments: DocAttachment[]; waived: boolean }): "out_of_scope" | "covered_typed" |
"covered_loose" | "waived" | "missing"`.
- `chaseAsk(cls): string` — vat → ทวงใบกำกับภาษีเต็มรูป · non_vat → ขอบิลเงินสด/ใบสำคัญรับเงิน ·
  unknown → ขอเอกสารการซื้อ (labels.ts constants).
- `agingDays(now, deliveredAt, purchasedAt, createdAt): number` — instant math (Date.parse),
  never string compare (spec 375 lesson).
- Tests: class fn over the full boolean|null domain · coverage matrix (each class × typed
  satisfying / typed never-satisfying / untyped-loose / waived / empty · out-of-scope statuses) ·
  every enum member appears in exactly one of SATISFYING(vat∪non_vat) ∪ NEVER_SATISFYING ·
  aging boundary with real encodings (`+00:00` vs `Z`).

### U3 — chase page `/requests/docs` + hub chip (the operator-visible core)

- New `src/app/requests/docs/page.tsx` (+ `loading.tsx`), title ตามเอกสารซื้อ. Server component;
  role gate = **`PURCHASING_ROLES`** (the requireRole set `/requests` itself uses — fact-checked:
  site_admin, project_manager, super_admin, procurement, procurement_manager, project_director;
  `isProcurementWorklist` is a separate VIEW switch, not the gate).
  ⚠ Build note (fact-check): the dashboard alert strip's OUTER wrapper renders only when
  `lateRiskTotal > 0 || arrivalsTotal > 0` — U3 must extend that OR with the docs count or the
  chip is invisible whenever the other two are quiet. Add the mis-flag hint chip (§2 amendment). Reads (RLS): in-
  scope PRs w/ supplier join · both attachment tables (current, id/doc_type/purpose only) ·
  waivers. View model in `src/lib/purchasing/doc-chase-view.ts` (pure, tested): group missing by
  supplier → sort groups by count desc → rows sorted oldest first; group header = supplier name ·
  count · oldest age · class ask (§2 ladder line); row = pr_number · item · age chip
  (>14d danger, 7–14 warn) · per-doc state chips · link `/requests/[id]` (`withBackFrom`).
  Summary chips: total missing · >14d · suppliers. Include waived section (collapsed, labelled
  ยกเว้นโดยบัญชี N) so the state is visible, not silent.
- Hub strip chip in `src/app/procurement/dashboard-body.tsx` beside เสี่ยงช้า/ของเข้าวันนี้:
  amber `ไม่มีเอกสาร N` (term = review-queue's existing label) → `/requests/docs`; renders only
  when N>0 (sibling pattern). Per-project card line `ไม่มีเอกสาร N` via the same one query
  grouped by project. Portfolio grain incl. null-project rows (§0.1 precedent in that file).
- New labels in `src/lib/i18n/labels.ts` (additive): DOC_CHASE_TITLE ตามเอกสารซื้อ ·
  DOC_MISSING_LABEL ไม่มีเอกสาร (align w/ review-queue literal — refactor that file to import iff
  zero-risk, else note) · DOC_COMPLETE_LABEL เอกสารครบ · per-class ask labels · waived label.
- Tests: view-model unit tests (grouping/sorting/aging fixtures, mutation-checked back to
  alphabetical) · page + dashboard source pins (comment-stripped, exact occurrence counts,
  absence of retired forms) · chip-only-when-positive pinned · a11y: aging chips carry text,
  not colour alone.
- Nav gate-check: new route registered per `nav-back-affordance` rules (STATIC_DETAIL +
  hub DRILL_DOWNS if applicable — read the guard's lists at build; `sa/registrations` precedent).

### U4 — `/requests` row chips (done-band rows)

Amber ไม่มีเอกสาร / green เอกสารครบ chip per §3 predicate on the procurement pipeline view.
Filter affordance `?docs=missing`. ⚠ Deliberate divergence, not a bug (fact-check): the PR-detail
`invoiceMissingFlag` asks a NARROWER question — "did the site photograph the paper?" (purpose
`invoice` only, its label says จากหน้างาน) — so an order can be §3-covered by a PO tax invoice
while that line still shows. Both are true; leave the leaf flag alone in this spec.

### U5 — uploader doc_type pickers

> **Amended post-investigation (2026-07-30):** the original bullet undersold real complexity —
> `InvoiceUploader` is ONE shared component mounted at 4 different doc-chase-relevant sites with
> different correct defaults, and `docCoverage`'s typed branch is deliberately purpose/source-blind
> (any attachment with a satisfying `doc_type` counts, regardless of which button uploaded it) —
> confirmed correct, not a bug, and it's what lets U5 type a `proof_of_delivery`-purpose row and
> have it count. ⚠️ The original "receive card → delivery_note" default was WRONG and would have
> been a live regression: today an untyped `purpose='invoice'` row on a `delivered` PR reads
> `covered_loose`; forcing a `delivery_note` default (in `NEVER_SATISFYING`) flips it to `missing`
> on the very upload meant to document it. No card gets a pre-selected default that can make an
> order worse than doing nothing — required-select-no-default, or a default provably safe by
> construction (see below).

Scope, by mount (`src/components/features/purchasing/invoice-uploader.tsx` used at 4 sites +
`create-purchase-order-sheet.tsx` + `self-purchase-form.tsx`):

- **PR receive card** (`/requests/[id]`, status `delivered`) — required select, **no pre-selection**
  (what the driver hands over genuinely varies; a wrong default is worse than an empty one).
- **PR standalone card + procurement grid drawer** (status `purchased`/`site_purchased`) — required
  select, default `tax_invoice_full` at `purchased` (back-office ordered from a vendor) / `receipt_cash_bill`
  at `site_purchased` (SA cash buy) — split on the row's own status, not a single constant.
- **Self-purchase form** (`self-purchase-form.tsx`, always `site_purchased`) — inferred from the
  form's own `vatRate` field (`> 0 → tax_invoice_full`, else `receipt_cash_bill`; the VAT split
  already computed server-side needs a matching doc), select stays visible for override.
- **PO create-sheet** (`create-purchase-order-sheet.tsx`) — required select, default `tax_invoice_full`
  (its own label already says "ใบเสนอราคา / ใบแจ้งหนี้" — two real types behind one button).
- **🔔 Operator decision, NOT built in U5:** `PaymentProofUploader` (payment-slip uploads) stays
  **untyped** (`doc_type` NULL, unchanged covered-loose behaviour). Typing it would require either
  hardcoding `transfer_slip` — which is in `NEVER_SATISFYING`, so every payment-only-proof order
  would silently flip to `missing`, a real coverage drop with no sign-off — or adding a payment-slip
  satisfying type, which the RD ladder (§2) doesn't currently name. Flagged for a future unit once
  the operator rules on it.
- **Follow-up, not U5:** `src/app/projects/[projectId]/incoming/[deliveryId]/page.tsx`'s SA receive
  uploader is labelled "แนบใบส่งของ / ใบเสร็จ" but is actually `ProofOfDeliveryUploader` writing
  `purpose='proof_of_delivery'` — a genuine mislabel independent of doc-chase (the honest-copy
  class). Typing it WOULD work (purpose-blind coverage, confirmed above) but it's a different
  page/subsystem; bundling it here risks scope creep on an already-large unit. Own follow-up.

Shared server-action shape: the one input type all four PR-writing actions
(`addInvoiceAttachment`/`addPaymentProofAttachment`/`addReferenceAttachment`/
`addDeliveryConfirmationPhoto`) already share gains an optional `docType?: PurchaseDocType | null`
field — only `addInvoiceAttachment` (and the new PO/PO-create action) reads and writes it; the
others accept-and-ignore so `InvoiceUploaderProps.action`'s structural type (`typeof
addInvoiceAttachment`) stays satisfied by every current caller. Legacy rows untouched (`doc_type`
stays NULL; §2 decision ② covered-loose grandfathering is unaffected).

### U6 — accounting side (DANGER, operator merge) — ✅ BUILT 2026-08-05 (mig `20260813075909`)

> **As-built notes.**
>
> **A THIRD doc_count defect, found at build time and fixed here.** §1 named two (purpose-blind,
> PO-blind); the old subquery also **counted TOMBSTONES**. In these two attachment tables a delete
> is an append-only, payload-less row carrying `superseded_by` → the row it retires (enforced by
> `pra_tombstone_shape` / `poa_tombstone_shape`: `superseded_by is null OR storage_path is null`).
> Nothing points AT a tombstone, so the old not-pointed-at anti-join kept it and a **DELETED
> invoice still read as a document** — live on purchase request `c7f61658-967d-4099-a9fd-639c46b5100e`.
> Reading through `purchase_*_attachments_current` fixes it. ⚠️ I first mis-read this as a DEFECT in
> those views (they look like they drop both rows of a supersede pair) and nearly re-derived the
> predicate; the CHECK constraint one layer down settled it — the views are correct, the anti-join
> was not.
>
> **The waiver had to reach the tab, which the U6 text above does not say.** §3 counts a waiver as
> coverage but the `no_docs` arm was `dexp = 'expected' and dc = 0`, so a waived dead-end order
> would sit in the ไม่มีเอกสาร tab forever and the waiver would be **inert in the very queue its
> button lives in**. Fixed with a `wv` flag carried through the union (`false` on all 14 non-PR
> arms) and `and not j.wv` on that arm. ⭐ Deliberately NOT done by counting the waiver as a
> document: `doc_count` is rendered (`docsBadgeLabel`) and CSV-exported, so inflating it would put
> a lie in an export. A waiver is not a document; it discharges the tab, not the count.
>
> **Measured live before/after** (643 purchase requests): the tab goes **620 → 357**; **269 leave**
> (they always carried a PO `source_document` the count could not see) and **6 enter** (only a
> reference/delivery photo — never documented).
>
> The per-class rule lives in ONE place, `purchase_doc_satisfying_types(boolean)`, so the PR half
> and the PO half cannot drift; it mirrors `SATISFYING_DOC_TYPES` in `doc-chase.ts` and both sides
> are pinned to the same literal table.
>
> **🔔 TWO OPERATOR QUESTIONS raised by the U6 review — both are consequences of the §3 SSOT, not
> deviations from it, so U6 implements the SSOT and asks rather than quietly changing it.**
>
> **Q1 — one PO document discharges every order under that PO.** The PO half joins on
> `purchase_order_id` with no per-line narrowing (exactly as `docCoverage` does), so a single
> `source_document` covers all N purchase requests on that order. That fan-out is most of the 269
> orders that leave the tab. For the accounting queue this matters because the input-VAT claim is
> per tax invoice per order, and U5 defaults the PO create-sheet uploader to `tax_invoice_full` —
> so one typed document on a PO can discharge ~20 orders' accounting evidence at once. **Is that
> the intent, or should a PO document cover only the order it was uploaded against?**
>
> **Q2 — the PO half classes by the REQUEST's supplier, not the ORDER's.** A purchase request with
> no `supplier_id` classes `unknown` (full fallback ladder) even when the order it hangs off has a
> VAT-registered supplier — so a `receipt_cash_bill` on that PO discharges it, which is precisely
> the gap §2 exists to close. **Should the class fall back to the purchase order's supplier when
> the request has none?** (Cheap to change; it is a one-line `coalesce` in both halves.)
>
> **Recorded, NOT built (own follow-ups):** ① the RPC's `events` CTE never status-filters, so the
> ~84 `cancelled`/`rejected` purchase requests are money events in the ไม่มีเอกสาร tab — that is
> the residual between 357 and the chase page's ~272, and it is a scope question, not a count one.
> ② the review-queue LIST does not know the waived state (the RPC's return type is unchanged on
> purpose — a new column is a return-type change ⇒ `drop function` + regen + every pgTAP
> `with ordinality` site), so a waived order still shows the `ไม่มีเอกสาร` chip in the `any`
> /`pending` tabs. The chip's own words stay literally true (the order genuinely has no documents —
> it was waived, not documented), so this is a discoverability gap rather than a false statement;
> it is listed here so the next reader meets a decision instead of re-finding it. Both are cheap
> once someone wants them.
>
> **From the fresh-eyes review, fixed in this unit rather than deferred:** the voucher's document
> LIST is every attachment on the purchase request while `doc_count` is now the class-aware
> accounting-document test including PO-level documents — so the two could disagree in BOTH
> directions and the page would silently contradict the queue chip that sent the accountant to it
> (a VAT vendor's cash bill: chip says ไม่มีเอกสาร, voucher lists the file; a PO-covered order: no
> chip, voucher said "ไม่มีเอกสารแนบ"). The page now names which is which. Also fixed: the waiver
> read moved off the admin client (the table is NOT sealed — `authenticated` holds SELECT and the
> RLS policy admits money reviewers directly), the reason list is now derived from the generated
> enum constants instead of a hand-list that `readonly T[]` would have accepted as a subset, and
> `database.types.ts` + the worker's ADR-0047 copy were regenerated for the new helper.

- Waiver buttons (waive/unwaive w/ reason+note) on the review voucher action panel, gated
  MONEY_REVIEW_ROLES (UI) + the U1 RPC (DB).
- `list_money_events_for_review` doc_count for `purchase_requests` becomes the §3 union WITH the
  purpose filter on the PR half (`invoice`/`payment` or a typed satisfying `doc_type`) + current
  PO `source_document` — fixing both the over-count and the purpose-blind under-count; body
  reproduced from LIVE def verbatim except that subquery (byte-diff proof, 345 U4 discipline);
  pgTAP updated.

## 5. Non-goals / later

- LINE/OA nudges + weekly digest (complement, own spec after v1 proves use).
- Hard gate "no doc photo → cannot close receive" — operator explicitly not asked; revisit
  after 2 weeks of chase-list data.
- `individual` supplier flag (บุคคลธรรมดา) — folded into non_vat path v1; add a suppliers
  column only when a real payment-voucher flow needs it.
- Backfill doc_type on 393 legacy attachments (accounting can re-tag opportunistically via U6+).
- Per-supplier collections view (วางบิล cycle calendar).

## 6. Risks

- Dashboard adds 2 portfolio-wide id-only reads — measure; hub renders at 780 views/14d.
- `doc_type` null-vs-typed mixing: predicate centralised in U2; every surface must import it
  (source-pinned) — no local re-derivations.
- Waiver misuse: reason enum + note + audit row + visible ยกเว้นโดยบัญชี section.

## 7. U7 — a `quotation` doc type (operator ruling 2026-08-05)

> **Origin:** the accounting team's 8-stage document request opens with ใบเสนอราคา. Today that
> stage has no category of its own, so a quotation attached at PO creation is stored as `other`
> — the shrug type. **Operator ruling 2026-08-05: add `quotation` ONLY; defer `price_comparison`
> until a real comparison table exists.** This section is the design; it is written before any
> code per the doctrine's spec-first gate, and every number in it was measured live 2026-08-06,
> not inherited from §1's 2026-07-30 grounding.

### 7.1 Live grounding (measured 2026-08-06 — read this before judging the unit's value)

| Fact                                                                      | Value                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Current attachments carrying a `doc_type`                                 | **0 of 427** (both tables, through the `_current` views) |
| Last PR attachment of any purpose                                         | **2026-07-27**                                           |
| Last PO `source_document`                                                 | **2026-07-21**                                           |
| U5 (the pickers) merged                                                   | 2026-07-30                                               |
| POs created / PRs created / PRs delivered since U5                        | **13 / 29 / 36**                                         |
| `purchase_quotes` rows · PRs with a quote · `purpose='quote'` attachments | **2 · 2 · 0**                                            |
| Places `DOC_TYPE_LABEL` renders                                           | **2 — both of them the pickers themselves**              |

Three things follow, and they shape the unit rather than block it:

1. **`doc_type` has never been written in production, and U5 did not cause that.** Both upload
   paths went quiet **3 and 9 days _before_ U5 shipped**, while real purchasing continued (13
   POs, 36 deliveries since). So the pickers are **unproven, not proven-dead** — the U5 →
   fill-rate-zero reading that the doctrine's rules would normally invite is refuted by the
   dates. This unit adds vocabulary to a write path whose first real use is still ahead of it.
2. **"Searchable category" is achieved at the DATA layer only.** `DOC_TYPE_LABEL` renders in
   exactly two places and both are the pickers; no list, badge, chip or export shows a stored
   `doc_type` back, and nothing filters by it. Adding the enum value makes the distinction
   _recordable and queryable_; it does not by itself make it _findable in the UI_. Stated here
   so the next reader meets a decision instead of assuming a search exists (§7.7).
3. **The operator's deferral of `price_comparison` is correct, and now evidenced.** A comparison
   surface exists in code (`price-comparison.tsx`, `QuoteDocAttach`) and a table exists
   (`purchase_quotes`) — but it holds **2 rows across 2 purchase requests, with 0 quote
   attachments all-time**. There is no comparison practice to categorise yet.

### 7.2 Which "lands as `other`" — the PO create-sheet, exactly

`create-purchase-order-sheet.tsx` is the mount the ruling is about, and its own U5 comment says
so: _"the attach here is normally a QUOTATION … 'other' is the one type that appears in NO
class's satisfying set"_. U5 chose `other` deliberately and for a good reason — it needed a
default that an unread select could never turn into a false VAT claim — but it chose from a
list that had no honest option. **Now one exists.**

The other quotation path (`QuoteDocAttach` → `purpose='quote'`, feeding `PriceComparison`) is
**not** in scope: it is a different surface, it carries its meaning in `purpose` already, and it
has zero rows. Recorded in §7.7.

### 7.3 The class rule — `quotation` NEVER satisfies

A quotation is a **pre-transaction offer**. It proves neither that a payment happened nor who
received it, so it cannot be an เอกสารประกอบการลงบัญชี under ม.65 ตรี (18) — the same reasoning
that puts `delivery_note` (proves goods, not payee) and `transfer_slip` (proves payment, not
payee) in that class. It is, if anything, the clearest member: the other two at least evidence
a completed leg of the transaction; a quote evidences none.

⇒ `quotation` joins `NEVER_SATISFYING` and appears in **no** class's satisfying set. This is
pinned on **both** sides of the SSOT pair, which §4 U6 established must move together:

- **TS** — `NEVER_SATISFYING` in `src/lib/purchasing/doc-chase.ts`.
- **SQL** — `purchase_doc_satisfying_types(boolean)` (mig `075909`), the one SQL home of the
  per-class rule, whose returned arrays simply must not contain it.

`purchase_doc_satisfying_types`' **body does not change** — a never-satisfying type is defined
by absence. That is precisely why the SQL side needs a new **partition assertion** rather than
another equality pin: today nothing in pgTAP reds when the enum grows, so the SQL half of the
rule can silently fall behind the TS half (which _does_ have that guard —
`doc-chase.test.ts` "every enum member is either satisfying-for-someone or never-satisfying").
U7 closes that asymmetry (§7.6).

⚠ **Be precise about what the enum add does and does not do.** `NEVER_SATISFYING` has **no
production consumer** — `docCoverage` keys off `SATISFYING_DOC_TYPES` alone, so any type
outside it already reads as missing. Adding `quotation` to the enum is therefore
**behaviour-neutral by construction**: no existing order changes verdict, `doc_count` is
untouched, and the class list is a _declaration_ rather than a gate. What makes that
declaration binding is the pair of partition tests, one per side — which is why they are the
substance of this unit and not decoration around it.

### 7.4 Enum position

`alter type public.purchase_doc_type add value if not exists 'quotation' before 'other';`

- **Positioned, not appended.** The house pattern appends, but `enum_range` order is pinned
  exactly in pgTAP and reads as documentation of the classes. Placing `quotation` after
  `transfer_slip` groups it with the never-satisfying supporting documents and keeps `other`
  — the catch-all — last, where a catch-all belongs.
- **Safe:** nothing in `src/` or `supabase/migrations/` orders by `doc_type` (verified by
  grep), and every picker renders from its own hand-listed array, so enum ordinal position is
  presentation-neutral. `Constants.public.Enums.purchase_doc_type` is iterated order-independently.
- **Additive only.** No row carries the value, no coverage verdict changes, `doc_count` is
  untouched. The migration adds vocabulary and nothing else.
- PG 17: `ADD VALUE` inside a transaction block is permitted; the new value may not be _used_ in
  the same transaction. This migration only adds it — no function body, CHECK or index
  references it — so the restriction is not engaged.

### 7.5 The PO create-sheet default flips `other` → `quotation`

`PO_DOC_TYPE_SAFE_DEFAULT` becomes `"quotation"`, and `PO_DOC_TYPES` gains it **first** (it is
the default and, per U5's own note, the normal attachment at PO creation); `other` stays last.

**The safety property U5 chose `other` for is preserved exactly.** `quotation` is in
`NEVER_SATISFYING`, so an unread default can still only ever **under**-claim: a buyer who
attaches a real invoice and never opens the select gets an order that keeps being chased —
annoying, recoverable, and the direction the RD risk runs. What changes is that the **common**
case is now recorded truthfully instead of as a shrug.

**Changing what a control does makes its label part of the change** — so every surface naming
this control is re-justified here, not assumed:

| Surface                                                | Verdict after the flip                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attach button `แนบใบเสนอราคา / ใบแจ้งหนี้ (ไม่บังคับ)` | **Keep — and it is now _more_ true than before.** It names two documents; until U7 only one of them had a type. Pinned so it cannot drift away from the default it now agrees with.       |
| Select `aria-label` = `DOC_TYPE_PICKER_LABEL`          | Keep — axis-generic ("ประเภทเอกสาร"), correct for any default.                                                                                                                            |
| No placeholder option on this select                   | Keep — unlike `DocTypeInvoiceUploader` this mount always has a default, so a "choose one" placeholder would be dead. The two mounts differ on purpose.                                    |
| Empty state (no file attached ⇒ no select renders)     | Keep — unchanged and still correct.                                                                                                                                                       |
| Reset-on-remove `setDocType(PO_DOC_TYPE_SAFE_DEFAULT)` | Follows the constant; no edit needed, but the test asserting it resets to `other` must be updated **deliberately** (its comment states the old rationale as fact).                        |
| The two U5 code comments (lines ~71 and ~151)          | **Now false — rewritten.** Both assert that a quote "never satisfies doc-chase → `other`" and that `other` is the only safe default. A comment stating a retired rationale re-teaches it. |

**Deliberately NOT changed:** `STRICT_DOC_TYPES` and `WIDE_DOC_TYPES` in
`doc-type-invoice-uploader.tsx`. Those mounts fire **after** money is spent — the receive card
asks "what did the driver hand over", the standalone/drawer mounts ask "which accounting
document arrived". A quotation is neither. Offering it there would invite a mislabel on the
exact surfaces the chase list reads. Recorded as an exclusion so it is a decision, not a
gap.

### 7.6 Tests, and the guards this trips on purpose

An enum add trips guards **by design**; none is weakened, and every new value is classified in
the same unit.

- `supabase/tests/database/380-purchase-doc-types.test.sql` — the `enum_range` `results_eq`
  pin gains `quotation` in its exact position.
- `supabase/tests/database/380b-doc-count-union.test.sql` — the SQL home of the class rule:
  1. `quotation` absent from `purchase_doc_satisfying_types(true)`, `(false)` and `(null)`;
  2. **behavioural** — a delivered order whose only current attachment is typed `quotation`
     reads `doc_count = 0` and sits in the ไม่มีเอกสาร tab (a positive control already exists
     alongside, so "absent" cannot pass by the tab being empty);
  3. **the partition assertion (new):** satisfying(vat) ∪ satisfying(non_vat) ∪ the
     never-satisfying list must equal the **complete** enum domain, so the next value added
     reds until someone classifies it. This is the SQL mirror of the TS guard that already
     exists and is what stops the two halves drifting again.
     Plan counts bumped by derivation (`grep -cE '^select (ok|is|results_eq|…)'`), never by hand.
- `tests/unit/doc-chase.test.ts` — the partition test reds until `NEVER_SATISFYING` gains
  `quotation`; the never-satisfying coverage loop then exercises it automatically.
- `tests/unit/create-purchase-order-sheet-doc-type.test.tsx` — the three `other` assertions
  become `quotation`, with their rationale comments rewritten rather than deleted.
- `src/lib/i18n/labels.ts` — `DOC_TYPE_LABEL` is a `Record` over the enum, so **typecheck**
  reds until `quotation: "ใบเสนอราคา"` exists. That is the guard working.
- `pnpm db:types` → `database.types.ts` **and** the worker's ADR-0047 byte-identical copy
  (`db-types-sync.test.ts`). Safe here because live == main was verified at claim time.
- ⚠ `doc-type-defaults.ts` was flagged as a likely trip; read at HEAD it switches over
  `PurchaseRequestStatus`, not over `purchase_doc_type`, so it should **not** red. Treated as a
  claim to be confirmed by the run, not a fact — if it stays green when expected to red, that
  is itself a finding (an unexpected green means the test does not reach the code).

### 7.7 Recorded, NOT built

- **No surface shows or filters a stored `doc_type`** (§7.1 ③). The natural next unit is a
  type chip on the attachment lists + a `?docType=` filter on the chase page. Acceptance for
  U7 itself is a fill-rate query, not a screenshot:
  `select coalesce(doc_type::text,'(untyped)'), count(*) from purchase_request_attachments_current group by 1`
  (plus the PO twin) — `quotation` moving off 0 is the proof the category is being used.
- **`QuoteDocAttach` / `purchase_quotes` stay untyped**, so two quotation paths now describe
  themselves differently (one by `purpose`, one by `doc_type`). Harmless at 2 rows; revisit if
  the comparison practice ever starts.
- **`price_comparison` deferred** by operator ruling, with §7.1 ③ as the evidence.
- The two §4 U6 operator questions (one PO document discharges every order under it; the PO
  half classes by the request's supplier, not the order's) remain **open and unaffected** by
  U7 — a never-satisfying type changes neither fan-out nor class derivation.
