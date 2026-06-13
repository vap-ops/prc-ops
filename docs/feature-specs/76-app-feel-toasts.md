# Spec 76 — App-feel slice 1: toast / snackbar system

**Status:** COMPLETE (2026-06-13; no DB change; acceptance = operator eyeball on the live deploy).
**Program:** the "make prc-ops feel like a native app" round (memory `app-feel-roadmap`). Designed by
an audit+design multi-agent pass; the implementation was adversarially reviewed (3 lenses) before ship.

## Why

The single biggest "web, not app" tell: ~10 surfaces hand-rolled a transient `บันทึกแล้ว` span that
vanished on the next keystroke and was invisible after `router.refresh()` repainted. A toast system
replaces that with a real success channel and becomes the feedback primitive later app-feel slices
reuse. (Verified facts shaped the round: `navigator.vibrate` is a no-op on iOS PWA → no haptics;
Next 16.2 View Transitions are experimental/"not for production" → motion is CSS-only, last.)

## What shipped

- **`src/lib/ui/use-toast.ts`** — `useToast()` + context + types. Outside a provider returns a NO-OP
  API (never throws), so any client component can fire toasts and degrade safely.
- **`src/components/features/toast-provider.tsx`** — provider + viewport, mounted in the root layout
  **wrapping `{children}`** so a toast fired right before `router.refresh()` survives the RSC re-render.
  - **a11y (review-driven):** two PERSISTENT sr-only live regions are the announce channel — a polite
    `role=status` for success, an assertive `role=alert` for errors — present on first paint and gaining
    a keyed child per toast (so iOS VoiceOver reliably speaks them; a region inserted already-containing
    its text is the classic silent-failure case). The visible pills are presentational.
  - **errors persist** (no auto-dismiss; WCAG 2.2.1) — success auto-dismisses (4s). Stack capped at 3.
  - timer cleanup on unmount; dropped-item timers cleared; full-contrast dismiss icon (44px button).
- **`globals.css`** — `@keyframes toast-in` gated by `prefers-reduced-motion: no-preference` (opt-in;
  reduced-motion users get instant). **`classes.ts`** — `TOAST_SUCCESS` (emerald — doctrine positive
  hue, never green) + `TOAST_ERROR`, both pinned in `ui-classes-spec65.test`.
- **Adoption:** `display-name-form`, `settings-form`, `notes-field` (the last fans out to all 5 notes
  surfaces) — success → `toast.success("บันทึกแล้ว")`; the inline `บันทึกแล้ว` span removed. **Errors
  stay inline** (field-anchored, persist until fixed) — the deliberate split.

## Tests

`toast-provider.test.tsx` (8: announce regions, fromResult, success auto-dismiss, error-persists,
manual dismiss, stack cap, no-op-outside-provider). `notes-field`/`display-name-form` assert
`toast.success` fires + no inline span; error path stays inline. 634 unit / lint / typecheck / build.

## Recorded seams (review findings deferred, not bugs)

- Whether whole-action failures should toast (vs the current inline) — a design call; kept inline.
- `toast.success` fires inside `useTransition`, so its paint can trail a slow `router.refresh()` —
  perceived latency only; verify on-device before restructuring.
- toast vs the expandable offline-queue banner can sit close on a small phone — polish later.
- `purchase-request-form` still uses an inline `บันทึกแล้ว` span — a later adoption wave.

## Next app-feel slices (memory `app-feel-roadmap`)

2 press/active feedback · 3 optimistic UI (kill the 37 `router.refresh` flickers) · 4 bottom sheets ·
5 motion (CSS list-enter; route View Transitions only as a guarded spike).
