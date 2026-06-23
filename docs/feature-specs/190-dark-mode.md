# Spec 190 — Dark mode (opt-in night theme)

**Status:** U1 shipped 2026-06-24. Operator asked "how hard is dark mode in
settings?"; the answer was "architecturally ~90% primed — the design system is
100% token-based (enforced by the design-doctrine + ui-classes tests), colors are
OKLCH (Lightness inverts cleanly), and `@custom-variant dark` was already
declared." Operator chose **default light + opt-in toggle** (option 1) — honoring
the spec-20 sun-first rationale (light is more readable in direct sun, the field
capture case); dark serves the indoor/PM/back-office/portal/night audience.

## Design

- **Tri-state setting** `light | dark | system`, stored in a year-long `theme`
  cookie (the single source of truth — readable server-side for the no-flash
  initial class, and client-side by the toggle + the pre-paint script). Default
  (no cookie) = **light**.
- **No flash:** the root layout reads the cookie server-side and sets `class="dark"`
  - `color-scheme` on `<html>` for an explicit-dark user before first paint. The
    `system` case (the server has no OS signal) is resolved by a tiny synchronous
    pre-paint `ThemeScript` in `<body>`. `suppressHydrationWarning` on `<html>`
    absorbs the class the server couldn't predict for `system` users.
- **The flip is pure CSS tokens.** A `.dark {}` block in `globals.css` overrides
  every `--color-*` (and the shadcn `--card`/`--border`/… primitives) with a dark
  value — hue preserved, Lightness inverted, the WCAG floors from the light block
  held against the dark surface. Components are untouched (they consume
  `bg-card` / `text-ink` / `bg-attn` …).
- **Toggle** on `/settings` (`การแสดงผล`, every role): a 3-way segmented control
  (สว่าง / มืด / ระบบ), 44px tap targets, `aria-pressed`. On `ระบบ` it tracks the
  OS preference live via `matchMedia`.

## Units

- **U1 (shipped):** the mechanism (`lib/ui/theme.ts` pure resolver + cookie/DOM
  helpers, `theme-script.tsx`, `theme-toggle.tsx`), the full `.dark` palette, the
  layout + settings wiring. Verified: light + dark render correctly via SSR
  cookie (preview screenshots); `pnpm lint/typecheck/test` green. Tests:
  `theme.test.ts` (resolver/parse), `theme-toggle.test.tsx` (segmented control).
- **U2 (next, polish):** screen-by-screen audit on authenticated surfaces (cards,
  the `*-soft` status grounds, the brand band, sun-mode chrome), shadow/elevation
  tuning for dark, and the PWA status-bar `themeColor` per theme. U1 ships a
  correct, contrast-checked palette; U2 is the on-real-screens refinement pass.

## Notes

- Dark is **worse** than light in direct sun (the field photo-capture flow) — hence
  default-light. This is a preference feature, not an adoption-mover.
- No DB. No new route. New components live in the existing `features/chrome/`
  domain (no spec-122 folder change). No raw color literals (palette is CSS).
