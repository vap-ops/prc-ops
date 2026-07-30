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

`InvoiceUploader` (PR) + PO source-doc + receive-page uploaders gain a required type select
(defaults per context: PR invoice card → receipt_cash_bill · PO source doc → tax_invoice_full ·
receive card → delivery_note). Server actions in `src/app/requests/actions.ts` pass `doc_type`.
Legacy rows untouched.

### U6 — accounting side (DANGER, operator merge)

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
