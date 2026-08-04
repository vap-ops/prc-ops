# Spec 394 — เลือกรูปเข้ารายงานลูกค้า (per-photo selection for the client report)

**Status:** DESIGN APPROVED 2026-08-04 (operator, incl. a rendered mockup of the two toggles
and the zero-state), then **AMENDED the same day by the omotenashi ruling** — see §2, which
reverses D4 and adds D6–D8 (ordering · cover note · client-readable naming). Not yet built.
**U0 (D8) can ship immediately; U1 is a migration and the schema lane is currently held by lane
`refauto` (spec 391)** — see §9.

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
| D4  | ~~No ordering.~~ **REVERSED 2026-08-04 — see D6.**                                                                                      | —                                                                                                                                            |
| D5  | Gate is **`PM_ROLES`** — PM selects too, not only PD.                                                                                   | PD-only (would make every report a two-person handoff).                                                                                      |

### The omotenashi amendment (operator, 2026-08-04)

> adding workload is ok, as long as it's omotenashi

This reverses D4 and adds D6–D8. The reading: **the client is the guest, and the report is the
guest-facing artifact**, so PD effort spent making it read as considered is justified — an
accurate but unordered dump of photos is not hospitality. Omotenashi is _considered detail_, not
more features, so this deliberately does not add everything that was on the table.

