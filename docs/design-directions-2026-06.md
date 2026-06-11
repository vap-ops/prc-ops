# Design directions — June 2026 (the "looks generated" fix)

**Status:** proposal — operator picks a direction (ก/ข/ค) from
`/design-preview` on a phone, ideally outdoors. The pick becomes
spec 38 (systematic re-skin). Doc-only; nothing here restyles the app
yet.

## Diagnosis (why it reads as an old/generated app)

1. **Border-everything, depth-nothing** — every block is the same
   `1px zinc border + rounded-md` rectangle on a flat white page. No
   elevation, no figure/ground separation.
2. **One card treatment for every content type** — a photo tile, a
   purchase request, a form, and a notice all look like the same gray
   box; hierarchy exists only in font size.
3. **Default-looking controls** — native selects, plain bordered
   inputs, buttons that are filled rectangles with no pressed/hover
   depth.
4. **No brand** — placeholder icon, no wordmark; the only identity is
   "links are blue."
5. **Uniform cramped spacing** — no rhythm; sections separated by
   rules instead of space.

## Hard floors (non-negotiable, from spec 20)

- Sun-readable contrast ratios stay: ink on white, solid saturated
  pills (the PILL\_\* recipes are the status identity — untouched in all
  three directions), blue-700 actions ≥ ~6.8:1.
- 44 px tap targets, Thai-first copy, locked routes/behaviors.
- `color-scheme: light` posture unchanged.

## The three directions (all live at /design-preview)

### ก — Refined Utility (recommended)

The current language, grown up: depth via a zinc-50 page wash with
white elevated cards, softer radii, real control styling. Lowest risk,
biggest perceived-quality jump per changed class.

| Token       | Value                                                                                 |
| ----------- | ------------------------------------------------------------------------------------- |
| Page        | `bg-zinc-50`                                                                          |
| Card        | `bg-white rounded-xl border border-zinc-200 shadow-sm p-4`                            |
| Heading     | `text-lg font-semibold tracking-tight`                                                |
| Meta text   | `text-[13px] text-zinc-500`                                                           |
| Primary btn | `rounded-lg bg-blue-700 text-white shadow-sm hover:bg-blue-800 active:translate-y-px` |
| Secondary   | `rounded-lg border border-zinc-300 bg-white shadow-xs`                                |
| Input       | `rounded-lg border-zinc-300 bg-white shadow-xs focus-visible:ring-2`                  |
| Section gap | `space-y-6`, rules dropped in favor of whitespace + weight                            |

### ข — Industrial Brand

Direction ก **plus** a construction identity: slate-900 header band
with the wordmark, hi-vis amber accent (already the attention color)
as section markers (`border-l-4 border-amber-400`), bolder headings,
mono codes emphasized. Most "this is OUR product"; slightly busier.

### ค — Soft Cards

Modern SaaS look: zinc-100 page, borderless `rounded-2xl shadow-md`
floating cards, generous padding, pill-shaped primary buttons.
**Honest caveat:** shadow-only edges wash out in direct sun — the
preview keeps a faint border as mitigation, but this direction trades
some outdoor edge-definition for indoor polish.

## After the pick (spec 38 scope sketch)

1. Shared recipes first: card/button/input/section-header classes in
   the shared components (AppHeader, BottomTabBar, StatusPill
   geometry, notices, forms) + globals — pages inherit most of it.
2. Per-surface sweep (the spec-20 playbook: agents per surface, named
   UPDATE-tests for class pins, 3-lens adversarial pass with computed
   contrast ratios).
3. Interim SVG wordmark (Sarabun-weight "PRC Ops" + simple mark) into
   AppHeader + manifest icons — replaced whenever a real logo exists.
4. `/design-preview` route is TEMPORARY (public, static, zero data) —
   deleted in the spec-38 commit that implements the pick.
