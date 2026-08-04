# Spec 394 — เลือกรูปเข้ารายงานลูกค้า (per-photo selection for the client report)

**Status:** DESIGN APPROVED 2026-08-04 (operator, incl. a rendered mockup of the two toggles
and the zero-state). Not yet built. **U1 is a migration and the schema lane is currently held
by lane `refauto` (spec 391)** — see §9.

**Operator ask (2026-08-04, verbatim):**

> we have to have a way for pd to select 2 things, 1. starring for next project ref (in the
> future may be ranking instead) 2. selecting for client report generation

⚠️ Kept as a blockquote on purpose. As italics it spanned three lines and prettier both escaped
the `_` pair into `\_` and reflowed the `1.` into an ordered list, splitting the quote — the
`prettier-markdown-emphasis-escape` trap. A blockquote gives it nothing to pair or reflow.

**This spec covers item 2 only.** Item 1 is live work in lane `refauto` / spec 391 — see §10.
The split was confirmed by the operator after the gate-check below.

---

## 1. Why

A PD/PM reviewing photos makes **two different judgments** about the same photo:

- _"this is a good example of this KIND of work"_ — firm-wide, cross-project, permanent,
  keyed to the catalogue item. **This already exists** (⭐ `wp_catalog_reference_photos`).
- _"show this one to THIS client"_ — project-scoped, audience-facing, about one deliverable.
  **This does not exist in any form.**

A photo can be either, both, or neither. Collapsing them into one ⭐ would destroy the
distinction — the failure class the doctrine calls a status field that collapses two outcomes.

### The gap, measured

`reports.params.photos` is a **rule, not a selection**:

```ts
// src/lib/reports/params.ts
export type ReportPhotosMode = "after" | "all_phases" | "none";
```

`run-report-job.ts:77` expands that to a phase list and emits **every** photo of those phases.
There is no per-photo choice anywhere in the report path. So this is a genuinely absent
capability, not a tweak to an existing picker.

### Grounding (live, 2026-08-04 — re-measure before quoting; do not inherit)

| Fact                                  | Value                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `reports` rows all-time               | **2**, both `complete`, last `2026-07-06`                                                     |
| `deliverables` rows                   | 1                                                                                             |
| `wp_catalog_reference_photos` (⭐)    | **20**, all by นัด (`project_director`), 02:42–02:50Z 2026-08-04, across 6 items, **0 notes** |
| Live photos (`storage_path not null`) | 2,725                                                                                         |
| โพธิ์ทอง WPs                          | 379 — **319 mapped**, 60 not                                                                  |

Two readings of that table matter. Reports are **barely used**, so this should stay small and
not grow a heavy curation surface. And the ⭐ `note` column is **unused after 20 real stars** —
evidence against adding a caption field here (§8).

---

## 2. Decisions (operator, 2026-08-04)

| #   | Decision                                                                                                                                | Rejected alternative                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Selection is **curated per PROJECT** — a standing set built while reviewing. Every later report uses whatever is marked at that moment. | Per-report frozen lists (puts a large selection task in front of every generation); one hero photo per WP (cannot show a before/after pair). |
| D2  | Both picks live on **`/review`, side by side** — one review pass, two independent toggles.                                              | A separate curation page (a second pass over the same photos).                                                                               |
| D3  | A **4th report mode `เฉพาะที่เลือก`**; the existing three are untouched.                                                                | "Marked set silently wins when non-empty" — the same button would produce very different documents from invisible state.                     |
| D4  | **No ordering.** The report keeps its existing per-WP order; marking decides only _which_.                                              | PD-arranged sequence (drag ordering on a phone, plus undefined behaviour when a photo is unmarked or superseded).                            |
| D5  | Gate is **`PM_ROLES`** — PM selects too, not only PD.                                                                                   | PD-only (would make every report a two-person handoff).                                                                                      |

---

## 3. Data model

```sql
create table public.report_selected_photos (
  photo_log_id  uuid primary key references public.photo_logs(id) on delete cascade,
  selected_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now()
);
```

**Why its own table, keyed by photo.** Three constraints force this shape:

1. **It cannot be a column on `photo_logs`.** That table is genuinely append-only — trigger
   `photo_logs_block_update` (verified live) raises on UPDATE. A mutable flag there is
   impossible, not merely discouraged.
2. **It cannot share `wp_catalog_reference_photos` via a `purpose` column.** The natural keys
   differ — that table keys on `wp_catalog_item_id` (cross-project), this one on the project.
   One of them would become a nullable column policed by a CHECK: the mixed-content reference
   column CLAUDE.md bans. It would also re-collapse the distinction §1 exists to preserve, and
   put this work inside the object lane `refauto` is actively editing.
3. **`project_id` is deliberately NOT stored.** It is derivable (`photo → work_package →
project`) and storing it creates a second source of truth needing a trigger to stay honest.
   The per-project count needs one join; that is cheap and always correct.

