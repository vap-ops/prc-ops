# Spec 366 — WP zones: photos that know where they were taken

**Status:** DRAFT — designed with the operator 2026-07-27, not yet planned or built.
**Origin:** operator directive 2026-07-26, points 6 and 7 of seven — _"Prepare for multiple zones per WP, images of during and after must be relevant"_ and _"SA needs to understand the zones (think of polygon buttons on simplified drawings dedicated to the respected WP) users can pick zones simply by clicking on the simplified drawing"_.
**Sibling:** [spec 363](363-wp-detail-sa-nav.md) (points 1–5) shipped the SA's navigation and deliberately left the seam this spec fills. ⚠️ 363 originally called this "spec 364"; 364 and 365 were claimed by other lanes on 2026-07-27, so zones are **366**. The references in 363 were corrected in this spec's PR.

---

## 1. Why

A work package's photos are organised on **one axis**: `phase` (ก่อน · ระหว่างทำ · หลัง · หลังแก้ไข) plus a rework round. Measured on prod 2026-07-27:

|                                                         |                                                   |
| ------------------------------------------------------- | ------------------------------------------------- |
| photos in `photo_logs`                                  | **2,672** across 252 WPs                          |
| average per WP                                          | 10.6                                              |
| **most on a single WP**                                 | **86**                                            |
| WPs carrying more than 30                               | 9                                                 |
| `needs_revision` reasons since spec 355 shipped (07-24) | **4 `mismatch`** ("รูปไม่ตรงงาน"), 5 `incomplete` |

An 86-photo work package holds roughly twenty `ระหว่างทำ` shots with no way to say which part of the work each one shows, and no way to prove that a `หลัง` photo is the same place as the `ก่อน` photo it is supposed to answer. The `mismatch` rejections are that gap surfacing as rework.

**The concept already exists in this project — as unstructured text.** The pilot's parent WPs encode place in the name because there is no field for it:

- `งานระบบไฟฟ้าเมนภายในอาคาร` vs `งานระบบไฟฟ้าเมนภายนอกอาคาร` — same trade, inside vs outside.
- `งานปลั๊กและสวิตช์ไฟภายในอาคาร` vs `...ภายนอกอาคาร` — likewise.
- `งานพื้นลานด้านหน้า` · `ด้านข้าง` · `ด้านหลัง` · `ลานโหลด` — one trade, four yards.
- `งานฐานราก Tower`, `งานห้องถังน้ำดี`.

So zones are not a new idea here. They are an existing idea with no schema.

### 1.1 The risk this spec must not repeat

**Spec 248 built photo pairing — `photo_logs.answers_photo_id` — and it holds 0 rows out of 2,672.** It died because it required a curatorial act first: a PM had to attach defect photos before any field value existed, and `phase='defect'` has **0 rows** too. Zones require an authoring act as well (upload a plan, trace polygons). That is the same failure shape, and pretending otherwise would be the most likely way this spec wastes a month.

Two things are therefore load-bearing rather than optional:

1. **U5 (clone)** — every project after the first must be nearly free, or authoring never happens twice.
2. **The fill-rate check is written into this spec up front** (§8), so zones get judged on field data instead of on how good the editor looks.

## 2. Decisions (operator-locked 2026-07-27)

| #      | Decision                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D1** | A zone is a **photo/evidence axis**, not a restructuring of the WP tree                                  | The WP tree is load-bearing for money: `labor_logs` bind to LEAF WPs (spec 306 U5a, whose grain switch was its own unit), `wp_profit` and labour budgets derive per WP, and the single `plan_baselines` row has 331 items keyed to today's WPs. Collapsing `งานพื้นลาน*` into one WP with four zones would change the grain cost is measured at and invalidate that baseline. Zones are additive and reversible; if a restructure is ever right, the zone data will exist to do it deliberately. |
| **D2** | Zones belong to a **drawing**, a drawing belongs to the **project**; a WP references the zones it covers | The operator's words were "drawings dedicated to the respected WP", but one floor plan physically serves every WP on that floor — per-WP drawings would mean authoring one per work package (332 leaves on the pilot alone). The dedicated _experience_ is delivered by rendering the shared plan with only this WP's polygons live and the rest dimmed.                                                                                                                                         |
| **D3** | **One building model per project** ("16", "20"), several drawings allowed per project                    | Operator 2026-07-27. A project builds one model plus its surrounds — the pilot is อาคาร + Tower + ลาน. Multiple drawings per project still needed (ground floor, upper floor, site plan), so `project_drawings` is a table, not a column. **No building/unit level between project and zone** — that would only be needed for an estate of identical structures, which is not how these projects are shaped.                                                                                     |
| **D4** | Picking a zone at capture is **ALWAYS OPTIONAL**                                                         | Operator 2026-07-27, choosing lowest friction on the app's one proven behaviour (2,031 SA photos in 30 days). ⚠️ Recorded honestly: the design recommendation was "required only where zones exist" and the operator chose optional. **Mitigated by D5 rather than by coercion.**                                                                                                                                                                                                                |
| **D5** | The zone selection is **sticky within a capture session**                                                | Makes D4 workable: the SA picks a zone once on arrival and every subsequent shot inherits it until changed — one tap per site visit, not per photo. This is what allows an optional field to reach a fill rate high enough to prove a before/after pair is the same place.                                                                                                                                                                                                                       |
| **D6** | Polygons are stored as **normalised 0–1 coordinates in JSONB**. No PostGIS                               | This is a picture, not a map. Normalised points survive any render size and any re-upload at a different resolution, need no extension, no SRID, and no spatial index for the handful of polygons a project carries.                                                                                                                                                                                                                                                                             |
| **D7** | Templates are **clones of a reference project**, not a registry                                          | The operator's "templates for 16 and 20". The mechanism that actually works in this repo is spec 142 U6 — `CopyWorkPackagesSheet` → `copyWorkPackages` → the `clone_work_packages` DEFINER RPC. ⚠️ `wp_templates` (28 rows) is the cautionary tale: a template registry with **zero readers and zero writers** anywhere in the codebase. Zone cloning mirrors the copy path; a reference project shown by label ("แบบ 16") is the whole template story.                                          |

