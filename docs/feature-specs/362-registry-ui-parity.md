# 362 — Registry UI parity (ทะเบียนวัสดุ as the house pattern)

**Status:** in progress
**Raised:** 2026-07-26 — operator, verbatim: _"UI of ทะเบียนวัสดุ is better than ทะเบียนอุปกรณ์ and ทะเบียนค่าแรง"_.
Operator answered the two scoping questions the same day: **ทะเบียนค่าแรง = BOTH** `ค่าแรงมาตรฐาน`
(`/settings/labor-rates`) and `ทะเบียนช่างและค่าแรง` (`/workers`); **scope = full port, อุปกรณ์ first.**

**Schema:** none. **Gates:** none — every role set, server action, RPC and RLS policy on these three
pages stays byte-identical. This spec moves presentation only.

## 1. Why วัสดุ reads better — it is READ-first, the other three are FORM-first

`/catalog` (`src/components/features/catalog/catalog-list.tsx`) opens on the **data**, and every write
is one tap away inside a sheet:

| #   | Ingredient                                                                                            | Where                         |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Search box (icon + `FIELD_INPUT pl-10`), matching name · spec · code · synonyms                       | `catalog-list.tsx:182`        |
| 2   | Filter chips **with counts**, horizontally scrollable, `role="radiogroup"`                            | `catalog-list.tsx:199`        |
| 3   | Grouped sections, each headed `label (n)`                                                             | `catalog-list.tsx:224`        |
| 4   | Card row — thumb · bold name · mono code badge · category pill · unit right                           | `catalog-list.tsx:123`        |
| 5   | Writes in a `BottomSheet` (`AddCatalogItem` / `EditCatalogItem`) so the page never stops being a list | `add-catalog-item.tsx:33`     |
| 6   | An empty state AND a distinct no-search-result state                                                  | `catalog-list.tsx:85`, `:220` |
| 7   | The LIST itself is token-clean — `text-body` / `text-meta`, zero raw `text-sm` / `text-xs`            | `catalog-list.tsx` (0 hits)   |

Ingredient 7 is scoped deliberately: `/catalog`'s **sheet bodies and row actions are not** token-clean
(`catalog-item-form.tsx:111`, `edit-catalog-item.tsx:62`, `set-sell-rate.tsx:60`, the page header links at
`app/catalog/page.tsx:126`). What makes the page read well is that the **list** is. This spec copies that, and
does not go tidying sheet interiors.

The other three invert it. Live row counts (queried 2026-07-26): **64** `equipment_items` in **9**
`equipment_categories`, **29** `workers`, **4** `worker_level_rates`, against 556 active `catalog_items`
(of 594 — `/catalog` filters `is_active`).

**`/equipment`** (`equipment-manager.tsx:711`)

- **Four blocks sit ABOVE the data** for a curator: `QuickAddCategory` (`:747`), `QuickAddOwner` (`:748`),
  the `หมวดหมู่ทั้งหมด` category card (`:753`), `AddEquipmentForm` (`:767`). The 64 items start at `:770`.
- **No search, no filter, no grouping.** One flat A→Z list of 64 (`page.tsx:48` orders by name).
- Rows are `border-t` dividers, not cards; sizes are raw `text-sm` / `text-xs`
  (`equipment-manager.tsx:514`, `:517`, `:520`).
- `ย้าย` / `แก้ไข` are `text-xs` text links (`:539`, `:550`) and both **expand inline** (`:560`, `:563`), so the
  list jumps under the finger.
- Counts exist, but only per **category** inside the taxonomy card (`edit-category-row.tsx:56`, computed at
  `equipment-manager.tsx:761`, spec 361 U6). The item list itself is uncounted and unfiltered — you cannot
  ask "show me the 9 นั่งร้าน".

**`/settings/labor-rates`** (`level-rates-form.tsx:188`)

- A level row DOES have a read header — level label + derived gross rate (`:77`). What has no read state is
  the **entered rate + WHT basis** (`:86`–`:121`): four permanently open input+select+save trios, so the
  registry reads as a wall of form controls.
- The WHT% card floats at the top with no heading saying what it is (`:154`; only the field label).
- `h1` is `text-lg font-semibold` where `/catalog` (`page.tsx:119`), `/equipment` (`:81`) **and** `/workers`
  (`:139`) all use `text-title text-ink font-bold tracking-tight`. Three of four registries agree; this is the
  lone drifter.

