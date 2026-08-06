# 392 — Project zone maps (ผังโซนโครงการ)

**Status:** U1 · U2a · U2b · U3a shipped — U2c · U3b · U4 open, and **§7.1 must be settled first** · **Owner:** CC · **Created:** 2026-08-04

Operator, 2026-08-04: _"would it be great if we have an illustration feature for draftman to draw zones under each WP"_ → after the first recommendation argued against a drawing surface: _"I still believe we must draw zones, you can help seed too. reason being, we repeat same project again and again, these zones just need minor adjustments in each project."_

The second message is the spec. The reuse argument is what makes a drawn map pay for itself, and it is measurable — see §1.2.

---

## 1. The finding

### 1.1 Zones already exist. They are prose inside WP names.

Live, 2026-08-04. Matching `work_packages.name` against `(โซน|zone|ชั้น|floor|ห้อง|กริด|grid|แนว|ฝั่ง|อาคาร)`:

|                                        |                  |
| -------------------------------------- | ---------------- |
| WPs whose NAME carries a location word | **446** of 1,307 |
| WPs total / group WPs                  | 1,307 / 155      |
| Open leaf WPs                          | 967              |

Samples, newest first: `งานเข้าแบบพื้นลานด้านซ้ายของอาคาร` · `งานถอดแบบคอนกรีตห้องถังน้ำดี` · `งานติดตั้ง FCO ภายในอาคาร` · `งานทำรางวีพื้นลานด้านซ้ายของอาคาร`.

So the site already thinks in zones and records them in the only field available — a free-text name. Nothing can group by them, filter by them, or tie them to the drawing. **That is the gap; a canvas is one way to close it, not the gap itself.**

### 1.2 The reuse that justifies drawing

|                                            |                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Projects                                   | **6** — `TFM นายาว` · `TFM โพธิ์ทอง` · `TFM กกกระทอน` · `Mayfield คู้บอน 42` · `รีโนเวทบูท (BTNC)` · `บ้านคุณกฤษณ์` |
| Distinct WP names appearing in 2+ projects | **450**                                                                                                             |
| WP rows sitting under such a shared name   | **1,160 of 1,307 = 89%**                                                                                            |

Three of six projects are the same client and building type. A zone map is therefore not a per-project artifact — it is drawn once per building type and adjusted. Drawing cost amortises across every future TFM site, which is precisely the argument the operator made and the one the first recommendation missed.

Corroboration already in the codebase: `copy-work-packages-sheet.tsx` and `import-work-packages-sheet.tsx` exist (WPs are already copied between projects), and `clone_wp_briefs_from_project` exists as an RPC. Cloning project structure is an established habit here, not a new idea.

### 1.3 What the first recommendation got wrong, recorded so it is not re-argued

The opening position was "do not build a drawing surface", resting on two true measurements:

- **`photo_markups`: 2 rows all-time, 0 with strokes, 1 author, against 2,873 `photo_logs`.** The freehand markup shipped by spec 51 has never been used to draw. Both existing rows are text comments about photo phase.
- **`wp_briefs` (spec 377): 0 briefs · 0 attachments · 0 published versions · 0 route views in 30 days**, with a full authoring UI live. Its `wp_brief_attachment_types` seed already names `sheet_crop` (ภาพตัดจากแบบ) and `bar_schedule` (ใบดัดเหล็ก).

⭐ **Both numbers stand, and neither refutes this spec.** They measure acts with **no reuse**: annotating one photo helps one photo, filling one brief helps one WP. A zone map drawn once serves 89% of the next project for free. **A zero fill rate is evidence about the act that was measured, not about every act in its neighbourhood** — the amortisation axis has to be checked before a fill rate is allowed to kill a feature.

⚠️ The 377 numbers stay relevant as a **risk**, not a veto: U3 of spec 377 (the SA + PM read surfaces) is unshipped, so briefs have no reader. This spec must not repeat that shape — see §8.

---

## 2. The decision — zone is an axis, not a parent

A zone contains concrete, steel and paint at once. A WP carries **exactly one work-category** (locked rule, see `wp-single-category-rule`), and group WPs are category/deliverable-shaped. Therefore a zone **cannot** be a parent WP without forcing a choice between grouping by trade and grouping by area.

Zone is a separate axis crossing the existing tree — the same shape ADR 0080 chose for the org chart (dept · role · level · position as four independent axes rather than one nested hierarchy).

