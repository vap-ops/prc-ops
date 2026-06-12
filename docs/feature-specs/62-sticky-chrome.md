# Spec 62 — headers pinned while scrolling

**Status:** complete (2026-06-13) — operator scroll-test on deploy = acceptance
**Date:** 2026-06-13
**Origin:** operator 2026-06-13: "headers and footers are not fixed in
place."

## Audit

- Footer (BottomTabBar) is already `fixed inset-x-0 bottom-0 z-40` on
  every content page (spec 19) — verified present on all surfaces with
  the matching `pb-20` clearance.
- Headers are static — they scroll away. That is the defect.

## Scope (class-only)

Every page header gains `sticky top-0 z-20` (opaque backgrounds and
border-b already present):

- `AppHeader` (hub pages) — plus a pin in the app-shell test.
- The six bespoke detail headers: SA project WP list, SA WP detail,
  PM WP detail, request detail, project settings, reports.

z-stack (recorded): headers 20 < queue banner 30 < tab bar 40 <
dialog/lightbox scrims 50 — chrome never covers an overlay.

NOT sticky (recorded): the WP-detail phase-progress band and the
attention stack scroll with content — pinning the full WP header block
would eat ~a third of a phone viewport; the identity row is what needs
to stay.

## Tests

Class-only restyle (spec-40 precedent); one new AppHeader sticky pin in
`tests/unit/app-shell-primitives.test.tsx`.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator: scroll any long page — header stays up top, tab bar stays
   down bottom, lightbox/dialogs still cover everything.
