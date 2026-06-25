# Architecture & quality audit — June 2026

Run 2026-06-25 as an 8-lens multi-agent workflow (49 agents, adversarial
ground-truth verification): pattern/convention consistency, data-fetch
efficiency (waterfalls), coupling & module organization, RLS/security
uniformity, dead code & duplication, bundle/perf, naming SSOT, test fragility.
**40 candidate findings → 24 confirmed + 16 partial, 0 refuted → 15-item ranked
register.**

## Headline

prc-ops is a **healthy, well-governed codebase**. The debt found is almost
entirely _latent drift-prevention and hygiene_, not active correctness or
security defects — every "high" was downgraded on verification **except the GL
test fixture-scoping family** (the one genuine blocker for Phase-1 revenue
work). Two SSOT clusters dominate, and they are exactly the shotgun-surgery
drift the operator most fears:

1. **Money formatting** — ~22–30 hand-rolled `baht`/`round2` copies in 4 idioms,
   incl. one identifier `baht` that means three different output formats.
2. **Role-set literals** — duplicated across TS and ~142 SQL sites with no
   parity link.

Single highest-leverage fix: consolidate money formatting into a `format` SSOT
with named variants + a lint guard — removes a whole class of drift, de-risks
every Phase-1 accounting money surface, and stops the copy count growing per
screen.

## Ranked register

Effort = Fibonacci backlog points (1 trivial · 2 small · 3 medium · 5 large).

| #   | id                             | Title                                                                                                            | Sev      | Pts | Phase weave                                                                           |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------- | --- | ------------------------------------------------------------------------------------- |
| 1   | `money-ssot`                   | Money formatting fractured: ~22–30 inline `baht` copies, 4 idioms, one name → 3 outputs                          | med      | 5   | **Pairs with G8/G11** (both render baht). Standalone PR ideally before G8.            |
| 2   | `role-set-ts-dedup`            | Role-gate arrays duplicated outside role-home SSOT, unpinned by tests; **drain omits `project_director`**        | med      | 2   | Independent; **before G63**. Drain fix pairs with any notifications touch. Quick win. |
| 3   | `gl-test-fixture-scope`        | GL pgTAP 81/85/86/87/88 assert **table-wide aggregates**, go red when real revenue flows                         | **high** | 3   | **BLOCKS clean Phase-1 G8/G11.** De-brittle before/at start of G8.                    |
| 4   | `store-page-waterfall`         | Store/supply-plan/workers RSC loaders run ~8 independent reads **serially** (specs 147/148)                      | med      | 3   | Independent; pairs with next 197/198 store phase.                                     |
| 5   | `sql-role-helpers`             | Role membership inlined across ~142 migrations; no `is_manager`/`is_back_office` SQL predicate, no TS↔SQL parity | med      | 5   | Independent; **before G63**. Staged, one domain per session.                          |
| 6   | `photo-lightbox-dynamic`       | 524-line markup canvas statically imported per thumbnail; code-splitting near-unused app-wide                    | low      | 3   | Independent; pairs with any photos/WP-detail touch.                                   |
| 7   | `action-gate-uniformity`       | Two auth-gate idioms in server actions (`requireRole` vs `requireActionRole`) + duplicated error strings         | low      | 3   | Independent; **align as you write G8/G11 actions.**                                   |
| 8   | `store-manager-godcomp`        | `store-manager` 869-line god-component, 14 useStates, duplicates sibling components                              | med      | 5   | Independent; next store spec. Do NOT interrupt G8 (money-touching).                   |
| 9   | `formatters-discoverability`   | `baht`/date/time formatters buried in enum-label SSOT `labels.ts`; date logic split with `dates.ts`              | low      | 2   | Precondition/opening move of the rank-1 money-SSOT PR.                                |
| 10  | `design-doctrine-test-broaden` | Token guard test only bans green palette; raw zinc/emerald/slate/red slip through                                | low      | 2   | Independent; lightbox migration rides rank-6.                                         |
| 11  | `ssot-literal-bypass`          | 2 single-sourced terms re-hardcoded inline (hub-nav, ledger-view)                                                | low      | 1   | Trivial; bundle into rank-1 PR or next-touched file.                                  |
| 12  | `dormant-code-annotate`        | Backend-shipped-no-UI validators (equipment batch/alloc, **manual-JE `validateJournalLines`**) unmarked          | low      | 2   | `validateJournalLines` is the **intended G8 consumer — wire it in, don't annotate.**  |
| 13  | `policies-are-exact-set`       | `policies_are` exact-set pin (test 20) breaks on any additive RLS policy                                         | low      | 2   | Independent; convert opportunistically on next purchase-attachment RLS change.        |
| 14  | `drain-skip-locked`            | `drain_gl_posting` lacks `FOR UPDATE SKIP LOCKED` (tracked prod concurrency follow-up)                           | low      | 2   | Pairs with rank-3 GL de-brittle. Fix before revenue traffic ramps.                    |
| 15  | `lucide-optimize-imports`      | `optimizePackageImports` not explicit for lucide-react (likely already in Next 16 default)                       | low      | 1   | Lowest; only if measuring confirms a delta.                                           |

