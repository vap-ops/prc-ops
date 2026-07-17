# Spec 325 — WP cost categories + rework line (omotenashi cost visibility)

**Status:** DESIGN DRAFT 2026-07-17 — distilled from an operator design session (chat).
Build NOT started; the operator reviews this spec as a whole before any unit is scheduled.
**Origin:** Operator, 2026-07-17 (verbatim intent, across the discussion): _"it could be
helpful for everyone to be on the same page … knowing when items are needed can help the
procurement team make better decisions. Seeing how much is spent on WPs helps procurement
monitor better, come up with ideas"_ → _"Budgets for each WP will be categorized by
materials and labors. When materials are bought in plan, the cost accumulates up under
material budget. When it is bought because of labor's fault, it charges to labor side"_ →
(on equipment) _"maybe we need one more category, equipment rentals"_ → (accepted rec)
rework as its own line → **"omotenashi"** as the governing spirit.

---

## 0. First principle — the omotenashi test (binding on every unit)

Every unit of this spec must pass one question before it ships:

> **Does this carry a burden FOR the user, or hand them a new one?**

Omotenashi = the host anticipates the guest's need and has quietly met it before being
asked. Applied here:

1. **Anticipate, don't burden.** The system proposes; a human confirms. No unit may add a
   mandatory capture step for the field (the SA's job is photos and work, not cost
   adjudication). Classification burdens land on the system first, the approver second,
   the field never.
2. **Offer, don't nag.** Insight is present when the user turns to it (a quiet line, a
   `ดูสาเหตุ` affordance) — never a push notification that scolds. Anticipation that
   imposes is presumption, not hospitality.
3. **Correctness before anticipation.** A host who anticipates wrongly is worse than one
   who waits. Trust is built with quiet, correct **actuals** first; the system earns the
   right to propose (tags, drafts, flags) only on data the user already trusts. This is
   why the build phases run actuals → attribution → budgets → anticipation, in that order.
4. **The measure of success** is not "how much does this show" but "how much work did it
   remove." A surface nobody needs to open — because the thing it would have told them was
   already handled — is the ideal end state, not a failure of engagement.

A unit that fails the test is redesigned, not shipped. (Recorded case: the first draft of
the rework tag put a "planned vs fault" choice on the PR raiser in the field — it failed
the test and was redesigned to a system-proposed, approver-confirmed tag; see §3.)

---

## 1. Context and evidence

### 1.1 What the operator wants

