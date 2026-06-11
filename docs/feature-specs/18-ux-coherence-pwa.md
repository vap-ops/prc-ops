# Spec 18 — UX coherence + PWA installability (iteration 5)

**Status:** Locked 2026-06-11 by the operator's chat brief ("revise
uxui") under the standing whole-app-upgrade mandate. Scope = the
iteration-5 queue items that need no further operator input, with the
two normalization questions from spec 17 decided here by design
judgment (recorded below). The palette/outdoor-theme remap and
`/pm/requests` progressive disclosure stay deferred (the former is an
operator-visible identity choice; the latter deserves its own pass).

## Problem

The PM's four destinations are discoverable only from `/pm` — the other
hub pages show 2 of 4 nav items in varying orders with arrow glyphs
pointing both ways; nav links are ~32 px tall (small for gloved site
hands). Two hub pages hide the โปรไฟล์ link for no recorded reason, and
hub containers split between two widths. Deleting a photo pops the
browser's native `confirm()` — English chrome with a raw origin string,
the single most "this is a website" moment in the app. And the app
cannot be installed to a home screen at all (no manifest, no icons):
the top recommendation from `docs/app-feel-options.md`.

## Scope

### A. Header normalization (decides spec 17's open question)

- Every `AppHeader` consumer shows the โปรไฟล์ link — the
  `showProfileLink` prop is **deleted** (the two hide-sites were
  historical drift, not design).
- Hub/list pages unify on **`max-w-2xl`** (single-column card lists
  read better narrow; phones are unaffected): `/pm`, `/pm/requests`,
  `/requests` move from 3xl; `/sa`, `/pm/projects`, reports already
  there. Each page's section containers move with the header. Detail
  screens (SA photo screen 2xl, PM review 3xl) are out of scope —
  different layouts, recorded as-is.

### B. `HubNav` — one consistent nav strip

> **Superseded in part by spec 19 §4 (2026-06-11):** `/pm/requests`
> merged into `/requests`; `PM_HUB_NAV` is now three items with a
> single purchasing entry, and the strip itself is desktop-only.

New `src/components/features/hub-nav.tsx`: same visual language as the
current strips (border-b zinc-800/60, bg zinc-900/30, text-xs; current
page = text-zinc-100 span, others = zinc-500→200 links) with two
deliberate changes: **no arrow glyphs** (tab semantics, not directions)
and **min-h-11 tap targets** (inline-flex items-center; container py-1).

Consumers and their item sets (current page rendered as the span):

- `/sa`: โครงการ · คำขอซื้อของฉัน (→ `/requests`)
- `/pm`, `/pm/projects`, `/pm/requests` — the SAME four items
  everywhere: รายการรอตรวจ (`/pm`) · โครงการและรายงาน (`/pm/projects`)
  · คำขอซื้อ (`/pm/requests`) · คำขอซื้อของฉัน (`/requests`)

NOT consumers: `/requests` (its back-bar is spec-12 locked behavior),
the reports page (project-detail back-nav: ← โครงการทั้งหมด +
รายการรอตรวจ links stay as-is), detail screens.

### C. `ConfirmDialog` — replaces `window.confirm`

New `src/components/features/confirm-dialog.tsx` (`'use client'`:
open state lives with the caller; the dialog owns Escape handling and
initial focus). Same overlay language as the photo lightbox
(fixed inset-0 z-50 bg-black/85). Props: `open`, `message`,
`confirmLabel`, `onConfirm`, `onCancel`; cancel button ยกเลิก; confirm
styled destructive (red family) — the only call site today is photo
removal. Behavior: backdrop click and Escape cancel; initial focus on
the cancel button; `role="dialog"` + `aria-modal`. Consumer:
`phase-uploader.tsx` — the × button opens the dialog
(message ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้, confirm ลบรูป);
`window.confirm` is deleted. Spec 16 P2's attachment removal will reuse
this component.

### D. PWA installability (per `docs/app-feel-options.md`)

