# Spec 20 — Sun-readable redesign: light high-contrast theme + navigation identity (iteration 8)

**Operator brief (2026-06-11):** "UI is bland and hard to identify
anything, due to colors, contrasts, sizes. Redesign navigation as well.
Most users are on site, in the sun." This closes the
palette/outdoor-theme item carried since iteration 3 — the operator
input it was waiting for is this brief.

## 0. Why light wins in the sun (design rationale)

A phone screen outdoors competes with ~30,000–100,000 lux of ambient
light reflecting off the glass. Dark pixels emit nothing, so on a dark
theme the reflection IS the image — the screen becomes a mirror. Light
themes win because every white pixel emits at full panel brightness;
contrast survives as long as ink is near-black and meaningful color is
saturated. Consequences for this redesign:

- **Ground flips dark → light.** `bg-zinc-950` → `bg-white`; ink
  `text-zinc-100` → `text-zinc-900`. The shadcn `:root` tokens in
  `globals.css` are already light and stay untouched; the dark look
  lives entirely in literal zinc utility classes, which this spec
  sweeps. No `.dark` class is ever set — also untouched.
- **No mid-gray meaningful text.** Secondary text floor is `zinc-600`
  (≈7:1 on white). `zinc-400`/`zinc-500` survive only as decorations
  (dividers, disabled states, placeholder).
- **Status = solid saturated fills, not tinted translucency.** A pill
  must be identifiable at arm's length in glare by hue alone.
- **Bigger type, bigger targets.** Section headings and pills go up one
  step; inputs/buttons go `h-9` → `h-11`; chips/tabs hit the min-h-11
  gloved-hands convention (spec 18 precedent).
- **One action hue: blue-700.** Links, active nav, primary buttons,
  focus rings. Blue is the only hue family NOT used by a status slot
  (zinc/amber/emerald/red), so action never masquerades as status.
  Blue-700 on white = 6.82:1 (corrected during the adversarial pass —
  the original 8.6:1 figure was a Tailwind-v3-era value; 6.82 passes AA
  and is the recorded trade-off: a 7:1+ blue is too dark to read as a
  hue. Solid fills get `focus-visible:ring-offset-2` so the focus ring
  is separated from same-hue fills by a white gap.)
- **Force-dark opt-out:** `html { color-scheme: light; }` in
  `globals.css` — without it Chrome Android's "also darken websites"
  intervention can auto-invert the white app back to dark.

## 1. Shared primitives

### 1a. `src/lib/status-colors.ts` — the five palette slots (semantics unchanged)

| Slot         | Old (dark translucent)                                     | New (solid, sun-rated)                         |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| PILL_ZINC    | `border-zinc-700 bg-zinc-800 text-zinc-300`                | `border-zinc-400 bg-zinc-200 text-zinc-900`    |
| PILL_AMBER   | `border-amber-900/60 bg-amber-950/40 text-amber-200`       | `border-amber-600 bg-amber-400 text-zinc-950`  |
| PILL_EMERALD | `border-emerald-900/60 bg-emerald-950/40 text-emerald-200` | `border-emerald-800 bg-emerald-700 text-white` |
| PILL_RED     | `border-red-900/60 bg-red-950/40 text-red-200`             | `border-red-700 bg-red-600 text-white`         |
| PILL_MUTED   | `border-zinc-800 bg-zinc-900 text-zinc-500`                | `border-zinc-300 bg-zinc-100 text-zinc-600`    |

Amber keeps dark text (white-on-amber fails contrast); emerald/red
carry white text. Every status→slot mapping is byte-identical — this
is a palette swap, not a re-mapping.

> **Amendments (adversarial pass, 2026-06-11):** emerald fill is 700,
> not 600 — white-on-emerald-600 is 3.67:1 (AA fail), 700 gives 5.37:1;
> PILL_MUTED text is zinc-600, not zinc-500 — 4.39:1 on zinc-100 broke
> §0's own floor for meaningful text. And the claim that pm/page.tsx,
> reports-list.tsx, and the PM review page carry "local pill literals"
> was FALSE — all three already consume the shared helpers; no local
> literals existed.

### 1b. `StatusPill` geometry

`px-2.5 py-0.5 text-xs font-medium` → `px-3 py-1 text-sm font-semibold`.
Rounded-full + shrink-0 stay.

### 1c. Notices

- `ErrorNotice`: `border-red-900/60 bg-red-950/40 text-red-200` →
  `border-red-600 bg-red-50 font-medium text-red-900`.
- `EmptyNotice`: `border-zinc-800 bg-zinc-900/50 text-zinc-400` →
  `border-zinc-300 bg-zinc-50 text-zinc-600`.

