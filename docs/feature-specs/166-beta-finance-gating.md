# Spec 166 — Beta finance gating (hide provisional GL from PMs)

**Status:** In progress (U1).
**Relates to:** ADR 0057 / spec 149 (GL), ADR 0058 / spec 152 (project_director
reads the ledger — this temporarily reverses that for beta), spec 161 (Nova).

## Problem

Pre-beta money-surface audit (2026-06-21): Nova `/nova/*` is fully super_admin-
gated (safe), and project/WP pages don't leak money. But the **GL `/accounting`
surface is reachable by `project_manager` / `project_director`** (spec 152 put
them in `ACCOUNTING_ROLES`). The GL numbers are **provisional** until the
accountant config (COA / WHT / PEAK mapping, spec 149 U8 + go-live) is finalized,
so showing them to beta PMs risks "wrong numbers" confusion.

Operator decision (2026-06-21): for the beta, **hide บัญชี (GL) from PMs, keep
ค่าจ้าง (payroll)** — payroll is operationally useful; the GL is operator-only
until configured. Reversible (re-add the roles + un-gate the link once the GL is
calibrated).

## U1 — restrict the GL surface to accounting + super_admin

- `ACCOUNTING_ROLES` (role-home.ts) tightened from
  `[accounting, project_manager, super_admin, project_director]` →
  **`[accounting, super_admin]`**. This auto-tightens all four `/accounting`
  route guards (`requireRole(ACCOUNTING_ROLES)` on `/accounting`,
  `/accounting/retention`, `/accounting/billings`, `/accounting/wht`) — a PM /
  director now bounces.
- Settings → การเงิน: the **บัญชี** link is gated to `ACCOUNTING_ROLES` (so among
  managers only super_admin sees it; the `accounting` role still reaches it via
  its own tab/hub). **ค่าจ้าง (/payroll) stays under `isManager`** — unchanged.
- No DB change: the GL tables are zero-grant, read via the admin client _behind_
  `requireRole`, so the route guard is the gate.

### Acceptance

- A `project_manager` / `project_director` cannot open `/accounting/*` and sees
  no บัญชี link in settings; still sees ค่าจ้าง.
- `accounting` + `super_admin` keep full GL access.

### Reversal (post-config)

Re-add `project_manager` + `project_director` to `ACCOUNTING_ROLES`; the settings
link follows automatically. One-line revert.

### Out of scope

- Nova (already operator-gated). Payroll visibility (kept). The accountant config
  itself (spec 149 U8 / go-live).