Shared visibility so each function decides better on the same facts: procurement seeing
**what a WP has cost** (monitor, spot ideas — rent vs buy, supplier drift) and **when
materials are needed** (buy ahead, not react). The unifying object is the **project**, and
within it the WP; role remains a lens (procurement reads field/money data through its own
view — it is not dropped onto the field's screens). Role walls stay load-bearing: spec 46
keeps ฿ off field surfaces; that is visibility policy, not nav.

### 1.2 What already exists (gate-checked 2026-07-17, main @ 0.126.x)

- **Per-WP actuals already computed:** `src/lib/dashboard/spend.ts` (wpLevel spend),
  `src/lib/work-packages/group-detail.ts` + `load-group-detail.ts` (WP-group cost),
  `src/app/accounting/projects/[projectId]` (finance per-project view). Labor (labor_logs
  day-rate derive), materials (PR/PO amounts), equipment (rental allocations, spec 275)
  each have live money pipelines.
- **Budgets today:** the WP's 1:1 economics satellite `wp_economics` carries a **total**
  budget (`set_wp_budget`) and a **labor** budget (`set_wp_labor_budget`, spec 205).
  There is **no material budget and no equipment budget**.
- **A cause field ALREADY EXISTS on PRs** (fresh-eyes catch, 2026-07-17):
  `purchase_requests.reason_code` — enum `unplanned_miss | rework | breakage |
scope_change | unforeseeable`, captured **optionally** at PR insert
  (`requests/actions.ts`), null when not given. Nothing consumes it for cost routing
  today. Phase 2 therefore **reuses this column instead of adding one** (§3): the gap is
  not the field, it is (a) nothing proposes it, (b) the approver never confirms it, and
  (c) no read-model routes cost by it.
- **Demand-timing exists in embryo:** the supply plan (`/projects/[id]/supply-plan`,
  SUPPLY_PLAN_ROLES admits procurement) — PM-centric, per-project.
- **Cautionary precedent (binding on design):** the WP-equipment check-out flow shipped
  with a capture step the field never performed — `equipment_usage_logs` = 0 forever —
  and was retired (spec 323 D6). Any unit whose data depends on a new field-capture
  discipline must assume it will not be performed, and must degrade gracefully to zero
  rows (or not ship).

### 1.3 Why not "charge rework to labour" literally (design session outcome)

The operator's opening rule — fault-caused material charges to the labour side — aims at
**accountability**. Folding rework INTO the labour number was examined and rejected
because it makes two numbers lie (labour inflated by material buys; material silently
missing real purchases) and buries the most actionable figure. The accepted design keeps
the intent (cost routed **by cause**) but gives rework **its own always-visible line**
with a **budget of ฿0** — accountability by exposure, not by burial. With rework pulled
out, a WP whose base categories are all in-budget but which carries ฿25k of rework reads
truthfully: the work was fine; the waste is the problem.

---

## 2. The model (locked in the design session)

**Three base categories + one exposure line, rolled into two families:**

| Line                           | Holds                                                       | Grain                | Budget                                   |
| ------------------------------ | ----------------------------------------------------------- | -------------------- | ---------------------------------------- |
| **ค่าวัสดุ · Material**        | planned material purchases — what becomes the building      | per WP               | per-WP material budget (Phase 3)         |
| **ค่าแรง · Labour**            | man-days (existing labor_logs derive)                       | per WP               | existing `labor_budget` (`wp_economics`) |
| **ค่าเช่าอุปกรณ์ · Equipment** | rental cost via project allocations (spec 275)              | **per PROJECT only** | per-project equipment budget (Phase 3)   |
| **ของเสีย/แก้ไข · Rework**     | rework-caused material **and** redo labour, routed by cause | per WP               | **always ฿0** — any amount reads as over |

⚠ **Equipment grain is deliberately project-level.** Rentals bind to a project via
allocations; the WP-level equipment tie was retired with zero usage (spec 323 D6, §1.2).
A per-WP equipment bar would require re-introducing exactly the capture this spec's own
precedent killed — so equipment appears in the **project family totals** (inside
ค่าดำเนินการ) but NOT as a per-WP bar. WP cards show material + labour + rework.

- **Two families for the glance:** ค่าวัสดุ (material) vs **ค่าดำเนินการ (execution =
  labour + equipment)** — the operator's "equipment is labour-side" intuition holds at the
  family level; equipment stays a separate, monitorable number underneath (rent-vs-buy
  signal preserved). Rework sits beside the families as the exposure line.
- **Routing is by CAUSE, not by type.** A cement purchase is Material when planned and
  Rework when bought to redo spoiled work. Cause is a property of the purchase event.
- **Display grain:** per WP within a project (material + labour bars + rework line per WP
  card), with project-level family totals above (equipment appears there, per the grain
  note). Wireframes were reviewed and accepted in-session (three-category cards →
  execution-total roll-up → rework-line variant); the accepted wireframes drew a per-WP
  equipment bar — **amended here to project grain** after the §1.2 grounding check.

## 3. Cause attribution — the omotenashi tag

Designed to pass §0 — and cheaper than first drafted, because the column already exists:

- **Reuse `purchase_requests.reason_code`** (`unplanned_miss | rework | breakage |
scope_change | unforeseeable`, today optional-at-raise and unconsumed). Routing to the
  rework line = `reason_code IN ('rework','breakage')` (waste); null and the other values
  read as planned-side (a legitimate need that wasn't forecast is NOT waste). ⚖️ the
  breakage-in-or-out call is operator-confirmable in review.
- **Neutral vocabulary, never blame:** the enum is already about _why bought_, never
  _whose fault_ — keep it that way in every label. A blame flag would be gamed to zero by
  the crew's ally raising the PR; a neutral reason can be answered honestly.
- **The system proposes, the approver confirms.** Default = planned (null). The system
  pre-proposes `rework` from signals it already holds (e.g. the PR follows a defect report
  on the same WP; a repeat purchase of the same item shortly after delivery). The
  PR **approver** — already reviewing the request — sees the proposed reason and confirms
  or flips it in one tap. The field raiser is never required to answer (their optional
  reason, when given, seeds the proposal).
- **Redo labour:** rework labour (paying the crew to re-do) is attributable at the same
  approval altitude later (labor-log cause), but is explicitly **Phase-2-optional** — the
  material side alone already carries most of the signal, and labour-cause capture must
  clear the §1.2 capture-discipline bar before it ships.

## 4. Invariants (binding)

1. **Money visibility unchanged:** every surface in this spec is gated to the existing
   money audiences (MONEY_VIEW_ROLES / procurement tiers per surface); no ฿ reaches a
   field role (spec 46). "Everyone on the same page" here means PM + procurement +
   accounting — the field is excluded from cost by design.
2. **Display/attribution layer only — no GL change.** Categories and the rework line are
   read-model classifications over existing money pipelines; GL posting (ADR 0057/0078)
   is untouched. Cause routing reads the existing `reason_code` — not a journal concept,
   and no new money column.
3. **No new mandatory field-capture** (§0 rule 1; §1.2 precedent).
4. **Append-only + supersede disciplines unchanged** wherever the tag lands.

## 5. Phased build (each phase independently valuable; later phases optional)

- **Phase 1 — Actuals (no new capture at all).** Compose the existing spend into the
  per-WP material + labour view and the project family totals (equipment joins at project
  grain via rental allocations, per §2). No budget denominators beyond the existing
  labor_budget; no rework line yet. Ships value from data that already exists; zero
  behavioral risk.
- **Phase 2 — Cause routing + rework line (NO new column).** Consume the existing
  `reason_code` (§3): the system-proposed/approver-confirmed flow + the ของเสีย/แก้ไข
  line (฿0 budget) in the Phase-1 views. Redo-labour attribution optional, gated on §1.2.
- **Phase 3 — Budgets (gated on an OWNER).** Per-WP material + equipment budget targets
  (labour exists). ⚖️ **Operator decision required first: who sets and maintains these
  numbers per WP?** If no named owner, Phase 3 does not ship — Phase 1/2 remain fully
  useful as actuals.
- **Phase 4 — Anticipation (the omotenashi payoff; separate spec when reached).** On
  trusted Phase 1–3 data: demand-timing drafts (the order proposed when the WP timeline
  says it's due) and the per-department agent reading these seams (`ดูสาเหตุ` analysis,
  drift nudges). Explicitly deferred — §0 rule 3.

## 6. Open operator decisions (before Phase 1 is sliced)

1. **Where does the procurement view live?** Per-project (a cost tab on the project /
   WP surfaces) vs cross-project (a door in the /procurement STR hub with the project
   lens) — the embedded-vs-cross-project fork. Recommendation: both read the same
   read-model; start per-project (matches the wireframes), add the hub door after.
2. **Phase-3 budget owner** (§5) — named person or Phase 3 stays parked.
3. **Rework-labour capture** (§3) — include in Phase 2 or defer.

## Out of scope

- GL re-shaping, transfer pricing, wp_profit UI (ADR 0060 dormant machinery unchanged).
- Any nav restructure (spec 313/323 territory).
- Field-facing cost display of any kind.
- Push notifications / alerts (fails §0 rule 2 in v1).