This mirrors the existing `wp_catalog_hidden_reference_photos` shape exactly
(`photo_log_id`, actor, `created_at`) — the established house pattern for "a PD marks a photo".

**RLS:** enabled, own SELECT policy for `PM_ROLES` scoped by project visibility; **no INSERT or
DELETE grant to `authenticated`**. All writes go through the DEFINER RPCs below, mirroring how
starring works.

---

## 4. RPCs

```
select_report_photo(p_photo_log_id uuid)   returns jsonb
unselect_report_photo(p_photo_log_id uuid) returns jsonb
```

Both `SECURITY DEFINER`, `set search_path = public`.

**Gate: `PM_ROLES` = `project_manager` + `super_admin` + `project_director`** — that constant
already contains exactly the three roles D5 asks for, so **no new `*_ROLES` export is created**.
That is not incidental: a new export in `role-home.ts` trips the spec-316 CAPABILITY_REGISTRY
bijection guard, and reusing the existing set avoids it entirely.

⭐ **The asymmetry with starring is deliberate and must not be "harmonised" later.** Verified
live, `star_reference_photo`, `unstar_reference_photo`, `hide_reference_photo` and
`map_wp_to_catalog` all gate on `('project_director','super_admin')`. So a `project_manager`
gains report selection but **not** catalogue starring: choosing what one client sees is a
narrower, per-project act than declaring a firm-wide exemplar for a work type.

**Refusals** reuse the star RPC's vocabulary so the action layer's honest-copy mapping is shared
rather than re-invented:

| Condition                                                | SQLSTATE | Copy class                       |
| -------------------------------------------------------- | -------- | -------------------------------- |
| Caller not in `PM_ROLES`                                 | `42501`  | permanent — never says "ลองใหม่" |
| Unknown photo                                            | `22023`  | permanent                        |
| Photo superseded, or tombstoned (`storage_path is null`) | `22023`  | permanent                        |