## Notable real gap (within rank 2)

`src/app/api/notifications/drain/route.ts:148` resolves pending-approval / PR
LINE recipients with `.in("role", ["project_manager","super_admin"])` —
**`project_director` is omitted**, so a PD misses those pings even though PD is a
see-all PM (`PM_ROLES`). Fix = use `PM_ROLES`. (Product check: confirm PD should
be pinged — expected yes.)

## Phase-plan integration (woven)

**Around the G8 manual-JE unit:**

1. **Before G8 — GL pgTAP de-brittle (rank 3 + rank-14 SKIP-LOCKED rider).**
   Scope 81/85/86/87 to fixtures (delete-from-outbox guard like 82/84/88, or
   `source_id`/`memo` match); rewrite 88 to **deltas** (capture pre-fixture
   4100/1210/retention totals, assert AFTER−BEFORE = fixture amount; keep the
   debit=credit balance check). G8/G11 generate exactly the outbox+ledger
   traffic that flips these red — clear them now to avoid a flaky-test
   investigation on every accounting PR.
2. **G8 built SSOT-clean.** Render baht through the canonical `baht()`
   (`labels.ts`, today's SSOT); wire `validateJournalLines` (rank 12);
   standardize the new accounting actions on `requireActionRole` + hoist
   `GENERIC`/`AccountingActionResult` (rank 7).
3. **Money-SSOT consolidation (rank 1 + rank 9)** as a dedicated standalone unit
   — extract `src/lib/format.ts` (`baht`, `bahtCompact`, `bahtWithSymbol`,
   `bahtUnit`, `round2`), reconcile grouping onto one locale, point all copies
   at it, add a lint/unit guard, fix the baht-string test pins (price-comparison,
   store-pnl-view, pgTAP) in the same commit. G8 itself is already SSOT-compliant
   if it imports `baht`, so this can land just after G8 without re-touching it.
4. **Role-set hardening (rank 2 → rank 5)** as standalone work **before the G63
   role-admin phase** (which would otherwise repeat the hand-sweep). Rank 2
   (TS dedup + drain PD fix) is a quick win; rank 5 (SQL `is_*` predicates) is
   staged per-domain.
5. **Defer** the store/equipment god-component + waterfall refactors (ranks 4, 8)
   to the next 197/198 store phase where those files are already open.
6. **Background hygiene** (ranks 6, 10, 15) rides whatever feature next touches
   photos, WP-detail, or auth screens.

## Quick wins (≤2 pts, do inline with the next unit)

`role-set-ts-dedup` (rank 2) · `ssot-literal-bypass` (rank 11) ·
`design-doctrine-test-broaden` (rank 10) · `formatters-discoverability`
(rank 9) · `dormant-code-annotate` (rank 12) · `policies-are-exact-set`
(rank 13) · `lucide-optimize-imports` (rank 15).
