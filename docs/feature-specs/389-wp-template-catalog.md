# Spec 389 — WP template catalogue + reference stars (แคตตาล็อกงานมาตรฐาน + รูปตัวอย่าง)

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

That identity now exists: the **Vol.5 code** (`S-02-14`, `PR-01-03`, …) built this session on
the โพธิ์ทอง sheet — 54 main WPs + 401 sub-WPs, prefix = work category, verified row-by-row
against Vol.4 (455 unique codes, zero duplicates).

## 2. Live measurements (2026-08-03, all queried this session)

- Projects: `TFM โพธิ์ทอง ลพบุรี` active **379 WPs** (47 groups + 332 leaves, 2-level via
  `parent_id`/`is_group`) · `TFM นายาว เพชรบูรณ์` active **0 WPs** · `TFM กกกระทอน เพชรบูรณ์`
  active **0 WPs**.
- Photos: โพธิ์ทอง holds **2,526 `photo_logs` rows over 241 of 379 WPs**.
- Name bridge Vol.5 → live โพธิ์ทอง WPs (via the sheet's OldID → Vol.2 name → live `name`,
  whitespace-normalised): **328 of 455 rows auto-match** (72%), reaching **209 photo-carrying
  WPs / 2,176 photos (86% of the archive)**. **25 rows** have an OldID whose name drifted
  (manual match) · **102 rows** are new work with no โพธิ์ทอง counterpart · **26 live โพธิ์ทอง
  WPs** were dropped by Vol.4 and get no code.
- `work_packages` columns (live): `id, project_id, code, name, description, status, created_at,
updated_at, deliverable_id, owner_id, contractor_id, notes, priority, planned_start,
planned_end, category_id, rework_round, is_group, parent_id`. **No template/catalogue column
  exists.**
- `photo_logs` columns (live): `id, work_package_id, phase, storage_path, superseded_by,
uploaded_by, created_at, captured_at_client, rework_round, answers_photo_id`. Append-only,
  supersede pattern (ADR 0004/0009). **No approval state on the photo row** — approvals are
  WP-level.
- `work_categories` (live): top-level **W01–W09 only**. Vol.5 uses prefixes `O` (งานอื่นๆ) and
  `SIS` (งานระบบความปลอดภัย) → **W10 and W11 must be added**. ⚠️ An uncommitted, unapplied
  migration draft (`20260801213910_work_categories_code_prefix.sql`, sitting in the main repo
  working tree, author unknown) adds a `code_prefix` column + seeds W01–W09 prefixes + W10.
  This spec's U1 subsumes it (and adds W11); that stray file must not ship separately.
- `user_role` enum (live, 17 values): includes `project_director`. The importer precedent for
  seeding WPs is `scripts/import-wp.ts` (ADR 0014) — **flat `code,name,description` only, no
  parent column**; โพธิ์ทอง's live tree used codes `WP-01`/`WP-01-01`, a different scheme from
  Vol.5.

## 3. Design decisions

- **D1 — The catalogue is the identity.** New table `wp_templates`: one row per Vol.5 code,
  2-level (`parent_id`, `is_group`), `prefix` + `category_id` FK (prefix→W-code via the sheet's
  Prefix Mapping). `work_packages.template_id` (nullable FK) ties every project's WP instance to
  its template. Reference = "all projects' WPs sharing this template", never a project pair.
- **D2 — Stars attach to (photo, template).** New table `wp_template_reference_photos`:
  `template_id · photo_log_id · starred_by · note (nullable, one line) · created_at`, unique on
  `(template_id, photo_log_id)`. A photo starred anywhere surfaces on every project's WP of that
  template, forever. Better photo found later ⇒ new star; deprecated ⇒ un-star (hard delete —
  curation, not history; the photo itself is untouched).
- **D3 — Starring is PD-tier.** `project_director` + `super_admin` may star/un-star (DEFINER
  RPCs `star_reference_photo` / `unstar_reference_photo`; `authenticated` gets no direct write).
  Everyone who can see a WP can see its ตัวอย่างงาน section — that is the point: the SA/ช่าง
  holding a phone at the pour is the consumer. The cross-project read is **narrow by
  construction**: only starred photos of the same template code, rendered read-only with a
  source-project tag; never a door into the other project's pages.
- **D4 — PD maps legacy projects once; new projects never need mapping.** โพธิ์ทอง backfill: the
  name bridge pre-fills 328 confident matches as **suggestions**; a PD surface confirms them and
  hand-matches the 25 drifted + triages the 26 dropped (map to a code or leave unmapped). New
  projects are instantiated FROM the catalogue, so `template_id` is set at birth.
- **D5 — Template carries knowledge; stars carry images.** Duration / manpower / method notes
  (the empty Vol.4 planning columns) belong ON `wp_templates` as later columns — per-code facts,
  not per-project picks. Out of scope here except the columns' home being established.
- **D6 — Vol.5 is the seed, with its defects surfaced not silently fixed.** The import refuses
  duplicate codes (sheet re-verified at import time). Known open sheet items the operator owns:
  the `X-01 งานเพิ่มเติม` placeholder prefix, `PR-02 (WP-420)` empty twin group, `WP-264`'s
  mixed S/EX children, the `WP-474` copy-paste name. Import proceeds with the sheet as-is
  (placeholder `X` maps to W10 until re-coded); fixes land in the sheet and re-import upserts by
  code.

## 4. Schema (U1, additive, single migration)

