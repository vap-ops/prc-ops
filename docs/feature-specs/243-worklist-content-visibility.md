# 243 — content-visibility on WorklistRow (interaction freeze / INP)

## Why

Profiled on the live app 2026-07-01 (operator: "press a button → the screen freezes
for a while before changing"). Driving the real app + the browser performance API:

- Light transitions (menu switch, small list, simple sheet) → **0 long tasks**.
- Opening the worklist of a project with many ungrouped work packages (TFM, **262
  WPs**) → a single **108 ms main-thread long task** on an 8-core desktop. Scale ~4× for
  a low-end phone → **~430 ms freeze** — exactly the reported symptom.

The DOM proof: the worklist container (`flex flex-col gap-2.5`) had **262 children** —
every outstanding `WorklistRow` mounts at once (the component's own comment assumes
"~80 rows"; real projects exceed that). The freeze tracks **render volume**, not the
action — this is the **INP** layer, separate from the network/DB floors already fixed
(Micro upsize, spec 241, spec 242).

## What (scope)

Add `content-visibility: auto` + `contain-intrinsic-size: auto 96px` to **both**
`WorklistRow` root elements (the `<Link>` interactive root and the read-only `<div>`
root, spec 154). The browser then skips style/layout/paint for off-screen rows,
collapsing the long task. Because the fix is on the shared row, it covers **every**
worklist (project worklist, review queue, `/requests`) from one edit.

Lean by design: CSS utilities only — no virtualization library, no dependency, no
pagination, no UX change (still one scrollable list; on-screen rows render identically).

## Non-goals (explicit)

- No virtualization library and no row cap / "show more" — those change UX or add a
  dependency; reserve them as heavier follow-ups **only if** real per-route INP (Speed
  Insights, once enabled) shows content-visibility is insufficient.
- No change to row content, the link/href, grouping logic, or the list-enter animation.

## Test (TDD)

Extend `tests/unit/worklist-row.test.tsx`: assert both roots carry the
`content-visibility:auto` + `contain-intrinsic-size` utilities — the `<a>` root when
`canOpen` (default), and the container root when `canOpen={false}`.

## Verify

`pnpm lint && pnpm typecheck && pnpm test` green. Manual (post-deploy): the 262-WP
project worklist no longer throws a >100 ms long task on open; off-screen rows render as
they scroll into view; on-screen layout is unchanged.

## References

- Profiled 2026-07-01 (Vercel Observability + in-page Performance API). INP layer,
  distinct from spec 241 (SW cache) / spec 242 (dashboard reads) / the Micro DB upsize.
- `content-visibility` for long lists: <https://web.dev/articles/content-visibility>.
