# Spec 208 — store-centric procurement (everything → store → เบิก)

**Status:** PROPOSED — 2026-06-26. Trigger: in-app feedback **6fbcc039**
("จัดซื้อไม่สามารถรับของเข้าคลังได้" — procurement can't receive into the store,
filed from `/projects`). Investigation found every gate already admits procurement,
so the report is a **discoverability + redundant-picker** defect, not a permission
gate defect. This spec fixes that report _and_ realises the operator's three
store-centric rules across the whole procurement model.

**Phase 1 (U1–U3) is autonomous-eligible** (UI + one additive RPC; accounting-inert).
**Phase 2 (U4a/U4b/U5) is the doctrine-realising accounting change and is fully
operator-gated** — it ships behind a new ADR and a hard sign-off, and it is **NOT a
one-guard flip**: three adversarial reviews (GL/VAT, data-model/RLS, scope/conflict)
plus a completeness pass found that the naive "promote the WP-less branch to
universal" change introduces an Input-VAT statutory defect, a double-count, and at
least two silent money-leaks. Those fixes are folded into U4's preconditions below.

This spec gives direction to the **spec-194 parked "procure-into-store" redesign**
(the "supply plan → STORE, WPs เบิก per-WP" item left awaiting direction): that
redesign IS the model below — procurement procures into the store; WPs withdraw.

---

## The decision (operator, 2026-06-26)

Three rules, treated as ground truth:

1. **One store per site, and a site == a project.** The store is per-project. The
   data model already does this (`stock_on_hand` keyed `(project_id, catalog_item_id)`,
   `20260809000000`). **KEEP this scoping — no store-scoping migration.**
2. **Everything ordered goes to the store FIRST.** There is no "buy straight into a
   work package" path in the operator's model. Purchased goods land in the site store
   at receipt. A WP incurs material cost **only when goods are withdrawn (เบิก)** from
   the store to that WP, at moving-average cost.
3. **Withdrawal (เบิก) needs its own dedicated FORM, ON THE WP DETAIL PAGE.** Today เบิก is
   a buried per-row button on the store page; the operator wants a proper withdrawal form,
   and it must live on the work-package detail page (you pull materials _into_ the WP you
   are looking at — the WP is implicit). See design pass 2 below.

### Operator decisions — design pass 2 (2026-06-26)

- **Cost recognised at withdrawal (rule 2): CONFIRMED.** ADR 0065 is greenlit to author.
- **ALL purchases route to the store, including on-site / cash (`site_purchased`) buys.**
  U4a must block WP-binding on the site-purchase path too. Boundary: this means _material_
  purchases; **equipment rental and subcontractor labour keep their own ledgers**
  (usage_logs / labour) and do **not** pass through `stock_on_hand` — they are the other
  WP-P&L lines.
- **One consistent way — the `stockable=false` exception is RETIRED (resolves Q4/Q5).** The
  operator chose a single flow ("one way of working, nothing to remember") over a
  direct-to-WP fast path. Every material — including the 17 install-direct items (fire
  doors, cut roofing, septic tanks, custom fab) — is received into the store and then
  withdrawn to its WP. The `stockable` flag stops gating routing. Cost: a few extra เบิก
  steps + a momentary inventory blip for install-direct goods, both accounting-correct. (A
  future one-tap "receive + เบิก" shortcut is an OPTIONAL optimisation only if that step
  proves annoying — not built now, to preserve the single mental model.)
- **Withdrawal on the WP detail page (rule 3): resolves Q1.** Issuing from the WP page makes
  every slip one-WP by construction; the per-form/per-line granularity question dissolves.
- **Input VAT split at receipt (Q7): CONFIRMED.** It is automatic + server-side — zero user
  burden; it only keeps the reclaimable VAT correct. Implemented in the U4b posting logic.
- **Cutover date (Q2): operator gives a "go" when ready** (no precise calendar math needed);
  CC migrates the in-flight cohort so nothing double-counts. Cleanest is to start the new
  way on the next project and let or migrate current in-flight purchases.

### Operator decisions — design pass 3 (2026-06-26): keep both paths, add the one-tap shortcut

The operator surfaced a real conflict: on-site purchasing **sometimes genuinely buys straight
onto a WP** (bought and installed immediately — it never sits in a store), and forcing that
through receive-then-withdraw is redundant. Decision:

- **Do NOT enforce store-only. Keep both purchase paths (ADR 0063 stays).** Phase 2
  (U4a/U4b/U5) and ADR 0065 — the irreversible store-only enforcement + history backfill — are
  **DEFERRED, not built now.** This removes the only irreversible / operator-gated risk from the
  near-term plan.
- **On-site "buy & use on this WP now" = a one-tap RECEIVE→WITHDRAW shortcut** (chosen over a
  genuine direct-to-WIP trial). The user picks the WP and taps once; under the hood it books a
  store receipt **and** an immediate withdrawal to that WP, atomically. Net store on-hand
  unchanged, cost lands on the WP via the withdrawal leg, AP/cash booked once.
- **Why this resolves the conflict cleanly:** to the user it _feels_ like buying onto the WP
  (one action), but everything still flows through the **single store ledger** — so WP P&L /
  Nova stays **single-basis** (all material at the withdrawal/sell layer), the store stays the
  source of truth, and there is **one mental model.**
