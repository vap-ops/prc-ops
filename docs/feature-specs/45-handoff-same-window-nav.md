# Spec 45 — Handoff opens LINE in the same window (no popup)

**Status:** shipped — 2026-06-12 (operator iPhone re-test =
acceptance). Operator (spec-44 field test):
"once redirected, home app appears all white, I assume it tried to
open up a new tab, so url is blanked out."

## Diagnosis

iOS standalone PWAs have no tab model. Spec 44's synchronous
`window.open("", "_blank")` makes iOS replace the visible view with an
`about:blank` context — the observed white screen — and the later
`popup.location.href = authorize_url` never reaches the user. The
popup pattern is simply wrong inside a standalone PWA.

## Scope (client-only, `standalone-login-button.tsx` + tests)

Remove the popup path entirely. Tap → start POST → store the
device_code (spec 44 localStorage + expiry) → **same-window**
navigation to the authorize URL. No transient-activation concern
(same-window navigation needs none), no blank context.

Return trip is what spec 44 already built: whether iOS resumes the PWA
(user closes the out-of-scope LINE view via its top bar) or relaunches
it cold at start_url, any page rendering LoginButton resumes the poll
from localStorage and signs the user in.

Named test updates: popup-contract tests die; tap now asserts
store-then-navigate(authorize_url). Resume / stale-stamp / expired /
cancel pins unchanged.

## Out of scope

Server/routes/DB — untouched (third client round on the same ADR 0041
flow).

## Verification checklist

- [x] Unit: tap → start POST, localStorage code + expiry stamp, then
      navigate(authorize_url); start failure → error state, nothing
      stored leftover-active; window.open pinned NEVER called.
- [x] Unit: resume / stale-stamp / expired / cancel pins green. Bonus
      real bug caught by the cancel pin: cancel from a RESUMED waiting
      state changed no React state, so the snapshot never re-read —
      storage mutations now notify useSyncExternalStore subscribers.
- [x] `pnpm lint && pnpm typecheck && pnpm test` (397 unit); auth e2e
      8/8 chromium.
- [ ] Operator: iPhone re-test — tap login → LINE (no white screen) →
      one tap → return to home app → auto signed in.