Rejected:

| Option                                | Why not                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Zone = parent group WP                | Collides with one-category-per-WP. A zone spanning 3 trades is not expressible.                               |
| Zone = `wp_briefs.location` free text | Already exists, 0 rows, and gives no rollup. Identical failure to today's names.                              |
| Zone = a `sheet_crop` image only      | The operator asked for tracking per zone (`Track work per zone`, 2026-08-04). A picture cannot be aggregated. |

---

## 3. The engine — Konva, with our own data model

Two separable things an off-the-shelf canvas sells: **interaction** (drag, hit-testing, resize anchors, pinch/pan, z-order) and a **document model**. Buy the first, refuse the second.

| Candidate                | Size (gzip)                            | Verdict                                                                                                                                                                                                                |
| ------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **konva + react-konva**  | **54 KB** (konva 10.3.0, bundlephobia) | **Chosen.** MIT, official React binding, `Transformer` supplies resize anchors, canvas-only so it renders no DOM chrome and cannot fight the Field-First token guards.                                                 |
| Hand-rolled SVG          | 0                                      | Viable but pays for pointer capture, per-anchor resize math, touch gestures. Snapping is ~40 lines **either way** — snapping was never the expensive part.                                                             |
| `@excalidraw/excalidraw` | **353 KB** (0.18.1) — 6.5×             | Rejected. Element model is freehand-drawing-shaped; this PWA already has iOS stale-bundle pain (`ios-pwa-stale-bundle-2026-07`).                                                                                       |
| tldraw                   | —                                      | **Rejected on licence.** Default terms permit development use only; production needs a commercial licence and the free/hobby tier keeps a "made with tldraw" watermark. Not a decision to make silently inside a spec. |
| fabric.js                | larger                                 | No official React binding, single canvas.                                                                                                                                                                              |
| Leaflet + Geoman         | mid                                    | Real fit for polygons-over-a-plan with snapping, but a map runtime for non-geographic data.                                                                                                                            |

Context: this repo runs on **16 runtime dependencies** with no canvas or chart library. Either rejected whiteboard would immediately be the largest thing in the bundle.

⚠️ **Konva must not enter the main bundle.** The editor is a lazily-imported client island (`next/dynamic`, `ssr: false`) mounted only on the zones route, so only a manager opening that page pays for it. Pin this: a source guard asserting the editor module is reached through a dynamic import, mutation-checked.

⭐ **The engine never sees the database.** Geometry persists as fractions of the canvas box (`0–1`), the same normalisation `validate-markup.ts` already uses for photo strokes, so a background image can be swapped without moving a zone and a cloned map lands on a differently-photographed site. Clone, rollup, RLS and pgTAP all key on our own columns, never on a vendor scene blob.

---

## 4. Data model

Three additions. Names gate-checked against `src/lib/db/database.types.ts` on `origin/main` — `zone_id` appears **0 times** today, and no `project_zone*` relation exists.

**`project_zone_maps`** — `id` · `project_id` → `projects` · `name` · `background_path` (nullable, Storage key) · `sheet_code` · `sheet_rev` · `sort_order` · `created_by` · `created_at` · `updated_at`.

One map per project is the current reality; the table is plural from day one because the operator flagged floors/buildings as a near-future need (2026-08-04: _"currently one, but maybe nested"_). The UI hides the map switcher while `count = 1`.