Re-selecting an already-selected photo is a **no-op returning `changed:false`**, not an error
(the star RPCs' idempotence contract). Both RPCs write an `audit_log` row.

---

## 5. UI — the `/review` toggle

`PhaseGallery` already takes an optional `starring` prop (`phase-gallery.tsx:30`, rendered at
`:109` behind `starring && url`) and draws `ReferenceStarButton` at `absolute top-1 right-1`
(`h-10 w-10`, dark scrim). Add a **second, independent prop** and a sibling `ReportSelectButton`
at `top-1 right-12` — the star occupies 4→44px from the right, so the new button sits at 48→88px
with a 4px gap — and neither prop knows about the other:

```ts
reportSelection?: {
  projectId: string;
  workPackageId: string;
  selectedPhotoIds: string[];   // mirrors starring.starredPhotoIds
};
```

Same shape as `starring` on purpose: the page already assembles that data once per WP, and a
matching shape means the second toggle adds a query, not a pattern.

- **Glyph/state:** `FileText` (verified present in the installed lucide), filled
  `text-done-edge` when selected, plain white when not. Distinct from the star's amber at a
  glance. `--color-done-edge` already exists, so the phantom-token guard passes.
- **Labels:** `เลือกใช้ในรายงานลูกค้า` / `เอาออกจากรายงานลูกค้า`. Explicitly **ลูกค้า** —
  "รายงาน" alone collides with the procurement reports at `/requests/reports`.
- **Independent props are load-bearing**, because the two gates and preconditions differ:
  - a `project_manager` sees the report toggle and **no star** (PD-tier only);
  - on an **unmapped** WP nobody sees a star (starring needs a catalogue mapping) but the report
    toggle still works — that is 60 of โพธิ์ทอง's 379 WPs today.
    Two independent props make both cases fall out; one combined condition would need re-deriving.
- **Every phase is selectable** (before/during/after). Deliberate: it lets PD put a before/after
  pair in front of a client, which no phase-rule mode can express.
- Error handling mirrors the star exactly: inline `role="alert"`, permanent refusals get honest
  copy.

---

## 6. Report wiring

`ReportPhotosMode` gains `"selected"`. `parseReportParams` accepts it and still falls back to the
existing default for anything unknown — the 2 historical rows and every legacy caller are
untouched by construction.

In `run-report-job`, `"selected"` takes a different source: the project's selected photos rather
than a phase list. WP grouping is unchanged; photos carry their phase label (as `all_phases`
does), since a selected set can span phases. WPs with nothing selected are omitted
(`includeEmptyWorkPackages` stays false).

The generate form gains a 4th option showing the live count, **disabled at zero** with
`ยังไม่ได้เลือกรูป`.

---

## 7. Edge cases (decided here, not discovered later)

- **Superseded / tombstoned photo:** excluded at read time by the same anti-join every other
  photo surface uses (ADR 0009). A selection never resurrects a removed photo, and the row is
  left in place rather than cleaned up — the photo may be superseded by a corrected upload.
- **Zero selected:** the form disables the option. If `"selected"` still arrives (stale form,
  direct call), `generateReport` **refuses before inserting a row**. It must NOT silently fall
  back to `after` — that hands someone a document they did not ask for — and must not queue a
  job that produces an empty PDF.
- **Photo deleted:** `on delete cascade` removes the selection.
- **WP unmapped or re-mapped:** irrelevant here. Report selection is project-scoped and has no
  catalogue dependency — unlike starring, which spec 391 moves stars for.

---

## 8. Deliberately out of scope

- **No `note`/caption column.** The ⭐ table has one and it is unused after 20 real stars. Add it
  when someone asks for a caption, not before.
- **No ordering column** (D4). Additive later; nothing here forecloses it.
- **No client-facing surface change.** `/client/[projectId]` is untouched; this spec only changes
  what the generated PDF contains.
- **No bulk "select all in this WP".** Ship the single toggle first and see whether the tap count
  is actually a problem — 20 stars took 8 minutes.

---

## 9. Units

⭐ **U2 and U3 ship together, deliberately.** U2 alone would add a toggle that changes nothing a
user can see; U3 alone would add a report mode that can never be enabled because nothing can be
selected. Either half on its own is an affordance that promises something not built. U1 is
separable because it is invisible.

| Unit      | Scope                                                                                                                          | Merge posture                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1**    | Migration: table + RLS + the two DEFINER RPCs + pgTAP.                                                                         | **Danger path** (migration) ⇒ operator merge or grant self-merge on green. **Blocked on the schema lane** — held by `refauto`; live head `20260813075900`, `main` at `075896`. Claim = live head + 1, re-queried at build time. |
| **U2+U3** | `ReportSelectButton` + the `reportSelection` prop + the 4th report mode + `run-report-job` branch + the disabled-at-zero form. | Code-only ⇒ auto-merges on green.                                                                                                                                                                                               |

### Verification

**U1 (pgTAP).** Both RPCs refuse a `site_admin` with `42501` **and** a positive control that a
`project_manager` succeeds in the same transaction — the pair is what distinguishes "the gate
works" from "the RPC refuses everyone". `22023` on a superseded photo. No INSERT/DELETE grant to
`authenticated`. Re-select is idempotent (`changed:false`, no second row). Cascade on photo
delete. `plan(N)` must equal the emitted count.

**U2+U3 (vitest).** `parseReportParams` round-trips `"selected"` and still defaults on garbage;
the pure selected-set builder; RTL on the toggle (both states, the disabled/absent cases for a
PM and for an unmapped WP); the option disabled at zero. Mutation-check each new assertion.

**Real-flow (gate 4).** Select photos on `/review` as a real PD, generate with `เฉพาะที่เลือก`,
download the PDF, confirm it holds **exactly** those photos and no others — then unselect one and
confirm it leaves. A green suite is not evidence the PDF changed.

**Acceptance is a fill rate, not a suite.** After a week of real use,
`select count(*) from report_selected_photos` and the share of `reports.params->>'photos' =
'selected'`. Zero selections after real reviews means the toggle is not discoverable and the unit
did not land — the same test applied to every write-path feature.

---

## 10. Relationship to spec 391 (lane `refauto`, in flight)

Spec 391 is rebuilding the **starring** half — item 1 of the operator's ask — and at the time of
writing has three migrations applied to live but not on `main` (`075898`–`075900`). Read live,
`get_wp_reference_photos` now returns **two tiers**: explicit stars first, then an automatic set
drawn from completed mapped WPs (`after`/`after_fix`, highest rework round, self excluded),
capped at 4, with `wp_catalog_hidden_reference_photos` suppressing either.

Two consequences for this spec:

- **No overlap.** 394 touches no catalogue object, no `get_wp_reference_photos`, and no file
  391 owns. The only shared surface is `PhaseGallery`, and only by adding a prop beside the
  existing one.
- **The operator's "may be ranking instead" is partly answered by 391 already** — tier +
  recency IS a ranking, and starring is becoming a _promotion_ over an automatic baseline rather
  than the only way in. Do not design ranking into 394.

⚠️ **A stale premise worth carrying to 391:** its lane block states
`wp_catalog_reference_photos` is "0 rows all-time". That was true when written and is false now —
the real PD starred 20 photos across 6 items on 2026-08-04. A spec whose case is _"don't add
unnecessary workload to pd"_ should account for the PD having already started hand-picking.

---

## 11. Open questions for the operator

1. Should a **client-visible** surface ever show the selected set (e.g. `/client/[projectId]`),
   or is this purely an input to the generated PDF? Assumed PDF-only.
2. When a report has already been generated and PD then changes the selection, should anything
   flag that the delivered PDF no longer matches the current set? Assumed no — reports are a
   point-in-time artifact.
