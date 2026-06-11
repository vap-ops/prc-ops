# Spec 38 — Re-skin: Refined Utility + brand band (direction ก + ข-band)

**Status:** locked — 2026-06-12. Implements the
`design-directions-2026-06.md` pick (operator delegated: ก everywhere,
ข's slate header band for identity). Visual only — zero route, copy,
behavior, schema, or status-pill change.

## 0. Locked recipe map (the whole spec)

Hard floors from spec 20 are unchanged: PILL\_\* fills, ink-on-white
text, 44 px targets, `color-scheme: light`, LINE button, scrim
exceptions, manifest/theme `#ffffff`.

### Brand band (shared — AppHeader + LogoutButton dark variant)

`AppHeader` becomes the slate-900 band: wordmark
`PRC <amber-400>Ops</>` above the heading, kicker amber-400, heading
white, โปรไฟล์ link white/amber hover, logout dark variant. Hub pages
inherit automatically. Detail screens keep their light breadcrumb
headers (they are content, not chrome).

### Mechanical class map (page sweep)

| Current                                                             | New                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `<main … bg-white` (pages w/ AppHeader or tab bar)                  | `bg-zinc-50`                                                                   |
| page-local `<header className="border-b border-zinc-300`            | `border-b border-zinc-200 bg-white`                                            |
| card: `rounded-lg border border-zinc-300 bg-white`                  | `rounded-xl border border-zinc-200 bg-white shadow-sm`                         |
| card/list item: `rounded-md border border-zinc-300 bg-white`        | `rounded-xl border border-zinc-200 bg-white shadow-sm`                         |
| sub-panel: `rounded-md border border-zinc-300 bg-zinc-50`           | `rounded-lg border border-zinc-200 bg-zinc-50`                                 |
| primary btn: `rounded-md bg-blue-700`                               | `rounded-lg bg-blue-700 shadow-sm` (+ keep hover; add `active:translate-y-px`) |
| secondary btn: `rounded-md border border-zinc-400 bg-white`         | `rounded-lg border border-zinc-300 bg-white shadow-xs`                         |
| input/select/textarea: `rounded-md border border-zinc-400 bg-white` | `rounded-lg border border-zinc-300 bg-white shadow-xs`                         |
| nav strip: `border-zinc-300 bg-zinc-100`                            | `border-zinc-200 bg-zinc-100` (strip bg stays — sits on zinc-50)               |

**Do NOT touch:** `status-colors.ts`, StatusPill geometry,
BottomTabBar, the LINE login button, ConfirmDialog/lightbox scrims,
upload-queue banner, globals.css tokens, anything inside
`/design-preview` (it is deleted by this spec).

### Notices

ErrorNotice/EmptyNotice → `rounded-lg` (named UPDATE of their pins).

## 1. Scope

- Shared chrome restyle (AppHeader band, LogoutButton variant,
  notices) — by hand.
- Page sweep per the class map (three parallel agents on disjoint
  surface sets: SA pages / PM pages / requests + feature components).
- Named UPDATE-tests for any class pins the sweep moves.
- Delete `/design-preview` + its proxy PUBLIC_PATHS entry +
  launch.json keeps (harness config, not UI).
- Verification: suites green; adversarial lens pass (contrast +
  locked-behavior + discipline); operator phone pass is acceptance.

**Out:** real logo asset (operator-owned, queued), manifest icon
regeneration, dark toggle, any layout/IA change.
