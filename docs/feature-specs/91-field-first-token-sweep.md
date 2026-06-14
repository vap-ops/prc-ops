# Spec 91 — Field-First token sweep (whole-app consistency)

**Status:** in progress (2026-06-14). Follows the Field-First reskin Unit 1
(worklist + shutter + shell + tokens). Unit 1 reskinned globals.css, the shell,
the worklist, the capture flow, and the shared primitives. **Every other
screen still uses the legacy raw Tailwind palette** (zinc/slate/blue/white),
so the app reads half-new, half-old. This spec migrates the remaining ~54
component/screen `.tsx` files onto the Field-First tokens.

## Principle

This is NOT a fresh redesign. The design decisions already live in
`globals.css` tokens (Unit 1). This sweep _applies_ them — replacing raw
palette utilities with their token equivalents — so the whole app shares one
surface/ink/status/elevation/type system. Coherent by construction.

Scope = colour/surface/elevation/type **tokens only**. Do NOT change layout,
structure, behaviour, props, copy, ARIA, or tap-target sizes. One concern:
make legacy colours resolve through tokens.

## Canonical mapping (legacy → token)

Surfaces / ink:

- `bg-white` → `bg-card`
- `bg-zinc-50` → `bg-page`
- `bg-zinc-100` → `bg-sunk`
- `bg-zinc-200` (surface/fill) → `bg-sunk`; (divider) → `bg-edge`
- `border-zinc-200` → `border-edge`
- `border-zinc-300` / `border-zinc-400` → `border-edge-strong`
- `text-zinc-900` / `text-zinc-800` → `text-ink`
- `text-zinc-700` / `text-zinc-600` → `text-ink-secondary`
- `text-zinc-500` / `text-zinc-400` → `text-ink-muted`
- `divide-zinc-200` → `divide-edge`; `ring-zinc-*` → `ring-edge`/`ring-edge-strong`

Neutral fills / brand:

- `bg-slate-900` → `bg-fill`; `bg-slate-800` (hover/press) → `bg-fill-press`
- `text-slate-900` → `text-ink` (on light) / `text-on-fill` (on dark)
- dark brand band `bg-slate-900` used as the header brand → `bg-brand`

Action (links + active-nav, EXCLUSIVE):

- `text-blue-700` → `text-action`; `bg-blue-700` → `bg-action`
- `border-blue-700` → `border-action`; `ring-blue-*` / `focus:ring-blue-*` → `ring-action`
- `hover:bg-blue-800` → `hover:bg-action` (or keep press tone)

Status families (semantics unchanged):

- amber accents `amber-400/500` → `bg-attn` / `text-attn`; `amber-50` → `bg-attn-soft`;
  `amber-300` → `border-attn-edge`; `amber-900` → `text-attn-ink`; ink ON amber → `text-on-attn`
- emerald `emerald-600` → `bg-done`; `emerald-700` → `bg-done-strong`; `emerald-50` → `bg-done-soft`
- red `red-600` → `bg-danger`/`text-danger`; `red-50` → `bg-danger-soft`;
  `red-300` → `border-danger-edge`; `red-900` → `text-danger-ink`
- sky `sky-700/800` → `bg-wait`/`text-wait`; `sky-50` → `bg-wait-soft`; `sky-300` → `border-wait-edge`

Radii / elevation / type (only if a legacy value is clearly the old default):

- card-ish `rounded-xl` containers → `rounded-card`; control `rounded-lg` → `rounded-control`
- `shadow-sm` on cards → `shadow-card`
- Leave `text-xs/sm/base/lg/xl/2xl` alone UNLESS the file is a heading/title that
  should adopt the ramp — do not churn body text in this sweep.

## PRESERVE (do NOT migrate)

- `status-colors.ts` and any sun-rated pill recipe — hard floor, out of scope.
- `classes.ts` — already tokenised; do not touch.
- Photo/image overlays: `from-black/*`, `to-transparent`, `text-white` over a
  photo, lightbox dark chrome (`photo-lightbox.tsx`). Keep dark viewer UI dark.
- `text-white` sitting on a coloured fill — keep (or map to the matching
  `text-on-*` only if obvious); never make it unreadable.
- Any raw colour that is semantically required and has no token equivalent.

## Tests

Path (b): component tests that pin OLD class strings (e.g. those asserting
`bg-white`/`text-blue-700`/`border-zinc-*`) must be re-pinned to the token
output in the same unit. The `design-doctrine` anti-drift (now scanning
`.ts`+`.tsx`) and the gloved-hands `min-h-9` floor must stay green.

## Done when

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; legacy-palette
grep over `src/**/*.tsx` (excluding the preserve list) returns ~0; spot-checked
on phone. Ships under the Field-First reskin (merge-auto, code-only, no schema).
