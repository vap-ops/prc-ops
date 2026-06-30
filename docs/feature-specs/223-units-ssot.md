# Spec 223 — Units SSOT: `catalog_units` table + structured unit picker (ADR 0066 / S1)

**ADR:** [0066 — procurement taxonomy redesign](../decisions/0066-procurement-taxonomy-redesign.md).
This is **session S1** of the S0–S10 plan. **Autonomy class: 🔔 ONE-TAP HOLD** — schema
migration trips the danger-path guard; ships green and waits for the operator's one-tap
merge. **Reserved migration timestamp: `20260813029000`.** Schema is single-lane.

## Acceptance criteria / Definition of Done (test-first intent)

> TDD-for-DB: write these as the **failing pgTAP** (`supabase/tests/database/`) and the
> **failing Vitest** for the picker, BEFORE any implementation. These bullets ARE the red
> tests.

1. `public.catalog_units` exists with `code` (PK or unique), `display_name`,
   `abbr_short`, `unit_class`; RLS enabled; `grant select to authenticated`; **no** direct
   write grant; deactivate-not-delete (`is_active` boolean) — masters-no-delete.
2. The table is **seeded from the current `COMMON_UNITS`** list (the 25 Thai units in
   `src/lib/purchasing/units.ts:10-36`), each with a sensible `unit_class` (count / length
   / area / volume / weight / trips), so no vocabulary is lost in the move.
3. Writes go **only** through SECURITY DEFINER RPCs (`create_catalog_unit` /
   `update_catalog_unit` / `set_catalog_unit_active`) mirroring the **spec 221 U2 RPC
   posture** (see "RPC posture" below). pgTAP pins: anon-deny, role gate `42501`,
   duplicate `code` `23505`, eval-once subselects.
4. The catalog item form's unit field becomes a **structured picker** sourced from
   `catalog_units` (active rows) **replacing the free-text fallback as the default path**,
   while **`UNIT_OTHER_VALUE` is retained** as the escape hatch: choosing
   `อื่น ๆ (ระบุเอง)` still reveals the free-text input and submits the typed string. The
   stored unit value remains a plain string (no FK on the consuming rows in S1).
5. `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:test` green (new file +
   existing signature-pin tests unaffected).

## Why (cite ADR 0066 + the caveat this spec must answer)

ADR 0066 globalizes the procurement vocabulary. Units are part of that vocabulary, but
today they live in a **TS constant** whose header file
(`src/lib/purchasing/units.ts:1-8`) deliberately states:

> _"Unit-picker vocabulary (spec 16 §1). **TS constant, not a DB table** — static
> presentation data; AppSheet reads the stored text, never this list. The operator amends
> it by code PR…"_

**This spec reverses that decision, and must justify the reversal.** The original rationale
no longer holds: (a) **AppSheet is sunset** (ADR 0034) — the "AppSheet reads the stored
text" constraint that motivated a code-only list is gone; (b) ADR 0066's `boq_line`
(D6) and the scoped pickers need units to carry **structure** (`unit_class`, short
abbreviation) that a flat string array cannot express; (c) operator-extensible runtime
vocabulary is the same tradeoff ADR 0055 dec.2 already resolved in favour of a **table,
not a constant**, for `equipment_categories` and spec 221 resolved for material
categories. So units join the same managed-table pattern. The **free-text escape hatch
stays** (`UNIT_OTHER_VALUE`) — a planner buying in a one-off unit must never be blocked on
a code PR.

## Schema (one additive migration, `20260813029000`)

> **Schema-lane protocol (MANDATORY, before writing any SQL):** APPEND your lane claim to
> `D:/claude/projects/prc-ops/LANES.md` with branch + this reserved timestamp
> `20260813029000`, **RE-READ** to confirm no concurrent schema claim, and **re-verify no
> later migration has landed** on `supabase/migrations/` (the `+1000` floor can move; if a
> later timestamp exists, bump to `max+1000` and update this spec's recorded value). Only
> ONE schema lane at a time.

- `public.catalog_units` — `code text` (unique, the stable key + the stored value),
  `display_name text NOT NULL`, `abbr_short text NULL`, `unit_class text NOT NULL`
  (enum-or-checked set: `count | length | area | volume | weight | trips`), `sort_order`,
  `is_active boolean NOT NULL default true`, `created_by`, `created_at`/`updated_at` (reuse
  the existing `set_updated_at` trigger — do NOT redefine). `check (length(trim(display_name)) > 0)`.
- RLS: `enable row level security; revoke all from anon, authenticated; grant select to
authenticated;` SELECT policy `using (true)` (firm-wide vocabulary, like
  `catalog_categories`) — confirm against the `catalog_categories` policy at build time and
  match it. **No** delete grant/policy.
- **Seed** the 25 `COMMON_UNITS` values into `catalog_units` in the same migration
  (`on conflict (code) do nothing`), classed.

### RPC posture (mirror spec 221 U2 / `20260813020000` exactly)

Each of `create_catalog_unit(p_code, p_display_name, p_abbr_short, p_unit_class,
p_sort_order)` / `update_catalog_unit(...)` / `set_catalog_unit_active(p_code,
p_is_active)`:

- `security definer`, `set search_path = public`.
- capture role once (`v_role := public.current_user_role()`); **null-safe** gate:
  `if v_role is null or v_role not in
('project_manager','super_admin','procurement','project_director') then raise … using
errcode = '42501'`.
- `23505` on duplicate `code`; `22023` on a blank/invalid arg.
- `revoke all on function … from public, anon; grant execute … to authenticated;` — **never
  service_role** (revoking from `public` alone is insufficient; Supabase auto-grants anon).

## Files the downstream session touches (real anchors)

- `src/lib/purchasing/units.ts:10-38` — `COMMON_UNITS` + `UNIT_OTHER_VALUE` sentinel. The
  constant is the **seed source**; keep the file (and `UNIT_OTHER_VALUE`) but mark
  `COMMON_UNITS` as the historical seed (the table is now SSOT for the picker options).
- `src/components/features/catalog/catalog-item-form.tsx:288-325` — the unit `<select>`
  - free-text fallback consumer. Switch its options to the `catalog_units` rows threaded
    from the page loader; keep the `UNIT_OTHER_VALUE` branch verbatim.
- new `supabase/migrations/20260813029000_spec223_catalog_units.sql`
- new `supabase/tests/database/NNN-spec223-catalog-units.test.sql`
- `src/lib/db/database.types.ts` — regenerate via `pnpm db:types` after `db:push`.

## Out of scope

- Adding a `unit_code` FK to `purchase_request` lines / `catalog_items` / `supply_plan_lines`
  (the stored value stays a plain string in S1; an FK migration is a later unit).
- A units management screen (CRUD UI) — the RPCs exist; the admin screen is a later unit
  (operator can seed-and-go; new units arrive via the `อื่น ๆ` free-text path meanwhile).
- Removing `COMMON_UNITS` from the codebase (kept as the seed-of-record + a test anchor).

## Verification

- `pnpm db:push` → `pnpm db:types` → `pnpm db:test` (new file green; signature-pin tests
  unaffected — no existing RPC signature changed).
- `pnpm lint && pnpm typecheck && pnpm test`.
- Manually preview the item form: structured picker shows the seeded units; `อื่น ๆ` still
  reveals the free-text input and submits the typed unit.