## 3. Model

All additive. No existing table changes shape except one nullable column.

```
project_drawings          project_zones                    wp_zones
─────────────────         ──────────────────────           ──────────────────
id                        id                               work_package_id ─┐
project_id ──┐            drawing_id ──────────┐           zone_id ─────────┼─→ project_zones
label        │            name (โซน A / ห้องถังน้ำดี)        (composite PK)   │
storage_path │            polygon  jsonb  [[x,y],…] 0–1                     │
sort_order   │            sort_order                                        │
created_by   │            is_active                                         │
created_at   │            created_by, created_at                            │
             └─→ projects                                                   │
                                                                            │
photo_logs.zone_id  ────────────────────────────────────────────────────────┘
   nullable FK → project_zones(id)
```

- **Storage:** a new **private** `project-drawings` bucket. ⚠️ Its `storage.objects` policies are part of this spec's surface — the PR #456 lesson is that RLS parity sweeps scanning only the `public` schema **miss `storage.objects` policies** entirely (a WP-inner-join policy there once denied every WP-less store delivery, for both procurement and the SA). U1 writes and pgTAP-pins those policies explicitly.
- **`photo_logs.zone_id` is set at capture and never updated.** Verified live 2026-07-27, all three layers present: `authenticated`/`anon` hold **only INSERT and SELECT**, the four policies are SELECT (`r`) and INSERT (`a`) only, and triggers `photo_logs_block_update` + `photo_logs_block_delete` both fire `photo_logs_block_write()` BEFORE UPDATE/DELETE. So correcting a photo's zone uses the existing supersede path — a new row pointing at the old via `superseded_by`. A cheaper correction path would be a separate spec, never a bypass.

- ⚠️ **Photos are LEAF-grained, so zone-tagged evidence is too.** `photo_logs_reject_group_wp` fires `wp_reject_group_binding('work_package_id')` BEFORE INSERT — a photo can never bind to a group (งาน) WP. This is the same grain trigger that forced spec 306 U5a's design. It does not block anything here, but it decides open question 5: a zone bound to a parent งาน could never be reached by a photo on that parent, because no photo can exist there.

- ⚠️ **`photo_logs_spec248_guard` runs BEFORE INSERT** on the same table. U3 adds a column to the insert payload and must gate-check that guard's body first — an insert that trips it fails at the DB, not in the form.
- **A WP with no `wp_zones` rows behaves exactly as today** — no picker, no chips, nothing on screen. Every existing WP is in that state on day one, so U1–U3 ship inert and the surface appears only where someone authored zones.

## 4. Units

| U      | Ships                                                                                                                            | DB?                   | Notes                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| **U1** | `project_drawings` + `project_zones` + `wp_zones` + `photo_logs.zone_id` + the `project-drawings` bucket, RLS on all four, pgTAP | **Yes** — schema lane | Additive only. Gate-check `photo_logs`' append-only triggers first             |
| **U2** | PM authoring: upload a plan, draw and name polygons, bind zones to WPs                                                           | No                    | The expensive unit. Desktop-shaped (the SA never authors)                      |
| **U3** | SA capture: sticky zone chips on the capture bar, always optional (D4/D5)                                                        | No                    | Must not touch the shutter path's latency or layout — 2,031 photos/30d ride it |
| **U4** | Gallery grouped by zone + the WP-dedicated drawing view: tap a polygon, filter to its photos                                     | No                    | This is where "images of during and after must be relevant" gets paid off      |
| **U5** | `clone_project_zones(source, target)` + reference-project labelling                                                              | **Yes** — RPC         | Load-bearing per §1.1: makes project #2 onward nearly free                     |

**Order: U1 → U2 → U3 → U4 → U5.** U3 is worthless before U2 (nothing to pick), and U4 before U3 (nothing bound). U5 last because it needs a real authored project to clone _from_.

⚠️ **U1 and U5 claim the schema lane.** Per `LANES.md` that is single-writer — check the STATUS line for the next free migration number and never trust a locally-computed "next".

## 5. What the SA sees

