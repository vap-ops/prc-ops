# Spec 192 — First-real-project readiness

**Why:** the app is feature-complete but operator-incomplete — built far ahead of
real usage (≈0 workers, ≈2 contractors in prod). The highest-leverage work is no
longer breadth; it's removing the friction cliffs that would stop a _first real
project_ from producing trustworthy data. Two cliffs were mapped:

1. **Silent membership dead-end.** Project visibility is membership-gated
   (`can_see_project` = a `project_members` row OR `project_lead_id`, ADR 0056).
   A project with no members — or where the site admin was never added — is
   invisible to that person (a 404, not an explanation, and they can't even see it
   to ask). `removeProjectMember` had **no guard**: a PM could remove the last
   member (or themselves) and orphan the project, visible only to super_admin.
2. **No site-admin home** (the SA's daily loop — log labor / photos / PR — is
   buried 3–4 taps deep in a work-package tab). _(Later unit.)_

## U1 — membership safety net (shipped 2026-06-24)

The bounded, correctness-flavored first win. Keep the invariant **a project always
retains ≥1 member** and make self-removal an informed choice. No migration — a
UX-footgun guard at the right altitude (member add/remove are already direct
table ops under RLS, not RPCs; projects are never hard-deleted, so no cascade
concern).

- **Pure** `evaluateMemberRemoval({ totalMembers, removingSelf })` →
  `{ blocked, reason?, needsConfirm }`: blocks when `totalMembers <= 1` (last
  member); flags `needsConfirm` for a self-removal when others remain.
- **Server** `removeProjectMember` counts members first and refuses the last one
  with a clear Thai error (the load-bearing guard — can't be bypassed by the UI).
- **UI** (`settings-form.tsx`, new `currentUserId` prop): the last member's remove
  control is disabled with a "ต้องมีสมาชิกอย่างน้อย 1 คน" hint; removing **yourself**
  (when others remain) routes through the themed `ConfirmDialog`
  ("…คุณจะไม่เห็นโครงการนี้อีก…"), removing someone else stays one-click.

## U2 — onboarding leads with the team (shipped 2026-06-24, commit 93225df)

The setup checklist listed "เพิ่มทีมงาน" third with no rationale. Team is the access
prerequisite (a project is only visible to its members), so move it FIRST and add a
one-line why ("เพิ่มก่อนเป็นอันดับแรก เพื่อให้พวกเขาเห็นโครงการและเริ่มทำงานได้").
Presentational (rows gain an optional `hint`).

## U3 — non-member explainer, not a bare 404 (shipped 2026-06-24, commit 14b842e)

When the user session can't see a project, an admin-client exists-check distinguishes
RLS-hidden (not a member) from truly-gone: gone → still 404; hidden → render
`NoAccessNotice` ("คุณยังไม่ได้อยู่ในทีมของโครงการนี้ — ติดต่อผู้จัดการโครงการ…") in the
standard chrome with a back link. super_admin / coordinator see-all, never reach it.

## U4 — site-admin daily home (DESIGN APPROVED 2026-06-24, mock-first; NOT yet built)

Cliff 2: the SA's home is the project hub `/projects` (the old `/sa` merged into it,
spec 82) — so the daily loop (log labor / photos / PR) is buried 3–4 taps deep in a
WP tab. Operator approved (AskUserQuestion, after a `show_widget` mock): **build an
action-forward SA daily home, and make it the SA's landing** (the full project list
stays a bottom tab).

Design (from the approved mock): greeting → a hero "ลงเวลาทีมงานวันนี้" (the
highest-frequency daily task) → quick photos / PR actions → "งานของฉัน" = the SA's
active work packages (WP-centric), each a 1-tap link to its detail (where the
labor/photo/PR tabs already live). Bottom tabs: หน้าหลัก / โครงการ / ตั้งค่า.

Build plan (one focused unit — touches the whole SA nav, several pinned tests):

- New `src/app/sa/page.tsx` — greeting + "งานของฉัน" (active WPs in the SA's member
  projects, RLS-scoped), each row → WP detail (+ per-row action deep-links to the WP
  tab via `hashTabMap`: รูปถ่าย / แรงงาน / คำขอซื้อ). The standalone hero/quick-action
  buttons need a global "pick a งาน" step — fold in once the row-actions land.
- `roleHome(site_admin)` → `/sa` (was `/projects`); update `role-home.test.ts` pin.
- `SA_TABS`: prepend หน้าหลัก (`/sa`), drop ภาพรวม (the home supersedes the SA
  dashboard); update `bottom-tab-bar.test.tsx` pin.
- `SA_HUB_NAV`: add the home; update `hub-nav.test.tsx` + the spec-153 `HUB_STRIP_ROUTES`.
- `nav-back-affordance.test.ts`: add `sa` to `NON_DETAIL_ROUTES` (a primary root, no
  back chip).
- Verify in preview (auth-gated — confirm SA lands on /sa, the WP list + deep-links work).
