# Spec 211 — Procurement terminology & level clarity

**Status:** in progress — U1–U7 + U10a/b/c shipped (#97–#106), U10d shipping (batched)
**Source:** operator report — "admins cannot intuitively distinguish the PO from the PO Items." Full evidence: [`docs/procurement-uxui-audit-2026-06.md`](../procurement-uxui-audit-2026-06.md) (multi-agent audit, 85 surfaces, 91 verified findings).

## Problem (root cause)

The confusion is structural, not cosmetic:

1. **A "PO Item" _is_ a Purchase Request.** There is no `po_line_items` table — `purchase_requests` rows _are_ the line items, joined to a PO via `purchase_order_id`. A PO has **no status/total column**; both are derived from its member PR rows (`derivePurchaseOrderStatus` / `purchaseOrderTotal` in `src/lib/purchasing/purchase-order.ts`). So a PO literally **borrows its members' status vocabulary**.
2. **The whole area is named after the PR.** The single nav tab (`src/components/features/chrome/hub-nav.tsx`) labels `/requests` as `คำขอซื้อ` in every role tab-set, and the PO detail lives _under_ that route at `/requests/orders/[poId]`.
3. **Two entities share one label map.** `PURCHASE_REQUEST_STATUS_LABEL.purchased` and `PURCHASE_ORDER_STATUS_LABEL.ordered` are both `สั่งซื้อแล้ว`; `on_route` and `in_transit` are both `กำลังจัดส่ง` (`src/lib/i18n/labels.ts:48,126`). On the PO detail the order pill and a line pill can render the identical word.

The verifier downgraded individual findings to "low" by judging each label atomically, but the felt confusion is the **compound** of terminology + consistency drift — and the worst issues were independently rediscovered 6–9 times across agents. That convergence is the priority signal.

## Approach

Single-source the vocabulary and make the PR/PO **level** legible. Most of Phase 1 is `src/lib/i18n/labels.ts` + a format helper — code-only, behaviour-preserving, auto-mergeable behind the build fence. Each unit is test-first and shippable on its own. **Implement exactly the unit; do not bundle units.**

---

## Units

### U1 — Split the PO status vocabulary from the PR status vocabulary _(SHIPPED #97)_

The purest form of the reported pain (audit `po-vs-items-01`, confirmed **high**; rediscovered ×9).

**Change** — `src/lib/i18n/labels.ts`, `PURCHASE_ORDER_STATUS_LABEL` only (leave `PURCHASE_REQUEST_STATUS_LABEL` untouched — those are correct line-level words):

| key          | before         | after               | rationale                                                          |
| ------------ | -------------- | ------------------- | ------------------------------------------------------------------ |
| `ordered`    | `สั่งซื้อแล้ว` | `ออกใบสั่งซื้อแล้ว` | order-level: the PO has been _issued_, vs a line that was _bought_ |
| `in_transit` | `กำลังจัดส่ง`  | `กำลังจัดส่งทั้งใบ` | order-level: the whole order is on the way, vs one line on_route   |

`open` (`ยังไม่สั่งซื้อ`), `partially_received` (`รับของบางส่วน`), `received` (`รับของครบแล้ว`) already read as order-level and don't collide — unchanged.

**Guard (test-first)** — extend `tests/unit/i18n-labels.test.ts` with a cross-map invariant: `PURCHASE_REQUEST_STATUS_LABEL` and `PURCHASE_ORDER_STATUS_LABEL` must share **no** string value, so a line pill and an order pill can never read identically again (the [[money-format-ssot]]-style regression guard). Plus pin the two new strings.

**Out of scope for U1:** the PO progress-stepper verbs (`สั่งซื้อ/จัดส่ง/รับของ` in `purchase-order-tracker.tsx`) — they don't collide identically; addressed under U4.

### U2 — Visually type the IDs (`PO-####` vs `PR-####`) _(SHIPPED #98)_

`po-vs-items-02`, `terminology-10`, `pr-lifecycle-13`, `worklist-hub-10`. Add `formatPoNumber()` / `formatPrNumber()` SSOT helpers (zero-pad 4) — fixes the bare-vs-padded inconsistency (`PR-7` in grid vs `PR-0007` in drawer) — and give `PO-####` a distinct chip (Package icon + `ใบสั่งซื้อ`) everywhere, PR plain. Code-only.

### U3 — De-overload `รายการ` _(SHIPPED #99 — procurement worklist scope)_

`po-vs-items-03`, `terminology-07`, `worklist-hub-04`. Reserve `รายการ` for genuine line-items. On the worklist grid: column header → `สิ่งที่ขอซื้อ`; bundle hint → `เลือกหลายคำขอ…`; selection count → `เลือก {n} คำขอ`; drawer doc count → `{n} ไฟล์`. The PO line-count (`{n} รายการ` on a PO group/header) is a correct line-item use and is KEPT. The accounting register count (`{n} รายการ` → `{n} ใบขอซื้อ`, `accounting-ap-02`) is moved to U9 (the accounting pass), keeping U3 a single-file procurement change. Code-only.

### U4 — Status icons app-wide _(SHIPPED #102 — operator-directed)_

`po-detail-03`, `po-vs-items-06`, `po-detail-06`. Operator (2026-06-27): "use icons to distinguish statuses, consistent with detail pages." Rather than restyle the PO pill colour (which would regress the spec-20 sun-readable solid fills), give **every** status pill a colour-independent **icon** — a state-distinguishing glyph that also serves sun-glare + colour-blind legibility, and resolves PO-vs-line level confusion (PO `ordered` = `FileText` "ออกใบสั่งซื้อ" vs PR `purchased` = `ShoppingCart`).

New SSOT `src/lib/status-icons.ts` parallel to `status-colors.ts`: icon maps + accessor fns for all 7 domains (WP / project / approval / report / PR-priority / PR-status / PO-status), `Record<Enum, LucideIcon>` so a new enum value is a type error. `StatusPill` gains an optional `icon` prop (renders the glyph before the label; backward-compatible). All **28** `StatusPill` call sites across **18** files pass `icon={domainIcon(sameArg)}` — applied by a one-agent-per-file workflow, so it renders identically on the worklist AND every detail page / card / tracker (operator's "consistent with detail pages"). Test-first `status-icons.test.ts` (totality, mirrors i18n-labels). Cross-domain consistency: Check=done, X=negative, Clock=waiting, Truck=shipping, PackageCheck=received. Code-only. **Scope chosen: app-wide** (every StatusPill domain), not procurement-only. Feedback-status pills use a separate mechanism (not `StatusPill`) → follow-up.

### U5 — PO membership visible in every band _(SHIPPED #100)_

`worklist-hub-06` (high). Show a `PO-####` chip (`<PoNumberTag>` from U2) on any worklist row/card with a `purchase_order_id`, in every band and on both phone and desktop (today the PO header only renders in the `in_transit` band — `procurement-grid.tsx` `meta.band==="in_transit"` gate). The page fetches `po_number` for every PO any row belongs to (`poNumberById`), bakes it onto `ProcurementGridRecord.po_number` + passes `poNumber` to `PurchaseRequestCard`; the grid shows the per-row chip outside `in_transit` (which keeps its group header), the phone card shows it whenever the request has a PO. Code-only.

### U6 — Make the level legible in nav _(this unit — nav rename + back-labels)_

`worklist-hub-05`, `po-vs-items-05`, `pr-lifecycle-09`, `delivery-receiving-02`, `terminology-03`. **This unit:** rename the nav landmark from `คำขอซื้อ` (which named the whole area after just the PR) to the neutral umbrella **`จัดซื้อ`** — in BOTH nav sources (`hub-nav.tsx` desktop strip + `bottom-tab-bar.tsx` phone bar, all role tab-sets) plus the worklist page title/kicker; and fix the back-chips that read `กลับไปคำขอซื้อ` on a **PO** detail (and the PR detail) → `กลับไปจัดซื้อ`. The PR-concept term `คำขอซื้อ` stays for the actual purchase-request list/empty-state/create buttons. Not a danger path; high-visibility (every role's nav).

**Deferred → U6b _(now SHIPPED)_.**

### U6b — Breadcrumb + PR→PO referrer back-href _(SHIPPED — this unit)_

The two pieces split out of U6, both safe nav polish. **(1)** New server-safe `<PoBreadcrumb>` (`src/components/features/purchasing/po-breadcrumb.tsx`, parallel to U2's `PoNumberTag`) renders `จัดซื้อ › ใบสั่งซื้อ [PO-####]` in the PO-detail `DetailHeader` nameplate (replacing the bare `<PoNumberTag>` eyebrow) — the `จัดซื้อ` area crumb links back to `/requests` (the U6 landmark), the order crumb is terminal (`aria-current="page"`, the typed chip). Names the level the operator couldn't read. **(2)** `?from=` PR→PO back-href: the PO detail wraps each member-PR link in `withBackFrom(.../requests/{id}, /requests/orders/{poId})`; the PR detail reads `?from` → `safeBackHref(from, "/requests")` for its back chip — so a PR opened from its PO returns to the PO, while every other entry point keeps the `/requests` fallback. Built on the already-tested `src/lib/nav/back-href.ts` primitives (same mechanism as WP / feedback detail). Test-first `po-breadcrumb.test.tsx`. Code-only.

### U7 — One band-label SSOT _(SHIPPED #103 — procurement view)_

`worklist-hub-08`. New `PROCUREMENT_BAND_LABEL` SSOT in `procurement-pipeline.ts`, consumed by the pipeline band headers (`PROCUREMENT_BANDS`), the status-chip filter (`worklist-status-chips.ts`) and the KPI tiles (`worklist-kpis.ts`) — so a band reads ONE way on the procurement screen. The visible fix: the `to_order` chip was `อนุมัติแล้ว` while the header + tile were `รอสั่งซื้อ`; the chip now uses the canonical `รอสั่งซื้อ`. `in_transit`/`overdue` already agreed and are now SSOT-sourced (no visible change). Test-first: flipped the chip-label assertion + added `band-label-ssot.test.ts` (the three sources must derive from `PROCUREMENT_BAND_LABEL`). Code-only.

**Deferred (cross-engine):** the SITE band engine (`request-bands.ts`, a different role-view with its own banding — e.g. `to_order` = `อนุมัติแล้ว รอสั่งซื้อ`) is NOT force-unified here (critic gap: site vs procurement are two parallel band engines over one table; reconciling them is its own change). `terminology-05`/`worklist-hub-16` cross-view reconciliation tracked there.

### U8 — Notification PO-awareness _(operator-held: danger path)_

Critic gap X1. `src/lib/notifications/compose-notification.ts` pushes raw PR status words to LINE with no PO/supplier context — the headline confusion reaches the user pre-screen. `src/lib/notifications/**` is a danger path → PR will be held for operator merge.

### U9 — Accounting trail _(operator-held: danger path)_

Critic gap X3 / `accounting-ap-03/04/05`. Use `formatPoNumber()` (from U2) on the voucher (`#3` → `PO-0003`), make the linked PO a live link, group the register by PO with a subtotal, and rename the register count `{n} รายการ` → `{n} ใบขอซื้อ` (`accounting-ap-02`, moved here from U3). `src/lib/accounting/**` is a danger path → held.

### U10 — Remaining terminology SSOT _(split into sub-units — done incrementally)_

A cluster of independent term fixes, shipped as small focused sub-units rather than one grab-bag:

- **U10a — delivery-installment term _(SHIPPED this unit)_:** `terminology-08`/`delivery-receiving-01`. New `deliveryOrdinalLabel(n)` SSOT in `po-deliveries.ts` → `งวดจัดส่งที่ N`, used by the deliveries section, the per-`งวด` tracker, and the delivery detail title. Disambiguates the PO shipment installment from `งวดงาน` (the billing/work milestone on deliverables + schedule gantt — deliberately left as `งวดที่`). Test-first `delivery-ordinal-label.test.ts`. Code-only.
- **U10b — ETA term _(SHIPPED this unit)_:** `worklist-hub-13`. New `ETA_LABEL = "กำหนดรับของ"` in labels.ts, used for the record's expected-arrival display on the grid header (`สถานะ / ETA` → `สถานะ / กำหนดรับของ`), the grid cell (was English `ETA`), the review drawer (was `คาดว่าจะได้รับ`) and the PO group card. The set-the-date FORM inputs (create-PO sheet, purchase-record-form) keep their own `คาดว่าจะได้รับของ` prompt (input intent vs display). Test-first (grid-terminology test asserts the header drops English ETA). Code-only.
- **U10c — store noun _(SHIPPED this unit)_:** `site-store-08`. Retired `สโตร์` (English-loanword duplicate of the store) → the SSOT place-noun `คลัง`, across labels (`STORE_RETURN_TO_STORE_LABEL`→`คืนเข้าคลัง`, `STORE_PNL_LABEL`→`กำไร-ขาดทุนคลัง`), store actions errors, the PR form, store-count-manager, store-manager, wp-issue-stock, and validate-purchase-request. `สต๊อก` (= stock/quantity) is left intact — that's the kept distinction (`คลัง`=place, `สต๊อก`=quantity). Tests `store-returns-labels` + `wp-issue-stock` updated in lockstep. Conservative scope: the `สต๊อก`-as-place reframing of a couple of StoreManager headings is deferred (debatable place-vs-quantity). Code-only.
- **U10d — misc terminology, BATCHED _(SHIPPED this unit)_:** operator asked to batch the small leftovers into one PR. (1) new `CREATE_PO_LABEL = "สร้างใบสั่งซื้อ"` SSOT → bundle bar, drawer, sheet title, single-PR button, price-comparison (dropped the bare English "PO"; `terminology-06`/`worklist-hub-07`). (2) supplier-ref field `เลขที่ใบสั่งซื้อ…` → `เลขอ้างอิงผู้ขาย` on the create-PO sheet + record-purchase form + its validator (it's the supplier's external ref, not the system PO#; `terminology-02`). (3) PR-stepper aria `สถานะการสั่งซื้อ` → `สถานะคำขอซื้อ` (`terminology-04`). (4) dispatch button `บันทึกการจัดส่ง` → `บันทึกว่ากำลังจัดส่ง` (marks on-the-way, not a completed delivery; `delivery-receiving-05`). (5) `สร้าง PR แล้ว` → `สร้างคำขอซื้อแล้ว` (English-acronym leak). Lockstep test updates (create-PO-sheet, phone-basket, supply-plan-manager). Applied by a one-agent-per-file workflow. Code-only.

### U11 — Self-purchase consolidation _(operator-steered 2026-06-27)_

Critic gaps X4/X5, `site-store-03`. **Operator steer (supersedes the original "one chooser over all three"):** _"PR is PR, self purchase is self purchase. Self purchase needs at least 2 types of image uploads: (1) item image, (2) docs like invoices/receipts. Consolidate in 1 place."_ So PR (`สร้างคำขอซื้อ` = ask procurement, the PR→PO pipeline) stays its own distinct affordance; the **two self-purchase actions consolidate into one place**; and self-purchase gains an item-image upload on top of the docs upload it already has.

**Ground truth (WP detail page):** the two self-purchase actions sit in **different tabs** today — `#2 บันทึกการซื้อหน้างาน` (`SitePurchaseForm` → `record_site_purchase`; off-catalog free-text, WITH VAT-invoice — already reveals an `InvoiceUploader` for `แนบใบส่งของ / ใบเสร็จ` = the **docs** image, purpose `invoice`) lives in the `คำขอซื้อ` tab; `#3 ซื้อเงินสด ใช้ที่งานนี้เลย` (`SitePurchaseUseNow` → `site_purchase_use_now`; catalogued, cash, no-invoice, receive-into-store + เบิก at cost) lives in the `เบิกของ` tab. Both are `!readOnly`-gated. The `purchase_request_attachment_purpose` enum **already** has `invoice` (docs) and `reference` (item image) — so the image requirement is **code-only, no migration**.

- **U11a — consolidate the entry _(SHIPPED this unit)_:** new `<SelfPurchaseSection>` groups `#2` + `#3` under one **`ซื้อเอง`** heading (with a one-line invoice-vs-cash hint to pick the right one), rendered in the `คำขอซื้อ` tab below the PR group (`สร้างคำขอซื้อ` stays separate — "PR is PR"); `#3` is removed from the `เบิกของ` tab, which keeps the pure `WpIssueStock` withdraw. Self-purchase is now in one place. Test-first `self-purchase-section.test.tsx`. Code-only.
- **U11b — item-image upload _(SHIPPED — this unit)_:** a self-purchase now carries TWO image types — the item photo AND the receipt/invoice docs. **Correction to the earlier "code-only" estimate:** the `reference` attachment INSERT RLS arm only admitted status `requested` (creation time), so a `site_purchased` self-purchase could attach the receipt (`invoice` arm) but not an item photo (`reference` arm). U11b therefore needed an **additive RLS migration** (`20260813003900`) widening the `reference` arm to also admit `site_purchased` (DROP+CREATE in place, reconstructed verbatim from the live spec-182-U4 policy; only the reference arm changed; storage policy already admitted `site_purchased` uploads). New `addReferenceAttachment` action (mirrors `addInvoiceAttachment`, purpose `reference`, gated to `site_purchased`) + thin `ItemPhotoUploader` (reuses `InvoiceUploader`, label `แนบรูปสินค้า`), shown alongside the docs uploader in `SitePurchaseForm`'s success state. Scope: only `#2` (the recorded site-purchase) has a PR to attach to — `#3` (`site_purchase_use_now`) writes straight to stock movements with no `purchase_request`, so item images there would be a separate, larger feature. Test-first `site-purchase-form-photos.test.tsx` (both uploaders after recording) + pgTAP `33-site-purchase.test.sql` E.1/E.2 (reference admitted at `site_purchased`, still denied at `on_route`). **Danger-path (RLS) → operator-held PR.**
- **U11c — deeper merge _(deferred, optional)_:** a single self-purchase form with an invoice-vs-cash toggle (one form, routes to the right RPC) would change the data/posting flow → its own unit, raised before building.

---

## Verification (every unit)

`pnpm lint && pnpm typecheck && pnpm test` green. Label changes are display-only (logic keys on enums), so unit tests + the cross-map guard are the proof; no DB/migration.