- **Reversibility (operator's question):** keeping both open is cheap and reversible both ways.
  Loosening later = trivial; tightening to store-only later = easy code + a one-time migration
  of only the _in-flight_ rows at the flip — which the trial posture lets us avoid until (if
  ever) we choose it. No lock-in.

Captured as **U3b** below (additive; autonomous-eligible). Phase 2 stays in this document as the
parked "future store-only" option, should the trial ever conclude that direction.

### Why this is mostly a flow/UI change, not new accounting

The store-first cost engine **already exists and is pgTAP-pinned (test 213)**. Spec 195
P3 built the exact GL chain the operator wants — but as the _optional_ WP-less branch
beside the legacy WP-bound branch. This spec **promotes the existing store branch to
universal** and retires the WP-bound purchase-posting branch for new purchases.

| Event                     | Target posting                                                   | Status today                                                                     |
| ------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Purchase (PR → purchased) | **nothing**                                                      | exists for WP-less (`post_purchase_to_gl` no-ops when `work_package_id IS NULL`) |
| Receipt into store        | **Dr 1500 Inventory / Cr 2100 AP** (+ Input VAT split — see U4b) | exists for WP-less (`post_stock_receipt_to_gl`), **must add VAT split**          |
| เบิก / withdrawal to WP   | **Dr 1400 WP-WIP / Cr 1500 Inventory** at moving-avg cost        | exists (`post_stock_issue_to_gl`)                                                |

Moving-average cost is correct under interleaving (the issue locks the on-hand row
`for update`, recomputes `avg := round(value/qty,2)`, decrements both, zeroes value on
full depletion). Double-entry balances on both legs. The verdicts confirmed all of this
verbatim against migration SQL.

### Doctrine: what this extends vs reverses

| Prior decision                                            | Relationship                                                                                                                        | ADR                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **Spec 195 P4 / test 213** (cost lands once)              | **EXTENDS** — promotes the store branch to universal; 213 stays the hard invariant and gets extended to formerly-WP-bound purchases | —                               |
| **Spec 197** (store per-project surface)                  | **BUILDS ON**                                                                                                                       | —                               |
| **ADR 0064 / spec 198 U2** (`divert_purchase_to_store`)   | **DEMOTES to legacy-only** — kept as the U5 transition engine + a correction tool; dropped from the forward UI                      | 0064 superseded-in-part by 0065 |
| **ADR 0063** ("WP on a PR is selectable, not compulsory") | **REVERSES** — WP on a _purchase_ PR is removed; new PRs are WP-less at the source                                                  | **0065**                        |
| **ADR 0022** (WP-at-purchase cost model)                  | **RETIRES** for new rows                                                                                                            | **0065**                        |

**A new ADR is required** (CLAUDE.md change-management): **ADR 0065 — store-only
procurement (cost recognition at withdrawal).** It records the reversal of 0063, the
retirement of 0022, the demotion of 0064, the Input-VAT-at-receipt rule, the
catalogued/stockable preconditions, and the cutover/backfill policy. **U4 and U5 do not
ship without 0065 merged.** (0064 is the highest existing ADR; 0065 is the next free
number. 207 is the highest existing spec; 208 is free.)

---

## Units — smallest-first, test-first, independently shippable

Labels: **[UI-ONLY]** · **[ADDITIVE-DB]** (new RPC/column/trigger, non-destructive,
autonomous-eligible) · **[ACCOUNTING-MIGRATION]** (GL posting behaviour changes —
**OPERATOR-SIGN-OFF-REQUIRED**, never ship autonomously). Any destructive / irreversible
/ backfill step is additionally marked **OPERATOR-SIGN-OFF-REQUIRED**.

**Hard invariant for every unit:** pgTAP **213 (cost-integrity)** and the **200
reconciliation** check (`gl_reconciliation`: 1500 ↔ Σ on-hand) **stay green.**

---

### PHASE 1 — autonomous; ships the visible wins + closes the discoverability half of 6fbcc039

---

### U1 — Receive from the delivery: kill the project picker **[UI-ONLY]** ✅ autonomous

**Goal:** make the delivery the receiving entry point; the project is implicit (the
PO/delivery already binds `project_id`). This is the direct, low-risk fix for the
_discoverability_ half of 6fbcc039.

**Scope (tightened per scope verdict Fix 4 — the `/store` redirect moves to U6):**

- On `…/orders/[poId]/page.tsx` and `…/deliveries/[deliveryId]/page.tsx`, surface
  **"รับเข้าคลัง"** as a headline action; pre-seed the existing `record_stock_in_bulk`
  รับเข้า grid with the delivery's lines + project — **no picker**.
- **Role precision (data-model verdict Fix 9 — load-bearing):** `receive_po_lines` is
  gated `('site_admin','project_manager','super_admin')` — **procurement is excluded**
  (spec 134 U8, `20260717000000`). So the reporter's working path is the **manual
  `record_stock_in` / `_bulk`** path (which DOES admit procurement), seeded from the
  delivery's lines — **NOT** `receive_po_lines`. Wire procurement's button to the seeded
  manual-stock-in path; site-staff keep the `receive_po_lines` confirm. Whether
  procurement may _confirm physical arrival_ on the `รับของ` checklist is **Q3** (U6,
  operator-gated) — do not pre-empt it here.
- Remove/repair the **dead picker branch** in `store-manager.tsx:292–311` that pushes to
  the legacy `/store?project=` route — but **audit every caller that passes
  `hidePicker={false}` first** (the branch only renders then; removing it must not break
  the multi-project storekeeper's manual entry).

**Failing test first:** route/render tests that the รับเข้าคลัง action appears on the
delivery page for procurement + site-staff; that **no project `<select>`** renders in the
delivery-driven receive; that a procurement user's button targets the manual-stock-in
action (not `receive_po_lines`); caller-audit assertion that no live caller relies on the
removed picker branch.

**Files:** `src/app/requests/orders/[poId]/page.tsx`,
`…/deliveries/[deliveryId]/page.tsx`, `src/components/features/store/store-manager.tsx`.

**Expectation-setting (scope verdict Advisory A):** U1 closes the **discoverability**
half of 6fbcc039. The **role** half (can procurement itself confirm arrival) is **Q3**.
If the operator answers Q3 "receiving stays site-only," procurement's resolution is the
seeded manual-stock-in path made discoverable — which U1 delivers.

**Why first:** smallest, pure UI, directly closes the reported bug, zero accounting risk.

---

### U2 — Dedicated withdrawal (เบิก) form, single-line **[UI-ONLY]** ✅ autonomous

**Goal:** promote เบิก from a buried per-row `BottomSheet` button to a first-class form
over the **existing `issue_stock` RPC** (no new RPC; `WpIssueStock` already wraps
`issue_stock`, confirmed UI-only).

**Scope (operator pass 2: withdrawal happens ON the WP detail page — the WP is implicit, so
there is no WP picker and no standalone store/issue route):**

- Entry point: a primary **"เบิกวัสดุเข้างานนี้" section on the WP detail page**
  (`work-packages/[workPackageId]`) — promote the existing `WpIssueStock` (which already
  wraps `issue_stock`) from the buried คำขอซื้อ-tab to a first-class surface. `/sa` daily
  actions and the store page deep-link **here**. **No `/projects/[projectId]/store/issue`
  route.**
- The store page (`/projects/[id]/store`) keeps รับเข้า + stock levels but **no longer hosts
  เบิก** — receiving lives at the store, withdrawal lives at the WP.
- Form fields: item from the **project store's on-hand only** (qty > 0, grouped by category,
  "มี {qty} {unit}"); **WP = the current page, no select**; qty with a **client-side ceiling
  = on-hand** (the check the current sheet lacks); optional receiver; note.
- Gate **`SITE_STAFF_ROLES`** (`site_admin, project_manager, super_admin, project_director`)
  - `can_see_project`. **Procurement is excluded by design** (it does IN, not OUT). Cost/sell
    columns stay hidden; priced server-side.
- Keep the custody handshake (รอรับ → confirm) unchanged.
- **Resolves Q1 (granularity):** withdrawing from the WP page makes every slip one-WP by
  construction — the per-form/per-line question dissolves.
- **Empty-store state (completeness Gap 10):** mirror spec 197 U3 — if nothing is on hand,
  show "ยังไม่มีของในคลังให้เบิก — รับเข้าก่อน" and lead to รับเข้า; do not render an
  empty picker.

**Failing test first:** form renders only for SITE_STAFF (not procurement); on-hand-only
item list; qty-ceiling client validation rejects over-withdrawal; happy path calls
`issueStock` with correct args; 42501/22023 error mapping; empty-store state renders the
guidance, not an empty form.

**Files:** `src/components/features/store/wp-issue-stock.tsx` (promoted to the primary
WP-detail surface), `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`,
`src/components/features/store/store-manager.tsx` (remove the เบิก surface from the store
page). **No new `/store/issue` route.**

**Why second:** pure UI over a built + tested engine; delivers the operator's explicit
"dedicated form" ask with no DB risk.

---

### U3 — Multi-line withdrawal (atomic) **[ADDITIVE-DB]** ✅ autonomous

**Goal:** mirror the spec-198 รับเข้า grid for เบิก via a new additive RPC.

**Resolve Q1 BEFORE implementing (scope verdict Advisory C — it changes the RPC
signature):** lock **per-form (one slip → one WP)** as the default — it matches the slip
mental model and `record_stock_in_bulk`'s single-project shape. `work_package_id` lives at
slip level, not per line. (Per-line mixed-WP slips are a later option, not this unit.)

**Scope:**

- New `issue_stock_bulk(p_project_id uuid, p_work_package_id uuid, p_lines jsonb) →
integer` SECURITY DEFINER, modelled on `record_stock_in_bulk` (`20260813000800`):
  per-line validation (qty>0, active item, active receiver, **locked sufficient
  on-hand**), **atomic** (any bad line rolls the whole batch back), returns count. Each
  line `{catalog_item_id, qty, receiver_worker_id?, note?}`.
- **Gate (data-model verdict Fix 7 — do NOT copy the procurement arm):** membership-only
  `can_see_project(p_project_id)` + the SITE_STAFF role set — issue is member-only;
  receive is procurement-curated. Replicate the per-line **receiver-worker validation**
  (active + project-scoped) from `issue_stock`.
- **Hardened pattern (MEMORY / anon-exec audit, mandatory):** `revoke … from public, anon`
  - null-safe role gate + `grant … to authenticated`.
- **Append-only (data-model verdict Fix 8):** write via the definer pattern only; a bad
  line is fixed by **atomic rollback**, never by UPDATE/DELETE of `stock_issues`.
- Wire the U2 form to add rows + call the bulk action.

**Failing test first (pgTAP, numbered in the 22x band — NOT 208; test 208 is feedback):**
atomicity (one bad line rolls back all); gate 42501 for procurement/non-member;
insufficient-stock 22023; on-hand decremented correctly across lines; moving-avg cost
snapshot per line; GL enqueued per line (Dr 1400/Cr 1500). Plus an action-layer test for
the wrapper.

**Files:** `src/app/store/actions.ts`, new migration modelled on `20260813000800`, new
pgTAP file (22x).

**Why autonomous:** additive RPC (new function; no change to existing objects); exact
tested precedent; no GL _semantics_ change (it loops the existing single-issue posting).
Per the autonomy grant, additive migrations are auto-pushable.

---

### U3b — On-site "buy & use on this WP now": one-tap receive→withdraw **[ADDITIVE-DB]** ✅ autonomous (money RPC — quick operator OK before the migration push)

**Goal (design pass 3):** give the on-site / `site_purchased` purchase flow a
**"ใช้ที่งานนี้เลย"** option that records the purchase into the store **and** immediately
withdraws it to the chosen WP in one atomic action — single-basis, no double data entry.

**Scope:**

- New `site_purchase_use_now(p_project_id uuid, p_work_package_id uuid, p_lines jsonb) →
integer` SECURITY DEFINER, composing the **existing tested posters**: `record_stock_in`
  (Dr 1500 Inventory / Cr cash-or-AP, **+ Input-VAT split when `vat_rate>0`** — mirror the
  on-site purchase's current credit account; verify whether it books AP, petty cash, or
  owner-paid) **then** `issue_stock` to the WP (Dr 1400 WP-WIP / Cr 1500 at the just-received
  cost). **Atomic:** any bad line rolls back both legs.
- Hardened pattern (anon-exec audit, mandatory): `revoke … from public, anon` + null-safe role
  gate + `grant … to authenticated`. Gate = the on-site-purchase role set + `can_see_project`.
- The on-site purchase form gains the choice **เข้าคลัง** (store, existing) vs
  **ใช้ที่งานนี้เลย** (this shortcut → pick WP). Default = open question (recommend defaulting to
  store; "use now" is the deliberate exception).
- **No change to existing GL semantics** — composes two already-correct posting events; it does
  **not** touch the WP-direct or WP-less branches, and needs **no** backfill.

**Failing test first (pgTAP, 22x band):** atomicity (a bad line rolls back both legs); net
`stock_on_hand` unchanged after a use-now (received then issued same qty); the WP carries the
cost **once** via the 1400 leg; AP/cash credited once; Input-VAT split present when `vat_rate>0`;
`gl_reconciliation` holds. Plus an action-layer test.

**Files:** new migration (composing `record_stock_in` + `issue_stock`),
`src/app/store/actions.ts` or the on-site purchase action, the on-site purchase form, new pgTAP
(22x).

**Why autonomous-eligible:** additive RPC (new function; existing objects untouched), composes
two tested posters, no enforcement, no irreversible step. As a money RPC, get a quick operator
nod before pushing the migration.

**SHIPPED 2026-06-26 — option B (operator decision).** An adversarial GL review caught that the
store path is **VAT-agnostic**, so U3b does NOT split Input VAT (1300) the way the direct on-site
purchase (`record_site_purchase` → `post_purchase_to_gl`) does. Net GL = Dr 1400 / Cr 2100 at cost
equals the direct path **only at zero VAT**. Decision **B**: the use-now shortcut is for **cash
buys without a full tax invoice** (no reclaimable VAT → VAT-inclusive cost is correct); a
**VAT-invoiced** on-site buy uses the existing free-text บันทึกการซื้อหน้างาน form (which splits
VAT). The UI labels it "ซื้อเงินสด" + a "ไม่มีใบกำกับภาษี" note. When Phase-2 VAT-split-at-receipt
lands, the shortcut inherits it and the cash-only framing can relax. pgTAP 228 pins the option-B
GL (Dr 1400 / Cr 2100 at cost, AP once, Inventory 1500 nets to 0, **no 1300 line**).

---

> ## ⛔ HARD STOP — operator sign-off gate before Phase 2 (⏸ DEFERRED — see design pass 3)
>
> Phase 2 changes GL posting for a whole class of purchases on real money. Before any
> Phase-2 unit ships, the operator must:
>
> 1. **Merge ADR 0065.**
> 2. **Answer the U4 preconditions:** Q4 (off-catalog), Gap 1 (`stockable=false`), Q6
>    (sell-basis valuation app-wide), and the VAT decision (U4b).
> 3. **Answer Q3** (procurement & `รับของ`) so U6's gate decision is settled.
> 4. **Approve the cutover date** (U5).
>
> Do **not** proceed autonomously past this line.

---

### PHASE 2 — the doctrine-realising accounting change (operator-gated, behind ADR 0065)

> **⏸ DEFERRED (design pass 3, 2026-06-26).** The operator chose to keep both purchase paths and
> add the U3b shortcut instead of enforcing store-only. Phase 2 below — and ADR 0065 — are
> **parked as a future option**, revisited only if the trial concludes the firm wants the store
> to be the _only_ path. Nothing in Phase 2 is built now. The analysis is retained because it is
> the correct plan **if** that switch is ever made (it carries the only irreversible / GL-migration
> risk in the spec).

The scope verdict split the design's monolithic "U4" into **U4a (UI source-block)** and
**U4b (GL trigger)** because they are unlike changes with separate tests — and because
**U4b may collapse to near-no-op once U4a + U5 are correct** (if new PRs are WP-less at
the source, the WP-WIP-at-purchase arm is simply unreachable for new rows). Verify that
before writing the GL migration.

---

### U4a — Block WP-bound purchasing at the source **[UI-ONLY]** 🟠 gated on ADR 0065 + preconditions

**Goal:** new purchase PRs are **always store-bound (WP-less)**. The "ทั้งโครงการ vs
per-WP" choice collapses to always-store. This is the **load-bearing** change — once the
source is WP-less, "all delivered PRs" and "WP-less delivered PRs" become the same set, so
the receive trigger need not be widened (avoiding the double-count the GL verdict found).

**Scope — enumerate and guard EVERY PR-insert path (completeness Gap 9 / data-model Fix 2
— a single edit silently misses paths):**

1. the **manual PR form**,
2. **`generate_prs_from_plan`** (supply plan → PRs),
3. the **site-purchase / `site_purchased`** path.
   Each is a separate code surface with its own test. `work_package_id` on a purchase PR
   becomes informational/legacy-only for new rows.

**PRECONDITIONS (must be resolved before U4a ships — promoted from "open questions" to
blockers by the verdicts):**

- **Off-catalog (Q4, data-model Fix 3 / scope Fix 2):** `purchase_requests.catalog_item_id`
  is **nullable**, and the receive trigger requires `catalog_item_id IS NOT NULL`
  (`20260813000500` line 49). Under the universal model an off-catalog PR books **nothing**
  (no WIP, no Inventory) → **cost vanishes**. Resolve by **force-catalog at PR entry** (a
  U4a guard) **or** define an off-catalog store path. Test 213 won't catch this (it uses a
  catalogued item). **U4a does not ship until this is closed.**
