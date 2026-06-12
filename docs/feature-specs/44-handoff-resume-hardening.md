# Spec 44 — Handoff resume hardening (iOS process death)

**Status:** shipped — 2026-06-12 (operator iPhone re-test =
acceptance). Operator (first spec-43 field
test): "login session is not carried to home-screen app, login
successful on browser only." The handoff row reached `approved` (the
browser showed the success page); the PWA never claimed it.

## Diagnosis

iOS kills the backgrounded standalone PWA while the user is off in
LINE/Safari. Two spec-43 client assumptions break:

1. **`sessionStorage` does not survive process death.** Relaunch =
   new session = the stored `device_code` is gone → no resume, no
   poll, idle button. This is the observed failure.
2. **`window.open` after two `await`s** (fetch + json) can fall
   outside iOS's transient user activation and be silently blocked.
   Didn't bite this run (LINE did open) but is the same class of
   fragility.

Server side needs no change — the row sits `approved` for its full
10-minute TTL precisely so a late claimer can still collect.

## Scope (client-only, `standalone-login-button.tsx` + its tests)

1. **localStorage with an expiry stamp** replaces sessionStorage:
   `line_handoff_device_code` + `line_handoff_expires_at`
   (now + 600 s, matching the server TTL). Resume treats a missing or
   stale stamp as "nothing stored" (silent idle, never an error
   banner); stale keys are cleared by the next start/cancel/fail —
   never inside the `useSyncExternalStore` snapshot (no side effects
   in render).
2. **Synchronous popup**: `window.open("", "_blank")` runs in the tap
   gesture before any await; `opener` nulled; after the start POST the
   popup is navigated to the authorize URL. If the popup was blocked
   (`null`), fall back to same-window navigation — recoverable now
   because the device_code persists across the excursion.
3. Failure path closes the orphan popup.

## Out of scope

Server/routes/DB — untouched. Poll cadence unchanged.

## Verification checklist

- [x] Unit (named updates): storage assertions move to localStorage +
      expiry key; popup contract (synchronous open, navigated after
      start, closed on start failure, fallback navigate when blocked);
      resume from stored unexpired code; stale stamp → idle, storage
      ignored.
- [x] `pnpm lint && pnpm typecheck && pnpm test` (398 unit); auth e2e
      8/8 chromium.
- [ ] Operator: repeat the iPhone pass — logout → login → LINE one
      tap → return to home-screen app (even if iOS reloaded it) →
      signed in.
