# Spec 211 — Procurement terminology & level clarity

**Status:** in progress — U1–U7 + U10a shipped (#97–#104), U10b shipping
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

**Deferred → U6b:** the breadcrumb `จัดซื้อ › ใบสั่งซื้อ PO-0012` and the `?from=` PR→PO referrer back-href (so a PR reached from its PO returns to the PO). Kept separate to keep this unit a clean rename.

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
- **U10c — store noun:** `site-store-08`. One place-noun `คลัง` (retire `สโตร์`; reserve `สต๊อก` for quantity). _(queued)_
- **U10d — misc:** supplier-ref field off `เลขที่ใบสั่งซื้อ` (`terminology-02`), PR-stepper aria-label `สถานะการสั่งซื้อ`→`สถานะคำขอซื้อ` (`terminology-04`), dispatch button wording (`delivery-receiving-05`), one `CREATE_PO_LABEL`. _(queued)_

### U11 — Site / supply-plan buy-action consolidation

Critic gaps X4/X5, `site-store-03`. Co-locate the three buy actions under one chooser; one vocabulary for the supply-plan→PR conversion; visually type `site_purchased` PRs.

---

## Verification (every unit)

`pnpm lint && pnpm typecheck && pnpm test` green. Label changes are display-only (logic keys on enums), so unit tests + the cross-map guard are the proof; no DB/migration.