- **`stockable=false` (completeness Gap 1 — the REAL Q4, bigger than off-catalog):**
  `catalog_items.stockable` exists (`20260801000000` line 42); **17 of 71 seeded items are
  `stockable=false`** (cut-to-length roofing, fire doors, septic tanks, custom
  fabrication) — _catalogued_ yet deliberately _non-inventoried, direct-to-WP_. Under the
  universal rule a fire door can't enter `stock_on_hand`, so it books nothing → same
  money-leak for **24% of the catalog**. The operator must decide: **(a)** the universal
  rule overrides `stockable=false` (the flag goes dead; these items get an artificial
  transient store hop), or **(b)** `stockable=false` items keep a legitimate direct-to-WP
  purchase path (then "everything → store" is not literally true, and U4a must NOT
  force-WP-less for this class). **This is a product contradiction the operator must
  resolve before U4a.**

**Failing test first:** per-insert-path test that a new PR from each of the three paths
lands `work_package_id IS NULL` (or, under decision (b), that `stockable=false` items are
correctly routed); a guard test that an off-catalog PR is either rejected at entry or
routed to the agreed off-catalog path.

**Files:** PR form + `generate_prs_from_plan` migration/RPC + the site-purchase path;
`src/components/features/store/store-manager.tsx` (the "ทั้งโครงการ/per-WP" UI),
`src/app/projects/[projectId]/page.tsx`.

