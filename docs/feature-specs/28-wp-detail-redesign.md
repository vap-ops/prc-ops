# Spec 28 — WP detail redesign: owner/team, attention strip, responsive IA

**Origin:** operator chat 2026-06-11 — "what are the data that should be
present in the WP detail page, plan first, consider phones and tablets"

- "how about WP owners and his/her team?" + approval "full".
  Decision record for the schema half: ADR 0032.

## Part A — Owner + team

DB per ADR 0032 (`owner_id`, `work_package_members`, RLS, pgTAP 23).

UI on `/sa/projects/[projectId]/work-packages/[workPackageId]`:

- Header gains ผู้รับผิดชอบ chip (owner full_name) + ทีม names line
  (truncated on phone). Em-dash placeholders when unassigned.
- PM/super-only มอบหมายงาน expander (`<details>`): owner `<select>` +
  member add `<select>`/remove ลบ list. Server actions
  `setWorkPackageOwner` / `addWorkPackageMember` /
  `removeWorkPackageMember` — PM/super enforced by RLS (members) and
  the existing WP UPDATE policy (owner); actions just relay.
- Staff options resolved server-side via admin client: users with role
  in (site_admin, project_manager, super_admin), name fallback email.

## Part B — Header summary, attention strip, description

- Summary line under the WP name: `รูป X/3 ช่วง · คำขอซื้อ Y ค้าง`
  (open = status not in delivered/rejected/cancelled).
- **Attention strip** (full width, directly under header, ALL form
  factors): latest approvals row for this WP when its decision is
  `needs_revision` (amber, ต้องแก้ไข + comment + decider + date) or
  `rejected` (red). Hidden when latest decision is approved/none — the
  strip only exists when someone must act.
- Description block (the never-shown `description` column), rendered
  as `<details>` (closed) on all sizes — one tap, keeps photos high.

## Part C — Responsive reflow + approval history

- ≥ `md`: two-column grid `[1.6fr_1fr]` — photos (the tablet payoff:
  larger thumbnails) left; right rail = description, purchasing,
  history. Phone keeps the single column: attention → photos →
  description → purchasing → history (photos-first deviation from the
  mock's description-first order — the SA's primary job wins; recorded).
- **Approval history** section (new): all approvals rows for this WP,
  newest first — decision pill (existing approvalDecisionPillClasses),
  comment, decider display name, formatThaiDateTime. `<details>`
  closed by default (the attention strip already surfaces the latest
  actionable one). Visible to all staff who can open the page (operator
  accepted the exposure in the plan round).

## Out of scope

WP name/description editing, งานของฉัน filter, notifications,
received_by→user link, photo annotations.

## Verification checklist

- [ ] pgTAP 23 green post-push; suite green; types regenerated.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] 375px: single column order correct, chips truncate, no overflow.
- [ ] ≥768px: two columns, photos left.
- [ ] Manual: PM assigns owner+members; SA sees chips read-only;
      needs_revision WP shows the amber strip with the comment.