### 1d. `ConfirmDialog` + `PhotoLightbox` — the two recorded dark exceptions

Modal/lightbox **scrims stay dark** (a scrim's job is to kill the page
behind it; the lightbox views photos, where a dark surround is correct
even in sun). The ConfirmDialog **panel** flips light: white panel,
`border-zinc-300`, ink text, buttons per §3 recipes. Lightbox chrome
(close affordance etc.) keeps its dark-surface styling.

### 1e. `page-skeleton.tsx`

Shimmer blocks `zinc-900`-family → `zinc-200` on white ground; width
stays as-is (the 2xl one-liner remains its own queued follow-up).

## 2. Navigation redesign

### 2a. `BottomTabBar` (phones — the primary nav)

- Bar: `border-t border-zinc-800 bg-zinc-950/95` → `border-t
border-zinc-300 bg-white/95` + a top shadow
  (`shadow-[0_-1px_3px_rgba(0,0,0,0.1)]`); `backdrop-blur`, h-16,
  safe-area padding, `sm:hidden`, longest-prefix active rule, and
  `aria-current="page"` all unchanged.
- Active tab: `text-blue-700`, icon `size-6`, label `text-xs
font-bold`, plus a visible **top indicator bar** — `<span aria-hidden
className="absolute inset-x-4 top-0 h-1 rounded-b-full bg-blue-700"
/>` inside the (now `relative`) tab. Replaces the emerald icon tint
  as the active signal.
- Inactive tabs: `text-zinc-600 hover:text-zinc-900
focus-visible:text-zinc-900`, icon `size-6`, label `text-xs
font-medium` (up from text-[11px]/size-5).

### 2b. `HubNav` (desktop strip)

- Strip: `border-b border-zinc-800/60 bg-zinc-900/30` → `border-b
border-zinc-300 bg-zinc-100`; `text-xs` → `text-sm`; gap-x-4 →
  gap-x-6.
- Current page: `border-b-2 border-blue-700 font-semibold
text-zinc-900` (span, min-h-11 — unchanged semantics).
- Links: `border-b-2 border-transparent text-zinc-600
hover:text-zinc-900` (border keeps baselines aligned).
- Item sets `PM_HUB_NAV`/`SA_HUB_NAV` byte-unchanged (test-pinned).

### 2c. `AppHeader`

- Header: `border-b border-zinc-800` → `border-b border-zinc-300
bg-white`.
- Kicker: `text-zinc-500` → `font-semibold text-blue-700` (same
  text-xs uppercase tracking — the one brand moment per page).
- Heading: `text-lg` → `text-xl` (font-semibold tracking-tight stay).
- โปรไฟล์ desktop link: `text-zinc-400 hover:text-zinc-100` →
  `font-medium text-blue-700 hover:underline`.

## 3. Page-sweep conversion recipes

Applied mechanically across every file in §5; any judgment call outside
these recipes must be recorded in the tracker.

| Surface                | Old                                                                                                           | New                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Page ground            | `bg-zinc-950 text-zinc-100`                                                                                   | `bg-white text-zinc-900`                                                                                  |
| Card / list row        | `border-zinc-800 bg-zinc-900/60` (+`hover:bg-zinc-900`)                                                       | `border-zinc-300 bg-white shadow-sm` (+`hover:bg-zinc-50`)                                                |
| Section heading        | `text-sm font-medium text-zinc-400`                                                                           | `text-base font-semibold text-zinc-900`                                                                   |
| Secondary/meta text    | `text-zinc-400` / `text-zinc-500`                                                                             | `text-zinc-600`                                                                                           |
| Tertiary content text  | `text-zinc-300` / `text-zinc-200`                                                                             | `text-zinc-700` / `text-zinc-900`                                                                         |
| Divider glyphs (·)     | `text-zinc-700`                                                                                               | `text-zinc-400`                                                                                           |
| Mono codes             | `text-zinc-500`                                                                                               | `text-zinc-600`                                                                                           |
| Input                  | `h-9 border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500` (+`[color-scheme:dark]` on date) | `h-11 border-zinc-400 bg-white text-zinc-900 placeholder:text-zinc-400` (drop color-scheme)               |
| Field label            | `text-zinc-200`                                                                                               | `text-zinc-900`                                                                                           |
| Primary button         | inverted-zinc variants                                                                                        | `h-11 bg-blue-700 font-semibold text-white hover:bg-blue-800 disabled:bg-zinc-300 disabled:text-zinc-500` |
| Destructive button     | red dark variants                                                                                             | `bg-red-600 font-semibold text-white hover:bg-red-700`                                                    |
| Secondary/ghost button | zinc dark variants                                                                                            | `border border-zinc-400 bg-white text-zinc-900 hover:bg-zinc-50`                                          |
| Inline link            | `text-zinc-400 underline`-ish                                                                                 | `font-medium text-blue-700 underline`                                                                     |
| Focus ring             | `focus-visible:ring-2 focus-visible:ring-zinc-500`                                                            | `focus-visible:ring-2 focus-visible:ring-blue-700`                                                        |
| Filter chip (active)   | `border-zinc-600 bg-zinc-800 text-zinc-100`                                                                   | `border-blue-700 bg-blue-700 font-semibold text-white`                                                    |
| Filter chip (inactive) | `border-zinc-800 bg-zinc-900/60 text-zinc-500`                                                                | `border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-50`                                                 |
| Chip/tap minimums      | `min-h-8`…`min-h-10`                                                                                          | `min-h-11`                                                                                                |
| Rejection/info inset   | `border-red-900/60 bg-red-950/30`, `text-red-200/300`                                                         | `border-red-300 bg-red-50`, `text-red-900/800`                                                            |
| LINE login button      | brand `#06C755`                                                                                               | unchanged (LINE brand guideline)                                                                          |

