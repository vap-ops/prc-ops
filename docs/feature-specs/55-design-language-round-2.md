# Spec 55 — mockup design language, round 2 (remaining detail headers)

**Status:** complete (2026-06-13) — operator eye on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator "proceed" after spec 54 — roll the mockup language
onto the remaining detail surfaces, one small round (spec-40 loop).

## Scope

Pure restyle — no new logic, no data changes, no machinery touched.

1. `/requests/[requestId]`:
   - Text back link → the spec-54 back chip (44px rounded-xl, ArrowLeft,
     aria-label, RefreshButton stays right).
   - Title row: `text-xl font-semibold` → `text-2xl font-bold` (spec-54
     headline scale).
   - Rejection block (เหตุผลที่ไม่อนุมัติ) → `AttentionCard` tone=red —
     the one attention pattern everywhere (spec 54).
2. `/sa/projects/[projectId]` (WP list):
   - Back link → back chip.
   - Project name to the spec-54 headline scale.

NOT touched (recorded): the reports page ← lives in a tab-style nav row
(not a detail back affordance); hub pages keep the AppHeader brand band
(the mockup shows a detail screen — no evidence the operator wants the
band gone; ask via the feedback loop instead of guessing).

## Tests

No new logic. AttentionCard contract already pinned
(tests/unit/attention-card.test.tsx); restyle rounds follow the spec-40
precedent — full suite + build must stay green.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator eye on deploy.
