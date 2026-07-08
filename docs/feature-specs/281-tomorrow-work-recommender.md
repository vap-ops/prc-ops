# Spec 281 — แนะนำแผนพรุ่งนี้: heuristic draft-board recommender

**Status:** 🎨 **DESIGN — approved by operator 2026-07-08 (via brainstorming).** Build not started.
Units get their own session per the one-PR-per-unit loop.
**ADR:** none new. Extends [0076-daily-work-plan-layer.md](../decisions/0076-daily-work-plan-layer.md)
(the แผนพรุ่งนี้ layer) and reuses its 5 write RPCs unchanged. Complements spec **276** (continuity:
backup builder + missing-plan nudge) — 276 ensures a board _exists_; 281 recommends _what goes on it_.
This is the "later automation feature" 276 D6 deferred the auto carry-forward to.
**Origin:** operator, 2026-07-08 — "design a recommendation system for tomorrow's work." Grounded through
brainstorming to: pre-build tomorrow's แผนพรุ่งนี้ board as a **draft** the SA reviews and approves.

## 1. Problem & goal

Spec 273 gives the SA a next-day board, hand-built from scratch each evening: pick every งานย่อย, assign
every crew. The signals that _should_ drive tomorrow's plan already live in the data — what's unfinished,
what's slipping its baseline, what a crew worked recently — but the SA carries them in their head. Goal:
**generate a default-populated draft board** (งานย่อย + a suggested crew each, with a plain reason),
so the evening act becomes _review + trim + approve_ instead of _build from nothing_.

Heuristic, not an LLM (operator pick 2026-07-08): explainable, ships on data that exists, provable value,
no LLM runtime needed (per the MCP-readiness audit + the ai-first-**prove-value** doctrine). An LLM planner
is an explicit phase-2 swap behind the same draft-board contract.

## 2. Decisions (operator-confirmed 2026-07-08)

| #   | Decision                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Output = a draft board (งาน + crews), not a watch-list.** The recommender proposes tomorrow's whole แผนพรุ่งนี้: which งานย่อย + a suggested crew per งาน.                                                                                   |
| D2  | **Heuristic / rules engine, not an LLM.** Deterministic tiered scoring; every suggestion carries a plain Thai reason. LLM planner deferred to phase 2 (swap the scorer, keep the contract).                                                    |
| D3  | **Aggressive carry-forward.** Carry forward **every not-done leaf งานย่อย that has been started** (not only the last board's), on the SA's projects. Breadth over caution.                                                                     |
| D4  | **Default-selected, NOT forced.** Every suggested งาน + its suggested crew is **pre-checked** in the draft. The SA unchecks/edits anything, then applies only what stays selected. Aggressive proposal, one-tap opt-out.                       |
| D5  | **Nothing writes until the SA approves.** The recommender only READS + proposes an ephemeral draft; the SA's approval drives the _existing_ spec-273 write RPCs. No silent auto-writing of tomorrow's plan (it is operationally load-bearing). |
| D6  | **Lives in the existing `/sa/plan` builder** (276 D2 kept the builder as the structural-edit home) — a "แนะนำ" action fills the board with the draft, in place, not a new screen.                                                              |
| D7  | **Code-only v1 — no schema.** Reads existing tables + computes → proposes → one-taps into 273's RPCs. The draft is ephemeral (in-memory) until accepted; nothing new is persisted.                                                             |

## 3. The heuristic (pure, unit-tested — U1)

Score every **not-done leaf งานย่อย** (`is_group = false`, status not in a done/closed terminal) on the
SA's visible projects into ordered tiers; higher tier = higher default rank. Each carries a `reason`:

1. **ต่อจากวันนี้ (carry-forward, D3 aggressive)** — the WP has been started but is not done (was on any
   recent board and/or its status is in-progress). Continuity: keep the crew going. _Reason: "ต่อจากวันนี้
   — ยังไม่เสร็จ"._
2. **ช้ากว่าแผน (behind schedule)** — not-done and past / near its spec-271 baseline finish date. _Reason:
   "ช้ากว่าแผน"._ Degrades to nothing when baselines are unbound (§7).
3. **ลำดับความสำคัญ (priority)** — remaining not-done งาน ranked by the shared worklist priority rank. _Reason:
   "ลำดับความสำคัญ"._

Union the tiers (a WP appears once, at its highest-qualifying tier), order by (tier, then within-tier
signal), take a sensible top-N with the rest available to add. **Crew pre-assign** per งาน, best-available:
recent-continuity crew (the crew that ran this งาน on a recent board) → else a crew whose spec-277 category
matches the งาน → else blank (SA picks). The crew suggestion also carries its reason.

The engine is a pure function over already-fetched rows (`recommendTomorrowBoard(...) → DraftItem[]`), so it
is fully unit-testable and swappable (phase-2 LLM slots in here).

## 4. Surface & flow (U2)

- In `/sa/plan`, a **แนะนำแผนพรุ่งนี้** action builds the draft for tomorrow's board.
- The draft renders as the board's rows, **every row + its crew pre-checked (D4)**, each with its reason
  chip. The SA unchecks rows, swaps/clears a suggested crew, adds งาน the engine missed.
- **ใช้ที่เลือก** commits only the still-selected rows → the existing 273 RPCs (`add_daily_plan_item`,
  `set_daily_plan_item_crew`, …) run under the SA's session. Until then nothing is written (D5).
- Idempotent against an existing tomorrow board: suggestions already on the board are shown as such, not
  duplicated (the add RPC is already `on conflict do nothing`).

## 5. Data (code-only)

Reads only, all already granted / RLS-scoped to the SA's projects: `work_packages` (status, is_group,
category, baseline dates via 271), `daily_work_plans`/`_items`/`_crew` (recent-board history →
carry-forward + crew continuity), `crews`/`crew_members` (crew suggestions, U7b read-grant), the shared
priority rank, `project_categories → work_categories` (category↔crew). **No new table** — the draft is
ephemeral until the SA accepts, at which point it becomes a normal board via 273's RPCs.

## 6. Units

- **U1 — the recommender engine.** Pure scoring lib (`recommendTomorrowBoard`) + tests: the three tiers,
  aggressive carry-forward, crew pre-assign fallback chain, reasons, top-N. Code-only.
- **U2 — the แนะนำ surface.** The `/sa/plan` draft render (default-checked rows + reasons), un-check/edit,
  ใช้ที่เลือก wired to the 273 RPCs. Code-only.
- **Phase 2 (later, own spec) — LLM planner.** Swap the U1 scorer for an LLM behind the same
  `DraftItem[]` contract, once a runtime exists and the heuristic has proven the loop is used.

## 7. Open items / caveats (all degrade gracefully)

1. **Crew pre-assign is weak until the attendance loop fills.** `labor_logs` is empty firm-wide, so
   "who ran this งาน recently" leans on the thin 273 board history; it falls back to category-match or
   blank. Improves automatically as the roster + muster (spec 278/279) get used.
2. **The ช้ากว่าแผน tier is thin until the 271 baselines are bound** (operator owes spec 271 U0 —
   appoint site_owner/auditor + bind the 47 งาน). Without baselines the engine simply drops that tier and
   ranks by carry-forward + priority.
3. **Rest-days / no-work-tomorrow** — like 276 D6, v1 has no "วันหยุด" acknowledgement, so it will happily
   draft a board for a Sunday. Folds into the same later automation feature. Documented, not silently shipped.
4. **Empty-roster reality** — until เล็ก's real crews + boards exist, the draft is mostly the priority tier
   with blank crews. The value compounds as the onboarding + attendance loops fill.