**`/workers`** (`worker-roster-manager.tsx:946`)

- `AddWorkerForm` — the largest form in the app (name · pay · status · gender · rate · project · phone · tax
  id · 3 bank fields · note, `:189`–`:328`) — is **always expanded above the roster** (`:991`, no open state).
- Grouped by `pay_type` only (2 fixed groups, `:992`), **no search, no FILTER chips, no counts** (`RadioChip`
  is used, but only inside the add/edit forms — `:202`, `:652`), `text-sm` rows (`:544`).
- Edit expands inline (`:618`–`:937`) and is very tall (bank block + project + level + trades + HT + invite).
- **No empty state at all** — with both groups empty the page renders the form and nothing else.

## 2. The pattern this spec makes house style

A **registry page** = a page whose job is to show a curated list of master rows and let a curator edit them.
Its shape, for all four:

1. `PageShell` + `BottomTabBar` + `DetailHeader` with `?from` back chip and an `h1` of
   `text-title text-ink font-bold tracking-tight`.
2. A header row: secondary links left, the primary `เพิ่ม…` button right — the button opens a `BottomSheet`.
3. **Search whenever the row set is unbounded** — not on a row-count threshold, which would make the control
   appear and vanish as data changes. อุปกรณ์ and ช่าง grow without limit and get one; ค่าแรงมาตรฐาน is
   **fixed by the level enum** (`WORKER_LEVEL_ORDER`, 4 — the page maps the enum, not the DB rows) and gets none.
   Like `/catalog`, the search + chips are inside the early-return: a registry with zero rows shows only its
   empty state.
4. **Filter chips with counts** over the row's natural axis (อุปกรณ์ → หมวดหมู่; ช่าง → การจ่าย),
   `role="radiogroup"`, in a `flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto` row. The
   `touch-action` PAIR is enforced by a **Vitest static scan** (`tests/unit/ui-class-contracts.test.tsx:114`,
   `scrollRowTouchActionViolations`) — `pnpm test`, not `next build`. It reads single string literals under
   `src/`, so a class split across variables would slip past it: write the row class inline.
5. Sections headed `label (n)`; rows are cards
   (`border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3`), name block
   floored at `min-w-40 flex-1` (never `min-w-0` — feedback 65de06ca).
6. **Every write in a sheet.** Add, edit, and (อุปกรณ์) move. The list never re-flows to make room for a form.
7. Row action buttons reach `min-h-11`. **This one is NEW, not inherited** — `/catalog`'s own row actions
   (`edit-catalog-item.tsx:62`, `set-sell-rate.tsx:60`) are `px-2 py-1 text-sm` with no `min-h`. The reference
   is the read-first _structure_, not every pixel of it; `/equipment`'s `text-xs` links are the worst instance
   of a floor the whole app is supposed to hold (§7 of ui-conventions), so the ported rows clear it.
8. Empty state + no-result state, both real sentences. `/equipment`'s empty state is **role-branched** today
   (two strings, `equipment-manager.tsx:794`) — both carry across; `/workers` has none and gains one.
9. `text-body` / `text-meta` tokens in the LIST. Field-First applies (no raw Tailwind palette, no `min-h-9` —
   `tests/unit/design-doctrine.test.ts:56`, `:126`). Shared `BottomSheet` chrome is out of scope: its title
   `<h2>` is `text-base font-semibold` (`bottom-sheet.tsx:130`) and stays that way.

## 3. Units

**U1 — `/equipment` (อุปกรณ์).** Search (name · asset tag) + category chips with counts + grouping by
category + card rows; `AddEquipmentForm`, `QuickAddCategory`, `QuickAddOwner`, the per-row edit and the
per-row move all move into sheets behind buttons. The category list (spec 361 U6 `EditCategoryRow`) moves
behind the same door as the category quick-add, so the page opens on equipment, not on taxonomy admin.
`canManageRegistry=false` (the site_admin field view) keeps exactly today's affordances: list + ย้าย, no
rates, no registry editing.

**U2 — `/settings/labor-rates` (ค่าแรงมาตรฐาน).** Rows become read-first (level · gross rate, with the
entered rate + basis demoted to meta) and `แก้ไข` opens a sheet carrying the existing input + basis select +
save. The WHT% card gets a heading. `h1` takes the registry token. No search, no chips (4 enum-fixed rows).
`LABOR_RATES_HINT` and `PayModelExplainer` stay where they are — above the rows, between header and list —
so the pay-model explanation still precedes the numbers it explains.