⭐ **It also draws the line against the earlier _"we don't want to add unnecessary workload to
pd"_ (spec 391).** Both statements survive together because the surfaces differ: the catalogue
reference set is **internal** (its audience is the next project's team — auto-fill serves them
fine, which is 391's whole case), while the client report is **guest-facing** and worth PD's
time. Do not carry "minimise PD work" from 391 onto this surface, or the reverse.

| #   | Decision                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D6  | **PD arranges the selected photos within each work package**, and the report follows that order. Section order across WPs stays `code` order. | Sequence is how a document reads. Within a WP it also puts a before next to its after, which the phase-grouped modes structurally cannot. Sections stay in code order because spec 389's codes are **build order** — so the report already walks the project chronologically, and re-ordering sections would break that for no gain. |
| D7  | **A cover note per report** — one free-text passage PD writes at generation time.                                                             | Often the first thing a client reads. Cheapest of the options (one field, no per-photo work) and it carries the narrative once instead of many times.                                                                                                                                                                                |
| D8  | **The PDF leads with the Thai work name; the internal code is demoted.**                                                                      | `build-pdf.ts:95` currently prints `${wp.code} — ${wp.name}`, so a client meets `S-07` before they meet the work. The client never agreed to our catalogue letters. **Costs no PD effort at all** — the section already carries both fields.                                                                                         |

⛔ **Per-photo captions were offered and declined.** Recorded so a later reader does not "fix"
the omission: the cover note carries the narrative, and a caption on every photo is per-item
labour with fast-diminishing returns. The ⭐ table's own `note` column is still unused after 20
real stars, which is the same signal one layer down.

---

## 3. Data model

```sql
create table public.report_selected_photos (
  photo_log_id  uuid primary key references public.photo_logs(id) on delete cascade,
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  position      integer not null,
  selected_by   uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  unique (work_package_id, position) deferrable initially deferred
);
```

**`position` and `work_package_id` are D6's cost.** Ordering is scoped **within a work package**
(D6), so the sequence needs a partition to be ordered inside, and reordering must be able to
shuffle several rows in one transaction — hence `deferrable initially deferred`, or every swap
would trip the unique index mid-update.

⚠️ **`work_package_id` is the one denormalisation this spec accepts, and only because it is
immutable.** A photo's WP never changes: `photo_logs` is append-only (`photo_logs_block_update`),
so `work_package_id` cannot drift the way a stored `project_id` could. It is still derivable, but
partitioning the unique index requires it in the row. The project stays derived, as in §3.3.

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
select_report_photo(p_photo_log_id uuid)                       returns jsonb
unselect_report_photo(p_photo_log_id uuid)                     returns jsonb
reorder_report_photos(p_work_package_id uuid, p_photo_ids uuid[]) returns jsonb
```

All `SECURITY DEFINER`, `set search_path = public`.

**`select_report_photo` appends** — new rows take `max(position) + 1` within the WP, so the
first-selected photo leads until PD says otherwise. **`unselect_report_photo` closes the gap**
rather than leaving a hole, so positions stay dense and the next append is predictable.

**`reorder_report_photos` takes the whole WP's list at once**, not a move-one-step call. Two
reasons: a single statement cannot leave a half-applied order, and the client sends what it
displays, so the server never has to reconstruct intent from a delta. It refuses with `22023` if
the array is not exactly the WP's current selected set — a stale client that has missed a
concurrent unselect must re-read rather than silently resurrect or drop a photo. It takes
`for update` on the WP's rows so two arranging sessions serialise.

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
(the star RPCs' idempotence contract). All three RPCs write an `audit_log` row.

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

### Arranging (D6) — no second surface

Ordering is **within a work package**, and `/review/work-packages/[workPackageId]` already shows
exactly that WP's photos. So arranging lives on the page PD is already on: below the gallery, a
compact ordered strip of just the selected photos with move-up / move-down controls, sending the
whole WP list to `reorder_report_photos`.

⭐ **Deliberately not drag-and-drop.** This is a gloved hand on a phone; a drag target that must
be grabbed precisely and held is the wrong control for the audience, and `[touch-action]` on a
horizontally scrolling strip is a known trap in this repo. Two large buttons per row are duller
and they work. Each control needs a discrete `aria-label` naming the photo's position
(`เลื่อนขึ้น รูปที่ 2`), because position is otherwise conveyed only visually.

**If nothing is selected for this WP the strip renders nothing at all** — not an empty frame with
disabled arrows.

---

## 6. Report wiring

`ReportPhotosMode` gains `"selected"`. `parseReportParams` accepts it and still falls back to the
existing default for anything unknown — the 2 historical rows and every legacy caller are
untouched by construction. `ReportParams` also gains an optional `coverNote` (D7); it lives in the
existing `reports.params` jsonb, so **the cover note needs no schema change** — and being stored
on the report rather than the project gives it the right lifetime, frozen with the document that
was actually sent.

In `run-report-job`, `"selected"` takes a different source: the project's selected photos rather
than a phase list, **ordered by `position` within each WP**. Unlike the other modes it emits
**one unlabelled group per WP**, not one group per phase — phase grouping would re-separate the
before/after pair that D6 exists to put side by side. WPs with nothing selected are omitted
(`includeEmptyWorkPackages` stays false). Section order across WPs remains `code` order (D6).

**D7 — cover note.** Rendered once, after the project header and before the first section. Absent
or blank prints nothing; no placeholder, no empty heading.

**D8 — client-readable naming.** `build-pdf.ts:95` becomes name-first with the code demoted
(smaller, secondary) rather than `${wp.code} — ${wp.name}`. The code stays on the page — it is how
PD and the client refer to the same item in conversation — but it stops being the first thing
read. This changes **every** report mode, not just `selected`, which is intended: the naming was
wrong for all of them.

The generate form gains a 4th option showing the live count, **disabled at zero** with
`ยังไม่ได้เลือกรูป`, plus the cover-note field.

---

## 7. Edge cases (decided here, not discovered later)

- **Superseded / tombstoned photo:** excluded at read time by the same anti-join every other
  photo surface uses (ADR 0009). A selection never resurrects a removed photo, and the row is
  left in place rather than cleaned up — the photo may be superseded by a corrected upload.
- **Zero selected:** the form disables the option. If `"selected"` still arrives (stale form,
  direct call), `generateReport` **refuses before inserting a row**. It must NOT silently fall
  back to `after` — that hands someone a document they did not ask for — and must not queue a
  job that produces an empty PDF.
- **Photo deleted:** `on delete cascade` removes the selection. The remaining positions in that
  WP are left with a gap — reads sort by `position`, they do not require density, and a cascade
  cannot renumber siblings. `unselect_report_photo` closes gaps because it can; the cascade
  cannot, and correctness must not depend on it.
- **WP unmapped or re-mapped:** irrelevant here. Report selection is project-scoped and has no
  catalogue dependency — unlike starring, which spec 391 moves stars for.
- **Reorder with a stale list (D6):** `reorder_report_photos` refuses (`22023`) unless the array
  is exactly the WP's current selected set. A client that missed a concurrent unselect re-reads
  instead of resurrecting a photo or silently dropping one.
- **Cover note on a re-generated report (D7):** it belongs to the report row, so an old PDF keeps
  the note it was sent with. Editing the field before a new generation does not rewrite history.

---

## 8. Deliberately out of scope

- **No per-photo caption.** Offered under the omotenashi amendment and **declined** — see §2. The
  cover note carries the narrative; the ⭐ table's own `note` is still unused after 20 real stars.
- **No cross-WP section ordering.** Sections stay in `code` order, which is spec 389's build
  order (D6).
- **No drag-and-drop reordering** — move-up/move-down instead, for a gloved hand on a phone (§5).
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

| Unit      | Scope                                                                                                                                                                               | Merge posture                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U0**    | **D8 only** — `build-pdf.ts` leads with the Thai work name, demotes the code. Nothing else.                                                                                         | Code-only ⇒ auto-merges. **Independent of everything below and of the schema lane** — ship it first.                                                                                                                            |
| **U1**    | Migration: table (incl. `position`, `work_package_id`) + RLS + the three DEFINER RPCs + pgTAP.                                                                                      | **Danger path** (migration) ⇒ operator merge or grant self-merge on green. **Blocked on the schema lane** — held by `refauto`; live head `20260813075900`, `main` at `075896`. Claim = live head + 1, re-queried at build time. |
| **U2+U3** | `ReportSelectButton` + the `reportSelection` prop + the arrange strip (D6) + the 4th report mode + `run-report-job` branch + the cover-note field (D7) + the disabled-at-zero form. | Code-only ⇒ auto-merges on green.                                                                                                                                                                                               |

⭐ **U0 is separated on purpose.** D8 costs no PD effort, needs no schema, touches one render
line, and improves **every existing report mode** — so it should not wait behind a blocked schema
lane. It is also the only part of this spec that can ship today.

### Verification

**U0.** A `build-pdf` unit test pinning name-before-code, plus one generated PDF read back by eye.
Cheap, and it is a client-visible wording change — the class this repo pins by test precisely
because nothing else catches copy drift.

**U1 (pgTAP).** All three RPCs refuse a `site_admin` with `42501` **and** a positive control that
a `project_manager` succeeds in the same transaction — the pair is what distinguishes "the gate
works" from "the RPC refuses everyone". `22023` on a superseded photo. No INSERT/DELETE grant to
`authenticated`. Re-select is idempotent (`changed:false`, no second row). Cascade on photo
delete. **Ordering-specific:** append lands at `max(position)+1`; unselect closes the gap;
`reorder_report_photos` refuses a list that is not exactly the current set; a full reversal
commits without tripping the unique index (**the deferrable constraint's positive control** — a
non-deferred index would fail here, so this assert is what proves the `deferrable` clause is
load-bearing). `plan(N)` must equal the emitted count.

**U2+U3 (vitest).** `parseReportParams` round-trips `"selected"` **and `coverNote`**, and still
defaults on garbage; the pure selected-set builder **ordered by position**; RTL on the toggle
(both states, the disabled/absent cases for a PM and for an unmapped WP); the arrange strip
(move-up/down reorders, the strip is absent at zero selected, each control's `aria-label` names
its position); the option disabled at zero. Mutation-check each new assertion.

**Real-flow (gate 4).** Select photos on `/review` as a real PD, **reorder them**, write a cover
note, generate with `เฉพาะที่เลือก`, download the PDF, confirm it holds **exactly** those photos
**in that order**, the cover note is present, and the sections read name-first — then unselect one
and confirm it leaves. A green suite is not evidence the PDF changed.

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

### Answered

⛔ **The PROJECT header stays code-first — operator ruling 2026-08-04, do not re-raise.** U0
shipped D8 for the work-package heading and the obvious next question was whether
`${project.code} — ${project.name}` deserves the same treatment. It does not: D8's harm is that a
client meets our internal catalogue shorthand before they meet the work, and a **project code is
contract-shared with the client** — they already use it to refer to the job. Recorded here rather
than in a session note because a later reader will otherwise "finish the job" D8 deliberately
stopped short of.
