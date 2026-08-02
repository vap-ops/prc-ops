# Spec 389 — WP catalogue + reference stars (แคตตาล็อกงานมาตรฐาน + รูปตัวอย่าง)

**Status:** Draft — units not started
**Origin:** Operator, 2026-08-03: _"We are having 2 new projects"_ → the Vol.4/Vol.5 recode
session on the โพธิ์ทอง WP sheet, then: _"we gotta have to find a way to refer to the old WPs
from โพธิ์ทอง … for the sake of referring to the old information, like sample images"_, refined
to: _"PD can map new WP against previous project's WP. Then PD can pick the images and
information that they want referenced"_, and finally the multi-project correction that set the
design: _"we will continue to make this sort of building for multiple times, there will be times
we find better images from various projects, not just one. … How about giving stars to good
images, then PD can refer to the starred ones?"_ Project scale note, verbatim: _"this is 16m
size"_.

## 1. The problem

PRC builds the same building repeatedly (TFM branches). Project #2 and #3 exist in prod **with
zero work packages**, while project #1 (โพธิ์ทอง) holds the full history — 379 WPs and 2,526
photos — that the new sites' SAs and PDs need as reference ("what does งานวางเหล็กเสริม look
like when done right?").

A naive project-to-project link (`นายาว.wp → โพธิ์ทอง.wp`) dies at project #3: every new project
must be hand-pointed at one predecessor, and a better photo taken at นายาว never becomes
reference material for กกกระทอน. The operator's star model fixes this **only if the star hangs
on a cross-project identity**, not on a project pair.

That identity now exists on paper: the **Vol.5 code** (`S-02-14`, `PR-01-03`, …) built this
session on the โพธิ์ทอง sheet — 54 main WPs + 401 sub-WPs, prefix = work category. This spec
gives it a DB home, in the app's existing catalogue family: `catalog_items` (materials),
`equipment_catalog_items` (equipment SKUs) → **`wp_catalog_items` (work-type SKUs)**. A WP
instance points at its work-type exactly as an `equipment_items` row points at its SKU.

### Prior art — read before objecting "this exists" (fact-checked 2026-08-03)

- **`wp_templates` is a RETIRED name** — dropped 2026-07-27 by break-glass migration
  `20260813075857` (never used, dead taxonomy on the wrong axis, bypassed
  `create_work_package`). Six specs cross-reference the retirement. This spec deliberately does
  NOT reuse the name; the new table is a different shape doing a different job (identity, not
  phase-seeding), and this paragraph is the required acknowledgement.
- **`boq_template` / `boq_line` (spec 236, live, 0 rows) is the ESTIMATE grain** — a priced
  document (material_rate/labor_rate per line), firm-wide reusable as a _document_. It is not a
  per-work-type identity: lines belong to one template document, carry money, and have no
  tree/code identity. S10-U6 ("WP seeding from a `boq_template`") stays untouched; when it
  arrives it seeds WPs _from a priced estimate_, and those WPs can carry `wp_catalog_item_id`
  like any others. The two axes compose, they don't compete.
- **Cross-project WP mechanisms that already exist**: `clone_work_packages(src,dst)` (DEFINER +
  shipped UI, copies code/name/description, `on conflict do nothing`), `clone_wp_briefs_from_project`,
  and `import_wp_grouping(p_project_id, p_rows jsonb)` (DEFINER, super_admin, `{sub_of, code,
old_code, name}`, tree-aware — built for the spec-270 recode). All of them COPY; none leaves a
  persistent link between the copies. The catalogue id is that link. U3 builds on
  `import_wp_grouping`, not on a new importer.

## 2. Live measurements (2026-08-03, queried this session; re-confirmed by the fact-check pass)

- Projects: `TFM โพธิ์ทอง ลพบุรี` active **379 WPs** (47 groups + 332 leaves, strictly 2-level)
  · `TFM นายาว เพชรบูรณ์` active **0 WPs** · `TFM กกกระทอน เพชรบูรณ์` active **0 WPs**.