**U3 — `/workers` (ทะเบียนช่างและค่าแรง).** Search (name · phone · trade) + การจ่าย chips with counts +
card rows; `AddWorkerForm` and the per-row edit move into sheets. Level / HT / trades / invite blocks keep
their current gates and move with the edit body. Gains a first empty state.

## 4. Non-goals (recorded so review can reject them)

- No schema, no new columns, no RPC or server-action signature change.
- **No change to who can see or do anything.** The full gate inventory these three pages thread, all carried
  across unchanged and pinned by test:
  - `/equipment` — page `EQUIPMENT_MOVE_ROLES` → `canManageRegistry = BACK_OFFICE_ROLES.includes(role)` →
    `dailyRates` (admin-client read, curator audience only) → `canPriceEquipment` (`:740`) → the per-row
    **conditional prop spread** `{...(canPriceEquipment ? { dailyRate } : {})}` (`:788`) → `dailyRate !== undefined` (`:555`).
  - `/workers` — page `WORKER_ROSTER_ROLES`; `canGrade` (`role === "super_admin"`), `canAssignHt` /
    `canSetTrades` (`PM_ROLES`); plus the **`portalBound` bank-withhold shaping** (`page.tsx:121`), a data
    rule rather than a role gate, which the edit body branches on (`worker-roster-manager.tsx:757`).
  - `/settings/labor-rates` — an **inline literal** `requireRole(["procurement_manager","super_admin"])`, not
    a role-set constant; the money seed is admin-client-read in the page.
- No new fields on any form, no validation changes.
- **Exception to "no new logic": `/workers` gains an empty state**, because it has none today. Minimal
  sentence, no branching.
- `/catalog` itself is not touched — it is the reference.
- Sorting stays as today (A→Z by name); no new sort control.
- Shared primitives (`BottomSheet`, `RadioChip`, `src/lib/ui/classes.ts`) are not edited.

## 5. Risks

**★ The one thing that cannot be copy-pasted: `dailyRate`'s `undefined`-vs-`null` distinction.**
`undefined` = "not the money audience, render no control"; `null` = "audience, rate unset". It survives ONLY
because every hop uses a conditional spread under `exactOptionalPropertyTypes`. Moving the row's editor into
a sheet adds a NEW hop (manager → row → sheet), and writing it as an ordinary `dailyRate={…}` pass-through
either type-errors or silently converts "no audience" into "unset" — which **renders the rate control to the
field view**. This must be re-threaded at each hop and pinned by a test that asserts the field view sees no
rate control. (`/catalog` uses the same idiom for `sellRate` at `app/catalog/page.tsx:111`.)

- `tests/unit/equipment-manager.test.tsx` (`:107` เพิ่มอุปกรณ์, `:154` แก้ไข, `:169` เพิ่มหมวดหมู่, `:178`
  เพิ่มเจ้าของ, `:197` ย้าย), `worker-roster-manager.test.tsx` (`:103`), `worker-roster-firm-move` /
  `-level-ht` / `-trades.test.tsx`, and `level-rates-form.test.tsx` (`:54`, `:66`) all reach controls
  DIRECTLY. **`BottomSheet` unmounts its children when closed** (`bottom-sheet.tsx:69`), so every one needs an
  added open-click. Each is re-aimed at the same behaviour through the sheet — never deleted or weakened.
  `tests/unit/equipment-category-rename.test.tsx` renders `EditCategoryRow` directly and **survives untouched**;
  do not re-aim it.
- The sheet injects its own `<h2>` title (`bottom-sheet.tsx:130`) — heading/`getByText` queries in the moved
  tests can collide with it. Prefer role+name queries.
- Guards that will red if the port is careless, beyond the `touch-action` pair:
  `ui-class-contracts.test.tsx:64` (a `top-1/2` must travel with `-translate-y-1/2` — the catalog search icon
  at `catalog-list.tsx:184` is exactly that pattern, so copy BOTH classes) and `design-doctrine.test.ts`
  (`:56` no raw Tailwind hue, `:71` every colour utility resolves to a globals.css token, `:126` no `min-h-9`).
- `tests/unit/money-read-guard.test.ts` does **not** cover `equipment_items` / `workers` /
  `worker_level_rates` (none are in `MONEY_TABLES`), so it will not catch a money-audience regression here —
  which is precisely why the `dailyRate` pin above is required. Keep every admin-client read in `page.tsx`.
