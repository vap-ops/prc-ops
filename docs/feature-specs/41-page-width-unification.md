# Spec 41 — Page width unification

**Status:** shipped — 2026-06-12. Operator: "make sure the width of all
the pages are of the same size."

One canonical token, `PAGE_MAX_W` in `src/lib/ui/page-width.ts`
(`max-w-2xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl` — the WP-detail
scale), used by every content page's header strip, nav strip, and
content container. `AppHeader`/`HubNav` accept ONLY
`typeof PAGE_MAX_W`, so a page cannot drift to a private width again
(the type system is the enforcement). Named UPDATE-tests: the two
component tests that pinned the old literal prop values now pass the
constant.

**Recorded exceptions:** `/login`, `/profile`, `/coming-soon` —
single-card form screens, deliberately `max-w-md`.

Verification: 362 unit / 27 e2e green; zero non-canonical `max-w-*`
page containers remain outside the recorded exceptions.