- Photos: โพธิ์ทอง holds **2,526 `photo_logs` rows over 241 of 379 WPs**.
- ⚠️ `work_packages.category_id` FKs **`project_categories`** (per-project, 8 rows on โพธิ์ทอง,
  **0 rows on both new projects**), NOT `work_categories`. `create_work_package` rejects a
  category not active-in-the-same-project (22023). Any instantiation must create the target
  project's `project_categories` first.
- ⚠️ `wp_hierarchy_guard` (BEFORE INSERT/UPDATE on `work_packages`): `is_group` immutable · a
  group cannot have a parent · once a project has groups, a new leaf MUST have a parent (23514)
  · groups insert `not_started`. `create_work_package` cannot set `is_group` at all — the tree
  is built only via `import_wp_grouping` or service-role inserts.
- `photo_logs` live columns: `id, work_package_id, phase, storage_path, superseded_by,
uploaded_by, created_at, captured_at_client, rework_round, answers_photo_id` — append-only,
  supersede pattern (ADR 0004/0009). No approval state on the photo row (approvals are WP-level;
  photo-level _revision targeting_ lives in `approval_revision_targets`, not on the row).
- ⚠️ `photo_logs` SELECT RLS = `can_see_wp()` → `can_see_project()`: **false outright for
  `technician`**, membership-gated for SA/PM/auditor. A นายาว SA cannot read a โพธิ์ทอง photo
  row, and photo bytes are served via server-minted signed URLs. **The reference read (U5) is
  therefore a DEFINER RPC + server-side mint, specified in §4 — without it D3 is false.**
- `work_categories`: top-level **W01–W09 only**, no `code_prefix` column. Vol.5 uses prefixes
  `O` (งานอื่นๆ) and `SIS` (งานระบบความปลอดภัย) ⇒ U1 adds W10+W11+`code_prefix`. ⚠️ An
  uncommitted stray draft (`20260801213910_work_categories_code_prefix.sql`, main repo working
  tree, author unknown) adds `code_prefix`+W10 only; U1 subsumes it — that file must not ship
  separately.
- `user_role` (17 values) includes `project_director`.
- Sheet-derived figures (Vol.5): 455 codes = 54 main + 401 sub, verified against Vol.4
  in-session; name bridge to live โพธิ์ทอง WPs: **328 auto-match → 209 photo-carrying WPs /
  2,176 photos (86% of the archive)**, 25 name-drifted, 102 new work, 26 live WPs dropped by
  Vol.4. ⚠️ These are session-verified but have **no repo artefact yet** — U2 lands the Vol.5
  TSV under `data/` so acceptance is checkable, and re-verifies the counts at import time.

## 3. Design decisions

