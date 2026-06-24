# Spec 194 — super_admin override on an approved supply plan

**Why:** operator — a super_admin should be able to revert the status / edit an
approved (frozen) supply plan, with the plan labeled "overridden by [name]". The
supply-plan lifecycle is otherwise one-way past approval (PM submits → PD/super
approves → frozen; only a rejected plan is re-editable).

## Design (shipped 2026-06-24, commit 58dc371)

- mig `20260813000100`: `supply_plans` += `overridden_by` / `overridden_at`.
  `reopen_supply_plan(plan)` definer — **super_admin only** — takes a submitted/
  approved plan back to `draft` (editable; add/remove-line already allow draft),
  clearing the prior submit/approve stamps and recording `overridden_by` +
  `overridden_at`. The marker **persists** through a later re-approval (so the plan
  always shows it was force-reopened). pgTAP `209`.
- `reopenPlan` action + a "เปิดแก้ไข (ผู้ดูแลระบบ)" button on a frozen plan (shown
  only when `canOverride` = super_admin) + a "· ปรับแก้โดย [name]" marker next to
  the status. The page resolves the overrider's name via the admin client
  (`public.users` is read-self, ADR 0011).

## Scope / extending

Operator chose **supply plans first**. The pattern (a `reopen_*` super-only RPC +
an `overridden_by/at` stamp + a label) is the template to extend to other approved
entities (purchase requests, WP approvals, …) when wanted — each is its own unit,
and each bypasses an approval control, so each should keep the audit stamp.