**Label rationale:** the _source-block_ is UI/validation; it is gated only because it must
not ship ahead of ADR 0065 and the precondition answers. The migration to
`generate_prs_from_plan` is additive (drops/keeps a guard) — but it lives behind the same
gate as U4b for coherence.

---

### U4b — Universal receive-into-store + Input-VAT split + dashboard de-dup **[ACCOUNTING-MIGRATION]** 🔴 OPERATOR-SIGN-OFF-REQUIRED

**Goal:** every delivered purchase books **Dr 1500 / Cr 2100** at receipt (with VAT split)
and **nothing** books Dr 1400 at purchase. **First verify U4b is even needed:** if U4a +
U5 cover all rows, the WP-WIP-at-purchase arm is unreachable for new rows and U4b reduces
to guard-tightening + the VAT/dashboard fixes. Specify in the unit which it is.

**The four folded GL fixes (the design under-scoped these; do NOT ship without them):**

1. **Input VAT 1300 — HIGHEST PRIORITY (GL verdict Fix 1).** `post_purchase_to_gl` splits
   gross into **Dr 1400 net + Dr 1300 Input VAT + Cr 2100 gross**. The store receipt poster
   does **not** — it books the **all-in gross** to 1500 (`20260813000500` sets `unit_cost
:= round(amount/qty)`, VAT-agnostic). Under the universal path, a VAT-registered
   purchase that today books reclaimable Input VAT to 1300 would instead **bury it in
   Inventory 1500** → Input VAT understated, VAT overpaid, and `gl_reconciliation` stays
   green so the error is **silent**. **Required:** the receipt poster (or a new
   purchase-receipt poster) must split VAT — **Dr 1500 net / Dr 1300 Input VAT / Cr 2100
   gross** — when the originating PR has `vat_rate > 0`. This needs `vat_rate`/net plumbed
   through `stock_receipts` (new column) **or** the poster joining back to
   `purchase_requests` via `purchase_request_id`. **This is a non-trivial GL migration, not
   a one-line early-return.**
