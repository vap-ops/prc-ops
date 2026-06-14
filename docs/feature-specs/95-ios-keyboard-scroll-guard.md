# Spec 95 — iOS keyboard repaint guard (the spec-64 "next suspect")

## Problem

Operator (2026-06-15, with screenshot on the WP detail page): _"whenever user
finished typing something and lower down keyboard, a part of screen will go
missing, and cannot scroll to top."_

The body is **locked** (spec 64: `<body class="h-full overflow-hidden">`, and
`PageShell`'s `<main>` is the only scroller). On iOS standalone PWA, when the
software keyboard closes, WebKit resizes the viewport back but does **not repaint
the locked scroller** — the content (the sticky `DetailHeader` included) is present
but blank until something forces a repaint.

Diagnosis was confirmed with the operator (round 2, AskUserQuestion): the screen
**recovers on its own the moment you scroll**, and a **รีเฟรช also clears it**. So
this is a missing-repaint glitch, **not** a stuck scroll position. (Round 1 shipped
a document-scroll reset on the wrong hypothesis — it didn't help, because the
scroll position was never the problem.)

Spec 64 predicted this — it shipped the body-lock to kill iOS rubber-band drift
and recorded _"keyboard case = next suspect."_

## Decision

Add a tiny client guard, `ViewportScrollGuard`, mounted once in the root layout
(next to `UploadQueueRunner`). When the keyboard closes, it reproduces the exact
scroll that currently recovers the screen for the user — a **1px nudge and back**
on the `<main>` scroller — forcing the repaint before the blank frame is ever
seen. Position-preserving; the user keeps their place.

- **Triggers:** `window.visualViewport` `resize` (fires when the keyboard slides
  away → viewport back to ~full height) as the primary signal; a document
  `focusout` as a fallback for environments without `visualViewport`.
- **Guard:** if focus is still on an editable element (the user tabbed
  field-to-field, keyboard still up), do nothing — the caret-reveal scroll is
  iOS's job then.
- **Action:** `scroller.scrollBy(0, 1)`, then `scrollBy(0, -1)` on the next
  animation frame. Net scroll position unchanged; a repaint is forced. Inert in
  every non-keyboard state.

No change to the spec-64 body-lock or `PageShell` (proven; low blast radius).

## Scope (exactly this)

1. `src/components/features/viewport-scroll-guard.tsx` — new `"use client"`
   component as above; renders `null`.
2. `src/app/layout.tsx` — mount `<ViewportScrollGuard />` inside `<body>`.
3. `tests/unit/viewport-scroll-guard.test.tsx` — (a) after an input `focusout`
   with no active editable, the scroller is nudged (`scrollBy(0, 1)`); (b) while
   another field is focused, it is NOT nudged.

## Out of scope

- The body-lock / PageShell architecture (spec 64) — unchanged.
- `interactive-widget` viewport hints — iOS Safari doesn't honour them yet.
- Any per-field scroll-into-view tuning.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; the new test passes.
- [ ] `pnpm build` green.
- [ ] Acceptance = **operator iPhone**: open a form on the WP page, type, dismiss
      the keyboard → the screen repaints immediately, no blank band, header
      present, scroll works. (PWA: fully close/reopen or tap รีเฟรช after deploy.)