## 4. PWA chrome

`viewport.themeColor` and manifest `background_color`/`theme_color`:
`#09090b` → `#ffffff`; comments updated. Icons (placeholder PNGs),
`sw.js`, registration: unchanged — the real logo stays queued.

## 5. File sweep (every src file carrying zinc classes)

Primitives/nav per §1–2: `status-colors.ts`, `status-pill.tsx`,
`notices.tsx`, `confirm-dialog.tsx`, `photo-lightbox.tsx` (scrim
exception), `page-skeleton.tsx`, `bottom-tab-bar.tsx`, `hub-nav.tsx`,
`app-header.tsx`, `avatar-surface.tsx`, `logout-button.tsx`.
Pages/forms per §3: `app/page.tsx`, `login/*`, `coming-soon`,
`profile`, `not-found`, `error.tsx`, `sa/page.tsx`,
`sa/projects/[projectId]/*` (incl. `work-package-list.tsx`,
WP detail + `phase-uploader.tsx`), `pm/page.tsx`, `pm/projects/*`
(incl. `reports/*`), `pm/work-packages/[workPackageId]/*` (incl.
`record-decision-form.tsx`), `requests/page.tsx`,
`purchase-request-form.tsx`, `purchase-request-decision.tsx`,
`display-name-form.tsx`, `layout.tsx` + `manifest.ts` (§4).

## 6. Out of scope

Dark/night-shift toggle (recorded option — tokens make it cheap later);
real logo/icons; per-status card edge accents; /requests progressive
disclosure; information-architecture changes (routes, labels, item
sets, orderings all byte-unchanged); copy changes of any kind.

## 7. Tests (failing-first where testable)

- **UPDATE-test (RED first):** `status-colors.test.ts` gains exact-slot
  pins for the new palette — e.g. critical → contains `bg-red-600` AND
  `text-white`; urgent → `bg-amber-400` + `text-zinc-950`; delivered →
  `bg-emerald-600`. These fail against the dark palette by design.
- **UPDATE-test (RED first):** `bottom-tab-bar.test.tsx` — active tab
  renders the `bg-blue-700` indicator element and `size-6` icons; the
  existing aria-current/longest-prefix pins stay untouched and must
  stay green.
- Existing pins that must NOT change: hub-nav `toEqual` sets, tab
  sets/hrefs, i18n label maps, all behavioral tests.
- Page-level class sweeps are verified by checklist (the §7 posture
  spec 16 established): lint/typecheck/build/e2e + the §8 greps.

## 8. Verification checklist

- [ ] New palette/indicator pins RED → GREEN; suite green throughout.
- [ ] `grep -r "zinc-950\|zinc-900\|zinc-800\|zinc-100\b" src/` → only
      the two recorded scrim exceptions (confirm-dialog overlay,
      photo-lightbox) and `text-zinc-950` on amber fills remain.
- [ ] `grep -r "text-zinc-300\|text-zinc-400\|text-zinc-500" src/` →
      survivors are decorations only (placeholders, disabled, dividers,
      PILL_MUTED) — each survivor individually justified.
- [ ] No route, redirect, label, item-set, ordering, or copy change
      (`git diff` shows class/comment churn only outside the named
      structural edits).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + `pnpm build` +
      `pnpm test:e2e` green. No diff under `supabase/` or `worker/`.
- [ ] Manifest serves `#ffffff` theme/background; viewport themeColor
      white.
- [ ] 3-lens adversarial pass over the diff (UX/locked-behavior,
      contrast/a11y, discipline) recorded in the tracker.
- [ ] Operator visual pass on a phone outdoors — the real acceptance
      test; queued as the post-deploy step.