2. **Gate reconciliation with spec 203 U2 (data-model Fix 1 / GL Fix 2).** The live
   `post_purchase_to_gl` gate is `status in
('purchased','site_purchased','on_route','delivered')` (`20260813002100`) — spec 203 U2
   **widened** it to recover the ฿102k backlog. The design assumed the _old_ gate where
   "delivered won't post." So you **cannot** rely on "delivered WP-bound won't post." U4b
   must explicitly **(a) stop enqueuing the purchase job** for the now-store-routed path
   and **(b) suppress the poster** — not lean on the stale assumption. The enqueue triggers
   fire `when new.work_package_id is not null` (`20260813000500` §4); for the universal
   model that guard is backwards and must be inverted/removed. **Keep the function bodies**
   (legacy + reversibility); just ensure nothing new routes to the WIP arm.
3. **Cost→sell basis flip — document + test (GL Fix 3 / scope Fix 3).**
   `wp_profit.materials_cost` = the **1400 purchase-sourced** term **plus** the store-issue
   sell term. Under this change the purchase-sourced term goes to **zero for all new WPs**;
   100% of material arrives via the store-issue (sell-price) transfer layer. This is a
   **semantic flip from cost-basis to sell-basis** for the entire materials line (Q6
   confirms it is intended app-wide; it matches [[wp-profit-sharing-ht-model]]). pgTAP **102**
   and **196** still pass on _seeded_ journal rows and so will **not** catch the flip — add
   tests that a **formerly-WP-bound** purchase produces **zero** 1400-purchase lines
   end-to-end, and that its cost lands via the issue leg.
4. **Dashboard double-count — fix WITH U4b, not later (GL Fix 5).** `sumMaterials`
   (`src/lib/dashboard/spend.ts`) adds **every** spend-status PR with an amount **regardless
   of WP-binding**; `sumStoreIssues` adds store issues at cost. Their "disjoint" claim rests
   on WP-less PRs being _implicitly_ excluded — but `sumMaterials` has **no WP filter**, so
   a store-bound purchase is counted at purchase amount **and** re-counted at issue → a
   latent double-count today for the WP-less minority that U4b makes **universal**. **U4b
   must scope `sumMaterials` to exclude store-bound/WP-less PRs** (verify the loader in
   `dashboard/page.tsx`) so the dashboard materials figure does not double-count.

**Also fold in:**

- **Voucher drill-down (GL Fix 3).** The purchase register (`load-purchases.ts`) reads
  `purchase_requests` directly (unaffected) but will now list purchases with **no purchase
  journal entry**; the voucher page `/accounting/purchases/[id]` that expects a
  `source_event='purchase'` entry will find none. **Fix the voucher page to show the
  receipt entry instead.**
