# Spec 277 — Work-category visual identity (letter · color · icon)

**Status:** U1 in progress (2026-07-07). Design approved by operator (letter scheme
`P S A W E C G X F`, fixed brand colors + icons, Typhoon τ=0.85).

## Why

The firm has 9 global work-categories (`work_categories`, `W01`–`W09`, spec 226). Today
they are text-only: a work package's หมวดงาน (when bound) shows as a plain Thai name, and
all 390 live WPs are uncategorised. The operator wants a **visual identity per category** —
a memorable **letter**, a **color**, and an **icon** — carried uniformly wherever a WP or
its category appears, so a site admin recognises "kind of work" at a glance instead of
reading Thai every time. This lowers the training/onboarding cost of the whole app.

Grounding (research 2026-07-07):

- WP `code` is free-text (no generator; `unique(project_id, code)` only) — so "the letter
  embedded **inside** the code string" needs a code generator that does **not** exist yet.
  That is deferred (a later unit). The **derived badge** — rendered from the WP's category
  binding, never parsed from the code — is the universal, no-rename win and is P0.
- Category color must be a **token**, not raw hex/palette: `tests/unit/design-doctrine.test.ts`
  greps `src/` and fails on any raw Tailwind hue literal (`bg-indigo-600`, …) outside a
  4-file allowlist. New `--color-cat-*` tokens generate `bg-cat-*`/`text-cat-*` utilities
  that the ban regex does not match — so no allowlist edit is needed.
- The app already has the exact SSOT pattern to mirror: `src/lib/status-colors.ts` +
  `src/lib/status-icons.ts` (`Record<Enum, …>`, exhaustive) rendered through one
  `StatusPill` (`src/components/features/common/status-pill.tsx`). The category identity is
  its sibling.
- Icons: `lucide-react` (confirmed dep). All 9 chosen glyphs verified present.

## The identity (firm-wide, fixed)

| Code | Letter | Color token      | lucide icon   | หมวดงาน (name_th)    |
| ---- | :----: | ---------------- | ------------- | -------------------- |
| W01  | **P**  | `cat-w01` slate  | `Hammer`      | เตรียมการ & รื้อถอน  |
| W02  | **S**  | `cat-w02` indigo | `Frame`       | โครงสร้าง            |
| W03  | **A**  | `cat-w03` teal   | `PaintRoller` | สถาปัตยกรรม          |
| W04  | **W**  | `cat-w04` blue   | `Droplets`    | ประปา & สุขาภิบาล    |
| W05  | **E**  | `cat-w05` gold   | `Zap`         | ไฟฟ้า & สื่อสาร      |
| W06  | **C**  | `cat-w06` cyan   | `Wind`        | ปรับ/ระบายอากาศ      |
| W07  | **G**  | `cat-w07` pink   | `Signpost`    | ป้าย                 |
| W08  | **X**  | `cat-w08` green  | `TreePine`    | ภายนอก & ผังบริเวณ   |
| W09  | **F**  | `cat-w09` purple | `Sofa`        | ครุภัณฑ์ & เพิ่มเติม |

Letters chosen from the English gloss, none in the OCR-confusable set (no I/O/L/1/0);
HVAC = **C** (not V) so it can't be misread as **W** (Water). Colors are theme-invariant
brand hues (self-contained tiles carry white text ≥ 4.5:1 on both light and dark grounds),
deliberately spaced away from the reserved semantic hues (attention-amber, done-emerald,
action-blue) — that separation is the reason for a dedicated `--color-cat-*` block rather
than reusing status tokens.

## Units

- **U1 — identity SSOT + `CategoryChip` primitive** (this unit; code-only, auto-merge).
  The reusable render point. Does NOT wire into WP surfaces yet (all WPs uncategorised, so
  nothing to show) and does NOT touch the DB.
- **U2 — settings editor + legend** (`/settings/work-categories`, super_admin): the visible
  legend of the 9 chips + CRUD over the existing spec-226 RPCs. Adds `work_categories.letter_code`
  (additive migration) so letters are operator-editable. Wires `CategoryChip` into the WP
  detail badge + worklist.
- **U3 — Typhoon auto-tag → the 390 unlock**: advisory `wp_category_suggestions`,
  `ensure_project_category_from_work_category` materialise-RPC, backfill script, review UI
  (τ=0.85 one-tap confirm → the locked `set_work_package_category`).
- **U4 — cross-entity "highlight related first"**: seed `work_category_material_categories`
  tool/equipment rows (materials arm already live via spec 227); equipment bridge co-designed
  with spec 275.
- **U5 — category analytics**: profit/spend by category, worklist filter/group by หมวดงาน.
- (Later) letter-in-WP-code generator for newly created WPs.

## U1 — scope (exactly this)

**New: `src/lib/work-categories/identity.ts`**

- `WORK_CATEGORY_TOP_CODES` (`W01`..`W09`) + `WorkCategoryTopCode` type.
- Exhaustive `Record<WorkCategoryTopCode, …>` maps for letter, lucide icon, tile color class
  (`bg-cat-w0x` literal), and accent class (`text-cat-w0x` literal) — literals so Tailwind's
  source scan emits the utilities.
- `isWorkCategoryTopCode(code)` type guard.
- `workCategoryIdentity(code): WorkCategoryIdentity | null` — accepts any `work_categories.code`:
  a 3-char top (`W02`) or a 5-char subsection (`W0203`, resolved to its parent via the first
  3 chars, matching spec 226's `left(code,3)` grain). Blank/unknown → `null`.

**New: `src/components/features/work-packages/category-chip.tsx`**

- `<CategoryChip code label? className? />` — sibling of `StatusPill`. Renders a solid
  category-colored rounded tile with the white **letter** (mono), and when `label` is given,
  the **icon** (in the category accent color) + the label in `text-ink`. Returns `null` for
  an uncategorised/unknown code (the caller renders its own "unset" state). Accessible name =
  `label` (or the code when icon-only).

**New tokens: `src/app/globals.css`** — a `CATEGORY IDENTITY` block in the PRC-OPS `@theme`
adding `--color-cat-w01`..`--color-cat-w09` (OKLCH, white-text-safe).

**Out of scope for U1** (do NOT do here — surfaced, not implemented): wiring the chip into
`WorkCategoryBadge`/worklist/detail; the `letter_code` DB column; the settings editor;
tagging; the WP-code generator. These are U2+.

## U1 — verification

- `pnpm test tests/unit/work-category-identity.test.ts tests/unit/category-chip.test.tsx` green.
- `pnpm lint && pnpm typecheck && pnpm test` all green (full suite; doctrine test still passes —
  no raw-hue literal introduced).
