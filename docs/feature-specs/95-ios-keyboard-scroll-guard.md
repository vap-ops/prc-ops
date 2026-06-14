# Spec 95 — iOS keyboard scroll guard (the spec-64 "next suspect")

## Problem

Operator (2026-06-15, with screenshot on the WP detail page): _"whenever user
finished typing something and lower down keyboard, a part of screen will go
missing, and cannot scroll to top."_

The body is **locked** (spec 64: `<body class="h-full overflow-hidden">`, and
`PageShell` is the only scroller). On iOS standalone PWA, when the software
keyboard opens, WebKit scrolls the **locked document** to bring the caret above
the keyboard. Because the document can't be touch-scrolled back (overflow hidden),
the offset **persists after the keyboard closes**: the sticky `DetailHeader` is
pushed off the top, a blank band appears (most visible on the WP page, above the
fixed amber capture bar), and there's no way to scroll back to the top.

Spec 64 already predicted this — it shipped the body-lock to kill iOS rubber-band
drift and recorded _"if the symptom persists ask for exact repro (keyboard case =
next suspect)."_ This is that case.

## Decision

Add a tiny client guard, `ViewportScrollGuard`, mounted once in the root layout
(next to `UploadQueueRunner`). When the keyboard closes, it snaps the **document**
scroll back to 0 — leaving `PageShell`'s scroll (the user's real content position)
untouched, so the header returns and the blank band disappears without losing
their place.

- **Triggers:** `window.visualViewport` `resize` (fires when the keyboard slides
  away → viewport returns to ~full height) as the primary signal; a document
  `focusout` as a fallback for environments without `visualViewport`.
- **Guard:** if focus is still on an editable element (the user tabbed
  field-to-field, keyboard still up), do nothing — never yank a live edit.
- **Action:** `document.documentElement.scrollTop = 0`, `document.body.scrollTop =
0`, `window.scrollTo(0, 0)`. In every non-keyboard state these are no-ops (the
  locked document is always at 0), so the guard is inert except when correcting
  the iOS-introduced offset.

No change to the spec-64 body-lock or `PageShell` (proven; low blast radius).

## Scope (exactly this)

1. `src/components/features/viewport-scroll-guard.tsx` — new `"use client"`
   component as above; renders `null`.
2. `src/app/layout.tsx` — mount `<ViewportScrollGuard />` inside `<body>`.
3. `tests/unit/viewport-scroll-guard.test.tsx` — (a) after an input `focusout`
   with no active editable, the document scroll is reset (`window.scrollTo`
   called); (b) while another field is focused, it is NOT reset.

## Out of scope

- The body-lock / PageShell architecture (spec 64) — unchanged.
- `interactive-widget` viewport hints — iOS Safari doesn't honour them yet, so
  they wouldn't fix this; not used.
- Any per-field scroll-into-view tuning.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; the new test passes.
- [ ] `pnpm build` green.
- [ ] Acceptance = **operator iPhone**: open a form on the WP page, type, dismiss
      the keyboard → the header is back, no blank band, page scrolls to the top
      normally. (PWA: fully close/reopen or tap รีเฟรช after deploy.)