- `src/app/manifest.ts` (typed `MetadataRoute.Manifest`): name/short
  name `PRC Ops`, Thai description (reuse layout metadata copy),
  `lang: "th"`, `start_url: "/"`, `display: "standalone"`,
  `background_color`/`theme_color` `#09090b` (zinc-950), icons 192 +
  512 (+ 512 maskable).
- Icons: generated placeholder mark (zinc-950 rounded square, "PRC"
  wordmark, emerald accent bar — **operator may replace with the real
  logo any time**; files are plain PNGs): `public/icon-192.png`,
  `public/icon-512.png`, `src/app/apple-icon.png` (180, auto-linked by
  Next).
- `export const viewport: Viewport = { themeColor: "#09090b" }` in
  `layout.tsx`.
- Minimal **network-only service worker** (`public/sw.js`: install →
  skipWaiting, activate → clients.claim, fetch → passthrough; NO
  caching — zero stale-content risk) + `src/components/features/
sw-register.tsx` (`'use client'`; registers `/sw.js` in production
  only), mounted in the root layout. Rationale: Android Chrome's
  install prompt still expects a SW fetch handler; iOS ignores it
  harmlessly.
- NOT in scope: offline support, Web Push, install-prompt UI, the Thai
  install guide page (goes with onboarding docs), LINE Mini App
  channel.

## Out of scope (recorded)

Palette/outdoor light theme (operator-visible identity choice);
`/pm/requests` progressive disclosure; row-link card extraction; toasts;
detail-screen width alignment; `?openExternalBrowser=1` link rewriting
(belongs to the LINE notification unit); real logo assets.

## Tests (failing first)

- NEW `tests/unit/hub-nav.test.tsx` — renders all items; current item
  is a span (not a link); others are links with correct hrefs; no
  arrow glyphs in the rendered text.
- NEW `tests/unit/confirm-dialog.test.tsx` — closed renders nothing;
  open shows message + buttons; confirm fires `onConfirm` once; cancel
  button, Escape, and backdrop click fire `onCancel` and not
  `onConfirm`; clicking the panel itself does not cancel.
- NEW `tests/unit/manifest.test.ts` — shape pins: Thai lang,
  standalone display, start_url `/`, theme/background `#09090b`, a
  512×512 icon and a maskable entry present, Thai description.
- UPDATE `tests/unit/app-shell-primitives.test.tsx` — the
  `showProfileLink` cases collapse to "profile link always renders"
  (breaks first by design when the prop is deleted).

Page wiring, icons, viewport, and the SW are presentational/config
surfaces verified by lint/typecheck/build/e2e + the checklist
(spec-15 posture).

## Verification checklist

- [ ] New tests RED before the modules exist, GREEN after; updated
      app-shell test breaks first on the prop deletion.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] `pnpm build` passes; `/manifest.webmanifest` route appears;
      apple-icon link tag emitted.
- [ ] `pnpm test:e2e` passes (login/landing untouched except the
      harmless SW register + viewport meta).
- [ ] Manifest + icons fetchable on the dev server; icons visually
      inspected.
- [ ] Locked behaviors intact: `/requests` back-bar (spec 12), pinned
      form modes (spec 10), grouping semantics (spec 11), Thai glossary
      (spec 14), fact lines (spec 15). No route/redirect/query change.
- [ ] No diff under `supabase/`, `worker/`.

## Recorded deltas (deliberate, user-visible)

1. โปรไฟล์ link appears on `/pm/projects` + reports (was absent).
2. `/pm`, `/pm/requests`, `/requests` containers narrow 3xl → 2xl.
3. Nav strips: consistent four-item PM set / two-item SA set
   everywhere, arrows dropped, taller tap targets.
4. Native browser confirm replaced by the themed Thai dialog.
5. The app is installable (manifest/icons/SW/theme-color) — new
   surfaces, no behavior change for non-installing users beyond the
   theme-color meta.