- **AP subledger supplier dimension (GL Fix 3).** Confirm every PR-sourced receipt carries
  `supplier_id` on the 2100 credit (`stock_receipts.supplier_id` ← `new.supplier_id`); see
  also U6/Gap 7 for supplier-less _manual_ receipts.

**Failing test first:** **pgTAP 213 stays green and is extended** — a **WP-bound** purchase
now books **no journal at purchase**; the receipt is the single AP event **with the VAT
split** (Dr 1500 net / Dr 1300 VAT / Cr 2100 gross when `vat_rate>0`); เบิก is the single
1400 event; `gl_reconciliation` holds; **no double-count** between `purchase_requests`- and
`stock_issues`-sourced 1400 terms; a dashboard test that store-bound material is counted
**once**.

**Files:** new migration(s) modelled on `20260813000500` (receive trigger),
`20260813002100`/`20260813001000` (`post_purchase_to_gl`), `20260809001900` (receipt
poster — VAT split), `generate_prs_from_plan`; `src/lib/dashboard/spend.ts`,
`src/app/dashboard/page.tsx`, `src/app/accounting/purchases/[id]/…`; extend
`supabase/tests/database/213-store-cost-integrity.test.sql`.

**Label:** **ACCOUNTING-MIGRATION — OPERATOR-SIGN-OFF-REQUIRED.** Fix 1 (VAT) alone makes
the naive version a **statutory-VAT defect**. Ship with ADR 0065.

---

### U5 — Transition / backfill for in-flight WP-bound PRs **[ACCOUNTING-MIGRATION]** 🔴 OPERATOR-SIGN-OFF-REQUIRED (touches posted real money; irreversible)

**Goal:** clean cutover so no PR double-counts (WIP at purchase + Inventory at receipt) and
no PR's cost vanishes. Partition by **GL-posted state, not delivery state** (data-model
Fix 5).

**Mandatory pre-cutover step (data-model Fix 5).** First **drain/settle all pending +
failed `purchase` outbox jobs under the OLD gate**, then snapshot the cutover timestamp.
The drain-outage history (9 stranded, ฿102k) means there may be WP-bound delivered PRs
whose purchase job never posted; if U4 removes the enqueue path before they drain, their
cost **never posts**. Drain first.

**Cohorts (Q2 — operator chooses the policy):**

- **(i) Already delivered + WIP-posted:** cost is already correctly on the WP under the old
  model and the goods never touched the store → **leave as historical.** **But this cohort
  is NOT inert (GL verdict secondary).** The spec-203-widened gate posts `delivered`
  WP-bound PRs, so a historical delivered WP-bound PR **will re-post to WIP if its outbox
  row is touched.** U5 must ensure cohort (i)'s outbox rows are settled/quiesced so the
  drain cannot re-enqueue them. **Add a pgTAP assertion** (scope Fix 3) that cohort (i)
  leaves both 1500 and on-hand untouched and reconciliation holds — don't let "document the
  cutover date" substitute for a test.
- **(ii) In-flight (purchased/on_route, WIP-posted, not yet delivered):** under U4 these
  would hit the new universal receipt and **double-count**. Reconcile each via the
  **existing `divert_purchase_to_store`** (Dr 2100/Cr 1400 reverse + Dr 1500/Cr 2100
  receipt, net WP-WIP → 0; pgTAP-216-proven; `20260813001000`). **Version-pin** which divert
  body U5 depends on (the current sync-reverse one reads `journal_entries` directly, so it
  finds the posted entry regardless of the outbox) and **add a test** that divert against a
  U4-era WP-less PR raises `'purchase is not work-package-bound'` (22023) rather than
  silently no-opping (GL Fix 4).

**Irreversibility floor (data-model Fix 6 — break-glass).** `divert_purchase_to_store` sets
`work_package_id = NULL` on the PR (`20260813001000` line 209) — the original WP binding is
**lost** except in `audit_log`/journal. Running it as a bulk backfill is a **one-way data
migration with no in-row undo.** Per CLAUDE.md / `docs/break-glass.md` this requires the
operator-only floor: **verified `pg_dump` + preview-branch rehearsal.** "Guarded one-time
migration" undersells it.

**Failing test first:** pgTAP that a cohort-(ii) PR through the transition lands cost in
Inventory **once** with WP-WIP at **zero** and reconciliation holding; that cohort (i) is
untouched and its outbox rows cannot re-enqueue; that divert on a WP-less PR errors 22023.

**Files:** a guarded one-time migration (or operator-run script) using
`divert_purchase_to_store`; new pgTAP (22x); `pg_dump` + preview rehearsal per break-glass.

**Why operator-gated:** posted GL on real money (฿102k+ already in GL), irreversible WP
null-out, and the **cutover timing is a product decision.**

---

### PHASE 3 — polish, folding in the resolved gate decision

---

### U6 — Navigation, role entry points, and the `/store` redirect **[UI-ONLY]** (+ one gated micro-unit) ✅ autonomous except Q3

**Goal:** clean, direct entry per role; kill the hunt. Includes the `/store` redirect fix
moved here from U1.

**Autonomous scope:**

- **`/store` legacy redirect (moved from U1):** when the user has exactly one project,
  redirect to that project's store (reuse `homePathForUser`/`resolve-home.ts`); otherwise
  keep `/projects` with a "select a site's store" hint.
- **Receive:** primary action on PO/delivery pages (U1); the per-project `คลัง` chip stays
  as the manual door; consider a receive pin in `SA_TABS`/`PM_TABS` (site_admin is the
  storekeeper).
- **Withdraw:** "เบิก" on the store header (U2) + WP-detail "เบิกเข้างานนี้" deep-link +
  linkable from `/sa` daily actions.
- **Role dead-end note (completeness Gap 10):** เบิก is SITE_STAFF-only, so procurement
  landing on a store surface won't see it. Don't render a broken/empty affordance for
  procurement — show nothing or an explanatory line, so we don't reproduce the
  "feature is invisible to me" complaint for a different role.
