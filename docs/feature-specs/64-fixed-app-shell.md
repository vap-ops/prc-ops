# Spec 64 — fixed app shell: chrome that cannot drift

**Status:** complete (2026-06-13) — operator phone re-test = acceptance
**Date:** 2026-06-13
**Origin:** operator 2026-06-13 after spec 62: "header and footer sticky
is not working properly."

## Diagnosis

Spec 62's `sticky`/`fixed` are structurally correct (no overflow or
transform ancestors — audited), but they ride the BODY scroller. On iOS
— especially the installed PWA — body scrolling rubber-bands: during
the bounce the sticky header visibly slides and the fixed tab bar can
detach. "Works in DevTools, drifts in the field."

## Fix — the canonical PWA app shell

Lock the body; scroll INSIDE a dedicated container:

1. Root layout: `body` → `h-full overflow-hidden` (html already
   `h-full`). The body never scrolls, so nothing it anchors can bounce.
2. New `PageShell` feature component (the spec-63 consolidation rule —
   one shell, every page): `<main>` with
   `h-full overflow-y-auto overscroll-y-contain text-zinc-900` plus a
   variant:
   - `app` (default) — `bg-zinc-50 pb-20 sm:pb-0` (the 10 content
     pages; tab-bar clearance unchanged).
   - `card` — `flex items-center justify-center bg-white px-6`
     (login, /, error, not-found, coming-soon's centered branch).
   - `bare` — caller supplies the rest (profile, coming-soon's hub
     branch — their padding/bg combinations conflict with `app`'s).
     `className` appends page extras; variants avoid Tailwind
     conflicting-utility ambiguity.
3. All 18 `<main>` elements across routes swap to `PageShell`.
   Sticky headers now stick to the inner scroller (crisp on iOS);
   `fixed` tab bar/queue banner/scrims anchor the locked viewport —
   drift is impossible by construction.

## Notes

- `overscroll-y-contain` stops scroll chaining out of the shell.
- Dialog/lightbox/tab-bar `fixed` overlays: unchanged behavior (no
  transformed ancestors introduced).
- Anchor scrolls (`#wp-requests`) target the inner scroller — works.
- ui-conventions.md §5 page anatomy updated: pages render `PageShell`,
  hand-rolled `<main>` is a review reject.
- Honest caveat for the operator: this is the canonical fix for
  bounce-drift; if his symptom was something else (e.g. keyboard
  overlap), the re-test will tell us and the shell is the right
  foundation either way.

## Tests (failing first)

- `tests/unit/page-shell.test.tsx` — renders `<main>` with the
  scroller classes; variant class sets; className appends; children
  render.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green; prod build green.
2. Operator phone pass: scroll + overscroll any long page — header and
   tab bar stay planted, including during the bounce.