- **D1 — The catalogue is the identity.** `wp_catalog_items`: one row per Vol.5 code, 2-level
  (`parent_id`, `is_group`), `code_prefix` + `work_category_id` FK (prefix→W-code via the
  sheet's Prefix Mapping). `work_packages.wp_catalog_item_id` (nullable FK) ties every project's
  WP instance to its work-type — the `equipment_items.equipment_catalog_item_id` precedent at WP
  grain. Reference = "all projects' WPs sharing this work-type", never a project pair.
- **D2 — Stars attach to (photo, catalogue item).** `wp_catalog_reference_photos`:
  `wp_catalog_item_id · photo_log_id · starred_by · note (nullable, one line) · created_at`,
  unique on the pair. A photo starred anywhere surfaces on every project's WP of that work-type,
  forever. Better photo later ⇒ new star; deprecated ⇒ un-star (hard delete — curation, not
  history; the photo row is untouched).
- **D3 — Starring is PD-tier; viewing is everyone-on-the-WP.** `project_director` + `super_admin`
  star/un-star via DEFINER RPCs. The ตัวอย่างงาน section renders for anyone who can see the WP —
  the SA/ช่าง holding a phone at the pour is the consumer. Because `photo_logs` RLS blocks
  cross-project reads (§2), the section reads through `get_wp_reference_photos` (§4) — a DEFINER
  read returning ONLY starred, non-superseded photos of one catalogue item, with source-project
  name; bytes via the existing server-side signed-URL mint (service-role seam — the mint is
  scoped to exactly the storage paths that RPC returned). Never a door into the other project's
  pages.
- **D4 — PD maps legacy projects once; new projects never need mapping.** โพธิ์ทอง backfill: the
  name bridge pre-fills 328 matches as **suggestions**; a PD surface confirms them and
  hand-matches the 25 drifted + triages the 26 dropped (map or leave unmapped). New projects are
  instantiated FROM the catalogue, so the id is set at birth.
- **D5 — Catalogue carries knowledge; stars carry images.** Duration / manpower / method notes
  (the empty Vol.4 planning columns) belong ON `wp_catalog_items` as later columns — per-code
  facts, not per-project picks. Out of scope here except the home being established.
- **D6 — Vol.5 is the seed, with its defects surfaced not silently fixed.** The seed script
  refuses duplicate codes and unknown prefixes, naming the rows. Known open sheet items the
  operator owns: the `X-01 งานเพิ่มเติม` placeholder prefix, `PR-02 (WP-420)` empty twin group,
  `WP-264`'s mixed S/EX children, the `WP-474` copy-paste name. Import proceeds with the sheet
  as-is (placeholder `X` → W10 until re-coded); fixes land in the sheet and the seed re-runs
  (idempotent by code — the SCRIPT upserts `wp_catalog_items`; this does not touch the
  `wp-import/parse.ts` contract, which refuses existing codes and stays unchanged).

## 4. Schema (U1, additive, single migration)

- `work_categories`: insert `W10 งานอื่นๆ` + `W11 งานระบบความปลอดภัย`; add `code_prefix text`
  seeded for W01–W11 (`PR S A PL E H SG EX F O SIS`).
- `wp_catalog_items`: `id uuid pk · code text unique not null · name text not null ·
code_prefix text not null · work_category_id uuid fk work_categories · parent_id uuid fk self
· is_group boolean not null default false · source_note text · is_active boolean not null
default true · created_at/updated_at (shared set_updated_at)`. RLS: SELECT `authenticated`
  (firm-wide library, the `boq_template`/spec-221-D8 posture); no direct write grant — writes
  via the seed script (service-role) now, curator RPC later.
- `work_packages.wp_catalog_item_id uuid` nullable FK → `wp_catalog_items`, indexed. Set by U3
  (new projects) and the U4 mapping RPC (legacy).
- `wp_catalog_reference_photos`: as D2. RLS: SELECT `authenticated`; no INSERT/DELETE grants —
  writes only via `star_reference_photo(p_photo_log_id, p_note default null)` /
  `unstar_reference_photo(p_photo_log_id)` (DEFINER, `set search_path = public`, role captured
  once, coalesce-hardened null-safe gate → 42501, `revoke … from public, anon`, grant
  `authenticated`; the star RPC derives `wp_catalog_item_id` from the photo's WP and refuses a
  photo whose WP has none, or a superseded photo).
- `get_wp_reference_photos(p_wp_catalog_item_id)` — DEFINER read: starred, non-superseded
  (anti-join, ADR 0009) photos of that item across all projects, with source project name +
  starred_by + note, newest star first. Grant `authenticated` (the star table is
  world-readable anyway; this RPC exists to cross the `photo_logs` RLS wall in a shape narrower
  than any policy widening).
- pgTAP: role-gate probes with a positive control (`has_function_privilege` house pattern) ·
  star/unstar round-trip · superseded-photo refusal · unmapped-WP refusal · unique pair ·
  reader returns the starred photo to a caller with NO project membership and does NOT return
  unstarred/superseded ones.

## 5. Units

- **U1 — schema** (migration, schema lane — claim = live head+1 queried at claim time,
  danger-held ⇒ grant self-merge on green): §4 + pgTAP.
- **U2 — catalogue seed** (script + repo artefact): land `data/wp-catalog-vol5.tsv` (455 rows,
  the sheet's Code/SubOf/Prefix/WPName/OldID columns) + `scripts/import-wp-catalog.ts`
  (service-role seam like `import-wp.ts`; upsert by code; refuse dup codes / unknown prefix /
  unresolvable parent, naming rows). Verification: 54 groups / 401 leaves, every leaf's parent
  resolves, prefix↔category consistent — counts re-derived from the DB, not the sheet.
- **U3 — instantiate the 2 new projects**: for นายาว + กกกระทอน, create the needed
  `project_categories` rows (both have 0 — §2), then build the 2-level `work_packages` tree
  (code = catalogue code, name, category, parent, `wp_catalog_item_id`). Path: gate-check
  `import_wp_grouping`'s live body first — extend it (or follow-up UPDATE keyed by code for the
  catalogue id + category) rather than writing a new importer; the hierarchy guard (§2) rules
  out `create_work_package`. Acceptance: both projects show the full tree in the app;
  `wp_catalog_item_id` fill = 100%.
- **U4 — PD mapping surface** (โพธิ์ทอง backfill): PD-gated page listing live โพธิ์ทอง WPs with
  the bridge suggestion pre-selected (exact-name matches), confirm / re-pick / leave-unmapped
  per row; writes via a DEFINER RPC (PD+super_admin), audit row per change. Acceptance is a
  fill rate: `wp_catalog_item_id` on โพธิ์ทอง moves from 0 toward ~353 of 379.
- **U5 — stars + ตัวอย่างงาน**: ⭐ affordance on photo views for PD/super_admin (WP detail,
  review surfaces); WP detail gains a ตัวอย่างงาน section reading `get_wp_reference_photos`
  for the WP's catalogue item — source-project chip, newest first, hidden when empty.
  Acceptance is a fill rate: star count > 0 and the section renders on a นายาว WP showing a
  โพธิ์ทอง photo **to a principal with no โพธิ์ทอง membership**.

Sequence: U1 → U2 → U3 unblocks the field (projects usable); U4, U5 follow. U4 ∥ U5 (both need
U1+U2); U5 is only USEFUL after U4 maps โพธิ์ทอง (the photos all live there today).

### Negative cases / error copy / recovery (per unit, index rule)

- **U2/U3 (import, operator-run script):** duplicate code → refuse whole file, name rows;
  unknown prefix / unresolvable parent → refuse, name row. Recovery: fix sheet, re-run (upsert
  = idempotent). Target project already has WPs → refuse; never partial-import.
- **U4 (mapping):** non-PD caller → 42501; the surface is route-gated to the same set
  (affordance == action == RPC, all three layers). Re-pick after confirm → last write wins,
  audit row per change. Empty state: `ไม่มี WP ที่ยังไม่จับคู่` when all mapped.
- **U5 (stars):** star a superseded photo → RPC refuses (`ไม่สามารถปักดาวรูปที่ถูกแทนที่แล้ว`);
  star a photo on an unmapped WP → refuses (`งานนี้ยังไม่ได้จับคู่กับแคตตาล็อก`); duplicate star
  → idempotent success; un-star another PD's star → allowed (curation is shared). ตัวอย่างงาน
  with zero stars → renders NOTHING. Missing storage object → existing photo-render fallback,
  never a broken tile. Strings on 2+ surfaces → `labels.ts`.

## 6. Acceptance (fill rates, re-run at ship time)

- `select count(*) from wp_catalog_items` = 455 (54 groups / 401 leaves) — after U2.
- `select count(*), count(wp_catalog_item_id) from work_packages where project_id in (นายาว,
กกกระทอน)` — equal, > 0 — after U3.
- โพธิ์ทอง mapping: `count(wp_catalog_item_id)` → ~353/379; the 26 dropped stay NULL by PD's
  explicit choice, not by omission — after U4.
- Stars: `count(*) from wp_catalog_reference_photos` > 0 within the first week of U5; zero
  after a week ⇒ the affordance is misplaced (spec-339-U1 class) — re-measure where PD actually
  reviews photos.

## 7. Out of scope / open questions

- Catalogue knowledge columns (duration, manpower, risk, difficulty): home established (D5),
  population later.
- Curator surface (add/retire codes without a sheet re-import): later unit, after the first
  real "new WP mid-project" case.
- S10-U6 (WP seeding from a priced `boq_template`): untouched; composes with this (D-prior-art).
- 🔔 Operator owns (sheet, not code): X-01 prefix decision · PR-02/WP-420 twin · WP-264 S/EX
  split · WP-474 name · whether Vol.5 rows get sorted by code.
- The 26 โพธิ์ทอง WPs dropped by Vol.4: PD decides map-or-leave in U4; leaving them unmapped
  keeps their photos out of every reference gallery (deliberate).
