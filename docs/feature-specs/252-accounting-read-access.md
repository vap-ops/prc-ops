# Spec 252 — Accounting role: read access to cost surfaces + role onboarding

**Status:** APPROVED (operator-aligned design 2026-07-03; part of the Finance build 249–253)
**Origin:** Finance user's cost-side asks 2 & 3 ("ค่าแรงงานรายวัน", "ค่าของที่ใช้ในโครงการ") are ALREADY tracked — but invisible to them: `/payroll` gate = PM/super/PD; `/dashboard` money = PM-only; `wp_profit()` = super/PD. Operator decision: **full read** — accounting sees everything PM sees, read-only. Bonus: the `accounting` role still lands on `/coming-soon` after login (`roleHome`); this spec onboards it.

## Goals

1. `accounting` reads: payroll (owed/paid, per-worker incl. day rates), dashboard money (budget + spend split), labor detail, `wp_profit()`.
2. Writes stay exactly as today — accounting gains ZERO write paths.
3. `accounting` login lands on `/accounting` (role onboarded; `/coming-soon` redirect removed for it).

## Changes

**App gates (code):**

- `roleHome()`: `accounting → /accounting`. (CLAUDE.md role table's "v3" note is superseded for this role by this spec — operator-approved onboarding.)
- `/payroll`: page-access set += `accounting`; **write affordances role-gated OFF** (record-payment sheet + any mutating action hidden AND the server actions keep their existing PM-only gates — defense in both layers).
- `/dashboard`: admit `accounting` to the money view (budget/spend split, store pool) — same data PM sees, no approval affordances.
- Role-set constants: whatever named set gains `accounting` must be a NEW read-scoped constant (e.g. `MONEY_READ_ROLES`) — do NOT widen `PM_ROLES`/`PAYROLL_ROLES` themselves (those gate writes elsewhere). Audit every use-site of any constant touched.

**DB (schema lane, migration ts `20260813065000`):**

- `wp_profit()` gate: allow `accounting` (currently super_admin/project_director). Body **re-sourced VERBATIM from LIVE**, DROP+CREATE per db lessons, `::regprocedure` pins re-checked, null-safe fail-closed gate preserved.
- Audit at build time which OTHER read-only definer RPCs the new surfaces call (e.g. payroll/labor readers, `gl_trial_balance`-class fns already admit accounting) — widen ONLY read-only ones actually hit by the pages, each listed in the PR body. Any RPC that mutates: untouched.
- pgTAP: every widened gate gets accounting-allowed + still-fail-closed-on-NULL + site_admin-refused asserts; zero-unsafe-gates invariant (229#39) must stay green.

**Explicitly NOT in scope:** RLS arms on money tables for direct reads — the payroll/dashboard surfaces read via admin client behind app gates today; keep that shape. No new client-side data paths.

## Units

| Unit | Lane   | Content                                                                                          |
| ---- | ------ | ------------------------------------------------------------------------------------------------ |
| U1   | SCHEMA | `wp_profit` (+ audited read-RPC set) gate widening, re-sourced from LIVE + pgTAP                 |
| U2   | code   | roleHome + `/payroll` + `/dashboard` read admission (write affordances hidden, actions re-gated) |

Out of scope: any accounting WRITE ability; site_admin/PC visibility changes; per-worker rate masking (operator chose full read); notification changes.

## Verification checklist

- [ ] pgTAP: widened gates admit accounting, refuse site_admin/visitor/NULL; invariant test green; full `pnpm db:test`.
- [ ] Unit: roleHome mapping; payroll page hides mutations for accounting (render test); server actions still refuse accounting (gate test).
- [ ] Real-browser (dev-preview recipe): accounting-role user lands on `/accounting`, opens `/payroll` + `/dashboard`, sees money, finds no mutation controls.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