**`project_zones`** — `id` · `map_id` → `project_zone_maps` · `project_id` (denormalised for RLS + rollup) · `code` (free text, operator's call) · `name` · `shape` (`zone_shape` enum: `rect` · `rounded_rect` · `ellipse` · `polygon`) · `geometry` `jsonb` · `parent_zone_id` (nullable, self-FK) · `sort_order` · `created_by` · timestamps.

`geometry` is `{x, y, w, h}` for the box shapes and `{points: [[x,y], …]}` for polygons, every coordinate in `[0,1]`. A CHECK enforces the range and the point cap, mirroring the `photo_markups` CHECK posture where the DB — not the client validator — is the authority.

`parent_zone_id` ships nullable **now** and unused by the v1 UI. Retrofitting a parent onto live zone rows later costs a migration plus a backfill; adding the column today costs nothing.

**`work_packages.zone_id`** — nullable FK to `project_zones`, `on delete set null`. Nullable is correct and permanent: 1,307 existing WPs have no zone, and a WP that legitimately spans the whole site never gets one.

### 4.1 Gates

Every write RPC mirrors the live posture of `save_wp_brief_draft` and `create_work_package`, both of which open with `if not public.is_manager(public.current_user_role())` and raise `42501`, then check visibility (`can_see_wp` / `can_see_project`).

⭐ **Delegate to `is_manager`, never restate its members.** A hardcoded role array is exactly the defect that broke `catalog-images` uploads for two weeks (#823) — the helper moved and the copy did not.

RPCs: `save_project_zone_map` · `upsert_project_zone` · `delete_project_zone` · `set_wp_zone` · `clone_project_zones(source, target)`. Reads go through RLS on `project_zones` gated by `can_see_project`, so the field roles that already open a WP can see its zone without a new door.

⚠️ **If a background image is uploaded, the `storage.objects` policy is a fourth layer and lives in a different schema** — a `public`-only audit misses it (`delivery-photo-storage-rls-fix-2026-07`). The policy must call the same role helper. Storage keys must be **ASCII-sanitised**: a `\p{L}` sanitizer passes Thai letters through and Storage rejects the key (`supabase-storage-key-ascii`, fixed in #933) — and every zone name here is Thai.

---

## 5. Surfaces

**Editor** — `/projects/[projectId]/zones`, drill-down. Toolbar: rect · rounded rect · ellipse · polygon · background image · undo · a snapping toggle. Canvas below, zone list under it.

The zone **list** is not decoration: it is the keyboard and screen-reader path to everything the canvas does, because a canvas is opaque to both. Every zone must be renameable, re-codeable and deletable from the list alone.

⚠️ The project page will not be this route's only door (the WP detail's zone chip links here too), so it threads `from` through `safeBackHref` and registers in **both** `nav-back-affordance` lists — `STATIC_DETAIL` (bare `route/segment`) and `STATIC_MULTI_PARENT` (`route/segment/page.tsx`) — plus the project hub's `DRILL_DOWNS`. Omitting this ejects the user on back.

**WP detail** — a zone chip beside the code line, linking to the map. Read-only for everyone who can already open the WP.

**Rollup** — zones × categories on the project page, WP counts per cell, per-zone percentage. This is the surface that answers the operator's stated requirement (`Track work per zone`).

**Phones do not draw.** The editor is manager-only and tablet/desktop-first; field devices get the chip and the read-only map. Any horizontally scrolling row added here needs the `[touch-action:pan-x_pinch-zoom]` pair (`prc-ops-touch-action-scroll-rows`) — a build-failing guard.

---

## 6. Seeding and cloning

1. **Mine the 446 location-worded names** across the three TFM projects for recurring phrases, cluster into a candidate zone set (`พื้นลานด้านซ้าย`, `ห้องถังน้ำดี`, `บ่อบำบัด`, `อาคาร`…). The names come from the operator's own data, which is the half that has to be right.
2. **Draw the TFM standard map** from that set. Geometry is approximate by construction and corrected in the editor — cheap to fix, unlike the vocabulary.
3. **Propose WP→zone assignment as a reviewable list, never a blind backfill.** A name parse guesses; it does not get to write 1,160 rows unattended. The reviewer confirms or rejects per row.
4. `clone_project_zones` copies geometry, names, codes and nesting — **not** `background_path`, which is site-specific.

---

## 7. Units

| U   | Scope                                                                                                                              | Schema                          | State        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------ |
| U1  | Tables, enum, `work_packages.zone_id`, RLS, the five RPCs, pgTAP (gate refusals with a positive control; the `[0,1]` CHECK; clone) | **yes** — needs the schema lane | ✅ #957      |
| U2a | The zone LIST, `validate-zone`, the three server actions, the header chip                                                          | no                              | ✅ #958      |
| U2b | Konva editor island + toolbar + snapping + undo                                                                                    | no                              | ✅ this unit |
| U2c | Background image on the map                                                                                                        | **yes** — bucket + policy       | ⬜           |
| U3a | Zone chip on WP · rollup grid · filter the WP list by zone                                                                         | no                              | ✅ #974      |
| U3b | The ช่าง's own zone — two columns on `get_my_assigned_work`'s RETURN                                                               | **yes** — drop + recreate       | ⬜           |
| U4  | Clone-from-project UI + TFM seed + the assignment review screen                                                                    | data op                         | ⬜           |

U3 ships **with or before** U2 in calendar terms: an editor whose output nothing reads is spec 377's failure mode repeated. It did — U3a merged before U2b.

**U2 was split, and the split is additive-only.** U2c is separated because a background image needs a Storage bucket and a `storage.objects` policy, which is a fourth gate layer in another schema and claims the schema lane; the canvas needs neither. Neither half removes a signal — the U2a list keeps every operation it had — so the doctrine §2 split test passes.

⚠️ **U2b hides the canvas until the map holds at least one zone.** An empty stage teaches nothing and the list's empty state says more, so the FIRST zone of any map is always created from the list — which is also the keyboard and screen-reader path. Deliberate; stated here because the surface does not say it.

---

## 7.1 🚨 Unreconciled with spec 366 — read before building another zone unit

**`docs/feature-specs/366-wp-zones.md` (operator-locked 2026-07-27, never built) models zones differently, and this spec never mentions it** — zero occurrences of `366`, `wp_zones` or `project_drawings` anywhere above. U1 then shipped a table that takes 366's name.

|              | 366 — _"photos that know where they were taken"_                     | 392 — as shipped                                          |
| ------------ | -------------------------------------------------------------------- | --------------------------------------------------------- |
| drawing      | `project_drawings` + a private `project-drawings` bucket             | `project_zone_maps.background_path`, bucket never created |
| shape        | `project_zones.polygon`                                              | `project_zones.shape` + `geometry` — a superset           |
| WP ↔ zone    | **`wp_zones` M:N** — a WP references the zones it covers             | `work_packages.zone_id` — **one zone per WP**             |
| photo ↔ zone | **`photo_logs.zone_id`**, set at capture, sticky per session (D4/D5) | none                                                      |
| purpose      | evidence axis: prove a `หลัง` photo is the same place as its `ก่อน`  | tracking axis: rollup and filter                          |

The operator re-raised 366's model on **2026-08-06** — _"zones must be clickable, assisting SA in uploading during and after images in the respected zones"_, and, asked where a zone tap should land, _"zones live under WPs"_.

The gap is **additive**: `wp_zones`, `photo_logs.zone_id`, and the bucket this spec declared but never created. Nothing shipped has to be undone; `work_packages.zone_id` becomes either a derived primary zone or a retirement. ⚠️ Note the grain trap 366 §3 already recorded: `photo_logs_reject_group_wp` means a photo can never bind to a group WP, so zone-tagged evidence is leaf-grained.

**This needs an operator decision and one reconciling spec before any further zone unit.**

---

## 8. Acceptance — a fill rate, not a green suite

Measured 14 days after U4:

- `project_zones` row count > 0 for at least the three TFM projects, and the TFM maps materially identical (that is the reuse claim proving itself).
- **`work_packages.zone_id` fill rate on the newest project ≥ 60%.** Zero fill after a real project starts means the feature is dead on arrival regardless of test results — the same query shape that exposed spec 328's dead attribution (`count(col) = 0 of 18`).
- The zones route carries **non-zero views by a role other than the operator's own admin account**. Spec 388's acceptance found 11 of 14 views were admin/test accounts; that check is now standard.
- At least one zone map cloned into a project the operator did not hand-build.

⚠️ **Re-measure at ship time, do not inherit the numbers in §1** — every count here is live as of 2026-08-04 and the schema lane may move first.

---

## 9. Known traps for the implementer

- **Guard trips** (`prc-ops-guard-trip-map`): a new enum value, a new RLS policy, a new component folder and a new `page.tsx` each red a guard. Update them in the same PR.
- **`db:types` regeneration is a danger path** — it rewrites `worker/src/database.types.ts` and `db-types-sync.test.ts` forces the copies byte-identical. Expect the danger-path guard, and re-push onto current main before declaring it held; the verdict is base-relative.
- **Never trust a migration file for the live gate** — read `pg_get_functiondef` at build time. `is_manager`'s membership is not restated in this spec on purpose.
- **jsdom has no layout engine**, so nothing in vitest can see a mispositioned zone, a knob outside its track, or a canvas of the wrong size (#930). Geometry claims need a live `getBoundingClientRect` plus a source guard.
- **A `default:` arm in a shape `switch` silently drops a new shape kind.** Make the render switch exhaustive with no `default`.

---

## 10. Sibling

[393](393-bar-bending-schedule.md) — ใบดัดเหล็ก, the second half of the same operator request. Independent build; it reuses this spec's print-per-zone hook once zones exist.