- Optional pull badges ("deliveries waiting to receive" / "items available to เบิก").

**Failing test first:** nav-presence per role; deep-link resolution; one-project redirect
resolves to that project's store; multi-project keeps `/projects` + hint; procurement does
not see a dead เบิก affordance.

**Files:** `src/app/store/page.tsx`, `src/lib/auth/resolve-home.ts`,
`src/components/features/chrome/hub-nav.tsx`,
`src/components/features/chrome/bottom-tab-bar.tsx`,
`src/app/projects/[projectId]/page.tsx`, `src/lib/auth/role-home.ts` (read-only here).

**Gated micro-unit — Q3 (`canReceive` relax) 🔴 OPERATOR-SIGN-OFF-REQUIRED.** Whether
procurement may **confirm physical arrival** on the PO `รับของ` checklist (relax the
site-staff-only `canReceive` in `orders/[poId]/page.tsx:67` / `role-home.ts`) is a
**role-doctrine change** that reverses spec 134 U8's deliberate "receiving is a site
action" — and it is the literal root cause of 6fbcc039. It is **not** nav polish and
**cannot** ride inside the autonomous unit. It ships only if the operator answers Q3 =
"admit procurement to รับของ," as its own gated change touching `role-home.ts`.

---

## Ship order (safe sequence)

```
PHASE 1 — autonomous; closes the discoverability half of 6fbcc039 immediately
  U1   receive-from-delivery + grid pre-seed + remove dead picker (caller-audited)   [UI-ONLY]
  U2   dedicated single-line เบิก form over issue_stock (+ empty-store state)         [UI-ONLY]
  U3   issue_stock_bulk + multi-line form (Q1 = per-form, locked)                     [ADDITIVE-DB]

  ── ⛔ HARD STOP: ADR 0065 + answer Q3, Q4, Gap 1, Q6, VAT, cutover date ──

PHASE 2 — doctrine-realising accounting change (all OPERATOR-SIGN-OFF-REQUIRED)
  U4a  collapse PR/plan/site-purchase WP choice → always-store; force-catalog guard   [UI-ONLY, gated]
       (enumerate ALL THREE PR-insert paths; resolve off-catalog + stockable=false first)
  U4b  universal receive trigger + INPUT-VAT split + spec-203-gate reconcile
       + cost→sell test + dashboard de-dup + voucher page                             [ACCOUNTING-MIGRATION] 🔴
       (verify U4b is even needed once U4a + U5 cover all rows)
  U5   pre-cutover drain → divert cohort (ii); assert cohort (i) untouched            [ACCOUNTING-MIGRATION] 🔴
       (pg_dump + preview rehearsal; irreversible WP null-out)

PHASE 3 — polish
  U6   /store redirect fix + nav deep-links + badges + role dead-end guard            [UI-ONLY]
       └ Q3 gate change (admit procurement to รับของ) as a separate gated micro-unit  🔴 if answer = yes
```

**Rationale:** Phase 1 is pure-UI + one additive RPC — accounting-inert, auto-pushable,
and it closes the reported bug fast. The hard stop guarantees no GL/money change ships
without the ADR, the VAT/cost-basis/double-count fixes, and the operator's product calls.
U4 is split so the UI source-block (U4a) and the GL migration (U4b) carry separate tests,
and so U4b can be verified as possibly-near-no-op before any GL SQL is written.

**Out-of-scope boundaries (stated, with owners — completeness pass):**

- **Equipment is OUT of the store path (Gap 4).** Equipment is purchased and delivered to
  site but runs its own ledger (usage_logs → wp_profit equipment term, spec 146/202) and
  never touches `stock_on_hand`. Do **not** route an equipment PO through `record_stock_in`.
- **Returns-to-supplier / over-/wrong-delivery (Gap 2).** No new flow here; returns ride on
  `reverse_stock_receipt`. The spec flags that under U4b a return must reverse **1500 net +
  1300 VAT + 2100 gross** and reconcile the supplier subledger — a returns/credit-note unit
  is a **named follow-up**, not in scope.
- **Reversal surface + bulk reversal (Gap 3).** `reverse_stock_receipt` /
  `reverse_stock_issue` exist but have **no UI** and are single-line; a bulk เบิก has no
  `reverse_stock_issue_bulk`. Named follow-up: surface reversals + a bulk reversal wrapper.
- **Store-to-store / inter-project transfer + multi-store future (Gap 5).** No transfer flow
  exists. **Invariant to preserve:** every store-touching RPC keys on `project_id` as store
  identity; a future `store_id` slots in **beside** `project_id`, not replacing it — so RPC
  contracts must not bake "project IS the store" into a shape that blocks a later store
  dimension. Named follow-up.
- **Project-close residual inventory (Gap 6).** U4 increases residual on-hand (everything
  hops through the store); leftover stock sits in 1500 for a "closed" project forever. No
  disposition flow here — named follow-up (write-off / transfer / carry).

---

## Open questions for the operator

1. **Withdrawal slip granularity (U3).** One เบิก slip → one WP (per-form, simpler, matches
   the slip mental model) — **recommended, lock as default** — or allow mixed WPs per slip
   (per-line)? Locking this before U3 avoids RPC-signature rework.
2. **In-flight WP-bound PRs at cutover (U5).** For PRs purchased/posted-to-WIP but **not yet
   delivered**: (a) auto-divert to the store at cutover via the existing transfer, or (b)
   let them finish under the old model (deliver straight to WP, no store) and apply
   store-only only to PRs raised after the cutover date? **Recommended:** a clean cutover
   date + auto-divert only the in-flight WIP-posted cohort, after the pre-cutover outbox
   drain.
3. **Procurement & receiving (U6 micro-unit — the literal 6fbcc039 trigger).** Should
   procurement be able to **confirm physical arrival** on the PO `รับของ` checklist (relax
   the site-staff-only `canReceive`, reversing spec 134 U8), or only **record manual
   stock-in** in คลัง (the current gate already allows this, and U1 makes it discoverable)?
   This is the core role-judgement behind the report.