Nothing at all, until a WP has zones. Then:

- **Capture:** a chip row above the shutter — the WP's zones, one tap to select, selection sticky until changed. No gate, no required field, no blocking dialog.
- **Photos tab:** photos grouped by zone under each phase, so twenty `ระหว่างทำ` shots become four groups of five.
- **The drawing:** the project's plan rendered with this WP's polygons live and the rest dimmed. Tapping a polygon filters the gallery to that zone. This is point 7 — the SA understands the zones by seeing them, not by reading `โซน A` in a list.

## 6. Non-goals

- Any change to the WP tree, WP naming, or WP grain (D1). `งานพื้นลานด้านหน้า` and its siblings stay exactly as they are.
- PostGIS, GIS coordinates, or any tie to `projects.gmap_url`.
- Zone-level cost, budget, or progress. Zones are an evidence axis in this spec — nothing money-side reads them.
- Per-zone approval or review workflow. The review queue keeps working at WP grain.
- Retro-tagging the 2,672 existing photos. They keep `zone_id` null forever unless someone supersedes them.
- Any change to the spec 363 tab set beyond the photos tab's internal grouping.

## 7. Open questions

1. **Who authors drawings and polygons?** Default proposal: the PM tier (`PM_ROLES`) — it is planning work and the editor is desktop-shaped. But operator directive 2026-07-26 moved on-site responsibilities to `procurement_manager` (spec 330 / #766), so she may own this too. **Must be answered before U2**, and whichever way it goes, gate all three layers — affordance, server action, and RLS/RPC — per the spec 187 lesson that the middle layer is the one that gets missed.
2. **Does a zone belong to exactly one drawing?** Assumed yes (a zone is a shape _on_ a plan). A yard visible on both the site plan and the ground-floor plan would need either two zones or a zone with two renderings. Cheapest answer: two zones, and only if it actually comes up.
3. **Drawing source format.** Assumed a raster image (JPG/PNG) exported from whatever CAD/PDF the operator holds. A PDF-native path (render server-side) is a bigger unit and is not assumed here.
4. **Zone vocabulary.** `โซน A/B/C` vs real names (`ห้องถังน้ำดี`, `ลานโหลด`). The pilot's WP names suggest real names are what people actually say, so `name` is free text rather than a generated letter. The MODEL introduces no `labels.ts` term; U2 and U3's chrome (headings, the picker's empty state, the dimmed-polygon legend) will, and `labels.ts` is a serialization point across live lanes.
5. **May `wp_zones` bind a GROUP (งาน) WP, as inheritance?** Binding `งานพื้นลาน` once and having its four งานย่อย inherit would cut authoring sharply. Against it: photos cannot exist on a group WP at all (see §3), so a parent binding is purely a resolution rule for children — real behaviour, but more code than a flat leaf-only join. **Default assumption: leaf-only in U1**, with inheritance as a later unit if authoring proves tedious in practice.

## 8. How this gets judged

Written up front so the verdict is data, not opinion. Two weeks after U3 reaches the field:

```sql
-- zone fill on new photos, by project, since U3
select p.code,
       count(*)                              as photos,
       count(pl.zone_id)                     as with_zone,
       round(100.0 * count(pl.zone_id) / nullif(count(*),0), 1) as pct
  from public.photo_logs pl
  join public.work_packages wp on wp.id = pl.work_package_id
  join public.projects p       on p.id  = wp.project_id
 where pl.created_at > '<U3 deploy date>'
   and exists (select 1 from public.wp_zones z where z.work_package_id = wp.id)
 group by p.code order by pct;

-- did authoring happen more than once?
select p.code, count(distinct d.id) drawings, count(z.id) zones
  from public.projects p
  left join public.project_drawings d on d.project_id = p.id
  left join public.project_zones z    on z.drawing_id = d.id
 group by p.code order by zones desc;
```

- **Zone fill on WPs that have zones** is the D4/D5 test. High fill means optional-plus-sticky worked. Low fill (say under 40%) means the sticky default is not carrying it, and the "required where zones exist" option this spec declined goes back on the table — with evidence.
- **Drawings authored on more than one project** is the §1.1 test. If only the pilot ever gets zones, this spec has repeated spec 248's fate and U2 should not be extended further.

## 9. Evidence appendix

Measured on prod 2026-07-27 via `pnpm exec supabase db query --linked`.

```sql
select count(*) from public.photo_logs;                                    -- 2672
select count(distinct work_package_id) from public.photo_logs;             -- 252
select max(c), round(avg(c),1) from
  (select count(*) c from public.photo_logs group by work_package_id) x;   -- 86, 10.6
select count(*) from public.photo_logs where phase = 'defect';             -- 0
select count(answers_photo_id) from public.photo_logs;                     -- 0
select revision_reason, count(*) from public.approvals
 where decision = 'needs_revision' group by 1;   -- mismatch 4, incomplete 5, null 37
select count(*) from public.wp_templates;                                  -- 28 (zero readers)
select id from storage.buckets;   -- no drawings bucket exists
select column_name from information_schema.columns
 where table_name = 'projects';   -- gmap_url is the only spatial field anywhere
```