- `work_categories`: insert `W10 งานอื่นๆ` + `W11 งานระบบความปลอดภัย`; add `code_prefix text`
  seeded for W01–W11 (`PR S A PL E H SG EX F O SIS` — the sheet's Prefix Mapping tab).
- `wp_templates`: `id uuid pk · code text unique not null · name text not null · prefix text
not null · category_id uuid fk work_categories · parent_id uuid fk self · is_group boolean ·
source_note text · is_active boolean default true · created_at/updated_at`. RLS: SELECT for
  `authenticated`; writes via import path (service-role) + curator RPC later.
- `work_packages.template_id uuid` nullable FK → `wp_templates`, index. Set by seed (new
  projects) and by the mapping RPC (legacy).
- `wp_template_reference_photos`: as D2. RLS: SELECT `authenticated`; INSERT/DELETE none —
  writes only via the two DEFINER RPCs (PD+super_admin gate, coalesce-hardened role check,
  42501 otherwise). pgTAP: role-gate probes with positive control, star/unstar round-trip,
  unique violation, FK integrity, RLS read scope.

## 5. Units

- **U1 — schema** (migration, schema lane, danger-held ⇒ grant self-merge on green): §4 + pgTAP.
- **U2 — catalogue seed** (script, service-role seam like `import-wp.ts`): Vol.5 TSV → 455
  `wp_templates` rows (2-level, upsert by code). Verification: count 54 groups / 401 leaves,
  every leaf's parent resolves, prefix↔category consistent.
- **U3 — instantiate the 2 new projects**: create `work_packages` for นายาว + กกกระทอน from the
  catalogue (code = template code, name, category, parent tree, `template_id` set). Extends the
  import path to tree-aware; ADR 0014 amendment. Acceptance: both projects show the full tree in
  the app; `template_id` fill = 100%.
- **U4 — PD mapping surface** (โพธิ์ทอง backfill): a PD-gated page listing live โพธิ์ทอง WPs
  with the bridge's suggestion pre-selected (328 auto, confidence = exact name match), confirm /
  re-pick / leave-unmapped per row; writes via a DEFINER RPC (PD+super_admin). Acceptance is a
  fill rate: `template_id` on โพธิ์ทอง moves from 0 toward ~353 of 379.
- **U5 — stars + ตัวอย่างงาน**: ⭐ affordance on photo views for PD/super_admin (WP detail,
  review surfaces); WP detail gains a ตัวอย่างงาน section — starred photos of the same
  `template_id` across all projects, newest first, source-project chip, supersede-aware read
  (anti-join, ADR 0009), section hidden when empty. Acceptance is a fill rate: star count > 0
  and the section renders on a นายาว WP showing a โพธิ์ทอง photo.

Sequence: U1 → U2 → U3 unblocks the field (projects usable); U4, U5 follow. U4 and U5 are
independent of each other but both need U1+U2; U5 is only USEFUL after U4 maps โพธิ์ทอง (the
photos all live there today).

### Negative cases / error copy / recovery (per unit, index rule)

- **U2/U3 (import, operator-run script):** duplicate code in the sheet → refuse the whole file,
  name the rows (script output, no UI); unknown prefix → refuse, name the row; parent missing →
  refuse. Recovery: fix the sheet, re-run (upsert by code = idempotent). Target project already
  has WPs → refuse unless `--force-empty-check-off`; never partial-import.
- **U4 (mapping):** RPC gate → non-PD caller gets 42501, UI never shows the surface to other
  roles (`PD_ROLES`-style set + route gate, affordance == action == RPC, the three-layer rule).
  Suggestion rejected then re-picked → last write wins, audit row per change. Empty state: "ไม่มี
  WP ที่ยังไม่จับคู่" when all mapped.
- **U5 (stars):** star on a superseded photo → RPC refuses (`ไม่สามารถปักดาวรูปที่ถูกแทนที่แล้ว`);
  duplicate star → unique violation mapped to a no-op success (idempotent star); un-star a photo
  someone else starred → allowed (PD tier is small, curation is shared); ตัวอย่างงาน section with
  zero stars → renders NOTHING (no empty-state nag). Photo file missing from storage → the
  existing photo-render fallback, never a broken tile. Strings used on 2+ surfaces →
  `labels.ts`.

## 6. Acceptance (fill rates, re-run at ship time)

- `select count(*) from wp_templates` = 455 (54 groups / 401 leaves).
- `select count(*), count(template_id) from work_packages where project_id in (นายาว, กกกระทอน)`
  — equal, > 0.
- โพธิ์ทอง mapping: `count(template_id)` moves toward ~353/379; the 26 dropped stay NULL by
  PD's explicit choice, not by omission.
- Stars: `count(*) from wp_template_reference_photos` > 0 within the first week of U5; zero
  after a week ⇒ the affordance is misplaced (spec-339-U1 class), re-measure where PD actually
  reviews photos.

## 7. Out of scope / open questions

- Template knowledge columns (duration, manpower, risk, difficulty — the empty Vol.4 columns):
  home established (D5), population later.
- Starring non-photo information (documents, notes beyond the one-liner): later; the operator's
  "information" beyond images rides on template columns (D5).
- Whether `wp_templates` growth needs a curator surface (add/retire codes without a sheet
  re-import): later unit, after the first real "new WP mid-project" case.
- 🔔 Operator owns (sheet, not code): X-01 prefix decision · PR-02/WP-420 twin · WP-264 S/EX
  split · WP-474 name · whether Vol.5 rows get sorted by code.
- The 26 โพธิ์ทอง WPs dropped by Vol.4: PD decides map-or-leave in U4; leaving them unmapped
  keeps their photos out of every reference gallery (deliberate).
