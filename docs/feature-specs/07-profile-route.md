# Feature Spec 07: /profile route (universal display-name reach)

## Status

Locked — 2026-06-07. Extends feature spec 05 / ADR 0017. **No new ADR** — reuses the
public.update_my_display_name SECURITY DEFINER RPC and the existing server action,
validator, and DisplayNameForm component unchanged.

## Goal

Make display-name editing reachable by EVERY authenticated role via a canonical
`/profile` route, closing spec 05's open question (site_admin / project_manager are
redirected off /coming-soon before they can reach the inline panel).

## Locked decisions

1. New route `/profile` (Server Component) reachable by ANY authenticated user,
   including `visitor`. It does NOT use requireRole's allow-list redirect (that bounces
   unserved roles to roleHome). Auth pattern mirrors coming-soon/page.tsx: getUser() →
   redirect('/login') if none; read the user's `users` row (role, full_name) →
   redirect('/login') if missing; render.
2. The page renders the EXISTING `DisplayNameForm` (initialName = current full_name ?? "")
   plus a "← Back" link to `roleHome(role)`. No new form, action, validator, or RPC.
3. Discoverability: add a link to `/profile` from /sa, /pm, and the super_admin operator
   hub on /coming-soon. Minimal, matching existing styling.
4. /coming-soon's inline panel stays as-is (visitors keep inline edit; no regression).

## Scope — OUT (surface, don't build)

- avatar_url / any new profile field; any change to the RPC / action / validator /
  DisplayNameForm; any role-gating change; replacing the /coming-soon inline panel.

## TDD (test first)

- tests/e2e/profile-unauthenticated.spec.ts — mirror tests/e2e/auth-unauthenticated.spec.ts:
  an unauthenticated GET /profile redirects to /login. (Authenticated paths use LINE and
  are covered by the live checks below.)

## Verification

- pnpm lint / typecheck / test → green (reuses tested helpers; no new pure logic).
- pnpm test:e2e → the new redirect spec passes.
- NO migration → no db push, no db:test needed for this unit.
- Live (each role): visitor, site_admin, project_manager, super_admin can each open
  /profile, edit the name, see "Saved", reload → persists; the "Back" link returns to the
  role's home. Confirm SA/PM (the unit's whole point) can now reach it via the new link.

## If blocked

when-blocked report + confidence %. The RPC/action are unchanged and already verified —
this unit is routing + discoverability only.