4. **Off-catalog / walk-in purchases (U4a precondition — BLOCKER, not deferrable).** Under
   "everything → store," how do non-catalogued items enter stock — **force-catalog at PR
   entry**, or build an off-catalog store path? Today an off-catalog PR under U4 books
   nothing (cost vanishes).
5. **`stockable=false` catalogued items (U4a precondition — BLOCKER; the real, bigger Q4).**
   17/71 seeded items are deliberately non-inventoried, direct-to-WP (fire doors, roofing,
   septic tanks, custom fab). Does the universal rule **override** `stockable=false` (the
   flag goes dead; artificial transient store hop), or do these keep a **legitimate
   direct-to-WP purchase path** (then "everything → store" is not literally universal, and
   U4a must exempt this class)? This is a direct product contradiction with the domain rule.
6. **`wp_profit` valuation basis (U4b precondition).** With all material flowing
   store→เบิก, every WP's material cost becomes the **sell-price transfer layer**
   (`stock_issues`-sourced), not purchase cost. Confirm this is the intended app-wide
   self-governance transfer-price behaviour (it matches [[wp-profit-sharing-ht-model]]).
   **Cutover straddle (completeness Gap 12):** a WP open across the cutover will carry
   **mixed-basis** material cost (purchase-cost before, sell-price after). Freeze the
   cutover at a project boundary (no open WP straddles it), or accept + document mixed-basis
   WPs?
7. **Input VAT at receipt (U4b — statutory).** Confirm the receipt poster must split **Dr
   1500 net / Dr 1300 Input VAT / Cr 2100 gross** when the originating PR has `vat_rate>0`
   (vs the current VAT-agnostic gross-to-1500). This is the statutory-correctness fix; the
   only product call is whether `vat_rate` is plumbed via a new `stock_receipts` column or a
   join back to `purchase_requests`.
8. **Manual (walk-in) receipts with no supplier (Gap 7).** U1/U6 keep manual รับเข้า as a
   primary door, so supplier-less manual receipts that book Dr 1500/Cr 2100 into the
   "ไม่ระบุผู้ขาย" AP bucket (a payable nobody owns) become more common. Require a supplier
   on any manual receipt that books to AP, or route supplier-less ones to a different credit
   account (adjustment / owner-contribution), not 2100?
9. **Worker-only (no-WP) withdrawals (Gap 8).** The rule says เบิก goes "to a WP **or**
   worker," but `issue_stock` **requires** a WP (cost must land somewhere). Seeded tools
   (ถังปูน, เกรียง, masonry_tools) are issued to people, not consumed by a WP. Are
   worker-only withdrawals allowed, and if so where does their cost land (no WP-WIP)?
10. **`divert_purchase_to_store` fate after cutover (Q5 — framing correction, Gap 11).**
    Keep it as a forward correction tool? Note: under U4a new PRs are WP-less, so
    "bought against the wrong WP" can no longer occur for new rows — divert's only remaining
    use is the U5 cohort + pure legacy, and it does **not** handle "received into the wrong
    project's store" (that's store→store, Gap 5). **Recommended:** keep the engine, hide
    from primary UI, surface only as an admin/correction tool; drop the "wrong-WP correction"
    justification.

---

## Files the implementing sessions will touch (absolute)

- **Receiving UI (U1, U6):** `src/app/requests/orders/[poId]/page.tsx`,
  `src/app/requests/orders/[poId]/deliveries/[deliveryId]/page.tsx`,
  `src/components/features/store/store-manager.tsx`, `src/app/store/page.tsx`,
  `src/lib/auth/resolve-home.ts`
- **Withdrawal UI (U2, U3):** `src/components/features/store/store-manager.tsx`,
  `src/components/features/store/wp-issue-stock.tsx`,
  `src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx`,
  new `src/app/projects/[projectId]/store/issue/`
- **Actions:** `src/app/store/actions.ts`
- **GL / RPC / migrations:** new files modelled on
  `supabase/migrations/20260813000800_spec198u1_record_stock_in_bulk.sql` (U3 bulk),
  `20260813000500_spec195p3_receive_into_store.sql` (receive trigger + enqueue guards),
  `20260813002100_spec203u2_post_purchase_gate.sql` (the widened gate U4b must reconcile),
  `20260813001000_spec198u2_divert_fix_sync_reverse.sql` (U5 divert engine; line 209
  irreversible WP null-out), `20260809001900_spec178b6a_store_gl_posting.sql` (receipt
  poster — VAT split), `20260809000700_spec178u2_issue_sell.sql` (issue gate/poster),
  `20260801000000` (`catalog_items.stockable`),
  `20260809000800_spec179_pr_catalog_item.sql` (nullable `catalog_item_id`),
  `20260717000000_receive_site_only.sql` (procurement excluded from `receive_po_lines`)
- **Dashboard / accounting (U4b):** `src/lib/dashboard/spend.ts`,
  `src/app/dashboard/page.tsx`, `src/lib/accounting/load-purchases.ts`,
  `src/lib/accounting/load-payables.ts`, `src/app/accounting/purchases/[id]/…`
- **Nav / gates (U6):** `src/lib/auth/role-home.ts`,
  `src/components/features/chrome/hub-nav.tsx`,
  `src/components/features/chrome/bottom-tab-bar.tsx`,
  `src/app/projects/[projectId]/page.tsx`
- **Tests:** extend `supabase/tests/database/213-store-cost-integrity.test.sql`; new pgTAP
  files numbered in the **22x band** (NOT 208 — test 208 is feedback); add
  formerly-WP-bound coverage alongside `102-wp-profit.test.sql` /
  `196-wp-profit-store-sell.test.sql`
- **ADR + spec:** new `docs/decisions/0065-store-only-procurement.md`; this spec
  `docs/feature-specs/208-store-centric-procurement.md`
