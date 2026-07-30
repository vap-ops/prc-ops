# Spec 377 — WP Brief v1 (ข้อมูลงาน)

**Status:** DESIGN LOCKED (operator rulings 2026-07-30) — docs only, build not started.
**ADR:** [0086](../decisions/0086-wp-brief-reference-attachments.md) (typed reference
attachments; the publish-event resolution; the 3D engine-port principle).
**Builds on:** spec [363](363-wp-detail-sa-nav.md) (the SA's 3-tab WP detail — the brief
renders inside รูปถ่าย), [355](355-revision-reasons.md) (revision reasons — the review
tie-in), [331](331-company-document-types.md) (typed registry pattern),
[245](245-ordering-plan-templates.md) (clone-not-blank doctrine), ADR
[0074](../decisions/0074-wp-subwp-hierarchy.md) (briefs bind to งานย่อย leaves).

## 1. Why

The definition of done for a งานย่อย lives nowhere. `work_packages` carries
`name` / `description` / `notes` (verified live 2026-07-30 — no brief-shaped columns
exist), so what "เสร็จ" means is verbal, and the gap surfaces at review as spec 355's
three rejection families: photos missing (`incomplete`, 17 live rows), photos wrong
(`mismatch`, 13), work unfinished (`premature`, 0 to date) — each the SA discovering
the definition of done AFTER doing the work. The firm re-builds the same TFM store branch after branch, so the
definition barely changes between projects; it is re-explained from scratch anyway.

The WP brief writes it down once, structured: scope in/out, quantity + location (each
citing its drawing sheet + revision), binary acceptance criteria, an evidence plan
(which photos prove which criteria), and reference attachments. The SA meets it at the
top of the รูปถ่าย tab — the one surface with proven traffic (spec 363: photos carry
~93% of SA writes) — and the PM reviews against the same criteria list, so both sides
finally hold one contract.

## 2. Locked design (operator, 2026-07-30 — do not reopen)

1. A WP brief = structured definition-of-done per งานย่อย: scope (รวม / ไม่รวม),
   quantity + location, binary acceptance criteria list, evidence plan (required photo
   slots, slot-level mapping to criteria), reference attachments.
2. Attachment types (typed registry, spec-331 style, NOT free-text): sheet crop (pinned
   sheet_code + revision), 3D ISO render, 3D model file, bar-bending schedule
   ใบดัดเหล็ก (photo or table, PD-entered), other. Canonical stored formats: images =
   PNG/JPEG/PDF; 3D = GLB + ISO PNG set. The FILE is the engine port — the app NEVER
   integrates a 3D/AI generation API; generation happens outside (freelancer, CAD, any
   tool), output enters as files through the publish gate. Field-facing v1 for 3D = the
   ISO PNGs; GLB is stored for a future viewer, rendered as download-only in v1.
3. Every attachment type must be individually disableable by an operator dial (design
   the seam in U1 schema, ship the dial in U4). 3D types ship marked EXPERIMENTAL in
   the ADR: off-ladder = stop attaching → dial off → nothing to rip out.
4. The brief is a DERIVED view — drawings govern; every number cites its sheet+rev.
   Thai framing: ข้อมูลงาน, never a วิธีการทำงาน replacement. 3D renders carry a
   visible "อ้างอิงเท่านั้น" stamp.
5. Authoring model: clone-from-previous-project draft (TFM branches are prototypes) →
   PD edits deltas → PD publishes. work_category templates = fallback seed for
   non-TFM. AI assists seeding only; AI NEVER auto-publishes and NEVER derives
   dimensions or quantities.
6. Published brief versions are IMMUTABLE. Edit after publish = new draft → republish,
   supersede chain (ADR 0015 philosophy). The publish event must be attributable and
   append-only. → **Resolved in ADR 0086 §4:** it does NOT ride `approvals` (NOT-NULL
   decision enum + the AFTER-INSERT decision-notification trigger + every latest-
   decision reader would mistake it for a decision); the immutable version row itself
   is the append-only, attributed publish event.
7. SA surface: NO new tab (spec 363's 3-tab set stands). Brief card + evidence slots
   render at the top of the รูปถ่าย tab; criteria collapsed by default. Submit gate is
   SOFT: "ยังขาดรูป N จุด" warning, submit allowed. RULED 2026-07-30.
8. PM review surface shows the same criteria with slot photo counts; ties into spec 355
   reason chips. Per-photo↔criterion binding is OUT of v1 (open question).
9. Stale flag: when a referenced sheet's revision is superseded in the drawings
   register, the brief surfaces a warning chip. Register mechanics live in U4.
10. A lightweight per-attachment usage signal (open/view events) exists solely to
    answer "does the field use this". Minimal design, decided in U4. No dashboards.
11. 3D experiment kill condition (RULED 2026-07-30): target = the steel-detail WPs
    (~4–6) of the next TFM branch. Experiment is valid only if 3D attachments are
    published BEFORE those WPs start — late assets mean re-run on the following
    branch, not a fail. Window = first field activity on any target WP until all
    target WPs complete, capped at 4 weeks. Pass = ≥10 attachment opens by field roles
    (authoring/review roles excluded; note crews and foremen have no logins per ADR
    0033, so field opens ≈ site_admin tier and verbal foreman feedback is the second
    channel) OR explicit positive foreman feedback. Fail → 3D types go dormant: no
    further model commissioning; dial off optional; existing attachments remain
    untouched. The U4 usage signal must be able to answer exactly this question and
    nothing more.

## 3. Fact-check record (live DB + worktree HEAD `f473a5ad`, 2026-07-30)

| Claim                           | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work_packages` columns         | 19 cols: id, project_id, code, name, description, status, created_at, updated_at, deliverable_id, owner_id, contractor_id, notes, priority, planned_start, planned_end, category_id, rework_round, is_group, parent_id. Nothing brief-shaped.                                                                                                                                                                                                                                                       |
| SA tab set on main              | Exactly `รูปถ่าย · ของ · ประวัติ` (spec 363 U4 merged; แรงงาน renders only for manager/procurement lenses).                                                                                                                                                                                                                                                                                                                                                                                         |
| Spec 355 status                 | SHIPPED — `approvals.revision_reason` live; enum `approval_revision_reason` = `incomplete · mismatch · premature`.                                                                                                                                                                                                                                                                                                                                                                                  |
| `approvals` shape               | 7 cols (id, work_package_id, decision NOT NULL, comment, decided_by NOT NULL, decided_at, revision_reason); append-only (block triggers); `approvals_notify_decision` AFTER INSERT; `approvals_reject_group_wp` leaf guard. → cannot host a publish row (ADR 0086 §4).                                                                                                                                                                                                                              |
| Typed-attachment house patterns | spec 331 registry (code-keyed, deactivate-not-delete, super DEFINER RPCs) · ADR 0046 attachments (kind/purpose + storage_path + created_by, append-only, RPC-only writer, upload-on-submit, signed-URL viewing, private buckets). Reused, not reinvented.                                                                                                                                                                                                                                           |
| Who opens WP detail today       | `requireRole(WP_DETAIL_ROLES)` = site_admin, project_manager, super_admin, project_director, procurement, procurement_manager. **Field roles for item 11 = `site_admin` only** (PM/PD/super author or review; procurement tiers are office). Precision on the item-11 parenthetical: ADR 0033 states the no-login rule for contractor CREWS; foremen likewise hold no accounts today (observation — no foreman role or binding exists), which is why verbal foreman feedback is the second channel. |
| work_category fallback chain    | Clean FK path verified: leaf `category_id` → `project_categories` → `project_categories.work_category_id` → `work_categories` (W01–W09). ⚠️ `work_packages.category_id` FKs `project_categories`, NOT `work_categories` — the spec-371 trap; never join the firm taxonomy directly.                                                                                                                                                                                                                 |
| Clone precedent                 | `clone_work_packages` DEFINER RPC exists live.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Next free numbers               | ADR 0086 · spec 377 (both indexes + `git ls-remote` + open PRs checked).                                                                                                                                                                                                                                                                                                                                                                                                                            |

## 4. Design detail (final shapes are U1's to gate-check)

### 4.1 Data model sketch

- `wp_briefs` — one mutable DRAFT head per leaf WP (`work_package_id` unique FK;
  leaf-only enforced like photos/money per ADR 0074). Holds the working copy the PD
  edits: scope in/out, quantity, location, `sheet_code`/`sheet_rev` citations.
- `wp_brief_versions` — the immutable published snapshots. **Append-only** (house
  triple enforcement), `published_by not null` + `published_at not null`, `version`
  int; the newest version per WP is what the SA reads. Publish RPC runs under the user
  session (spec-337 U1 attribution lesson).
- `wp_brief_criteria` + `wp_brief_evidence_slots` — binary criteria and required photo
  slots, slot→criterion mapping. Snapshotted into the version at publish (exact
  mechanism — child rows keyed by version vs a JSONB snapshot — is U1's call; the
  invariant is that a published version's criteria can never drift).
- `wp_brief_attachments` — typed rows (ADR 0046 shape: `type` FK → registry,
  `storage_path`, `created_by`, append-only) + `wp_brief_attachment_types` registry
  (spec-331 spine; deactivate = the item-3 dial; 5 seeded types per ADR 0086 §2).
  Private bucket, service-role signed URLs (house pattern).
- RLS: SELECT for WP-detail readers via `can_see_project`; ALL writes RPC-only.
  ⚠️ Gate-check the role/scoping intersection at U1 (the spec-363 lesson: plain
  `procurement` is in `WP_DETAIL_ROLES` but falls to else-false in
  `can_see_project` — read the helper live before writing the policy).

### 4.2 SA surface (U3)

Top of the รูปถ่าย tab (item 7): a brief card — scope line, quantity+location with
sheet citations, attachment thumbnails/downloads — with criteria **collapsed by
default**, and the evidence slots rendered beside the capture zone so "which photos are
still owed" is visible while shooting. Submit gate stays SOFT: the existing submit
control gains a "ยังขาดรูป N จุด" warning when slots are unfilled; submit is never
blocked. No new tab, no new route. A WP with no published brief renders nothing (no
empty shell — the spec-337 dead-door rule).

### 4.3 PM review surface (U3)

The review WP detail shows the same criteria list with per-slot photo counts — the PM
checks against the published contract, not memory. Tie-in to spec 355: the reason chips
stay the decision vocabulary; the criteria panel is context beside them. Per-photo ↔
criterion binding is OUT of v1 (open question 1) — counts only.

### 4.4 Authoring (U2)

**Authoring is tablet-first** (operator ruling 2026-07-30, mid-U1): WP-brief
management assumes a bigger screen — design U2 for tablet/desktop (the ADR-0046
side-by-side precedent), with the phone as a read surface, not an authoring one.
**The PD also selects which information types render on the WP page** (same ruling):
per-brief display selection, stored in `wp_briefs.display_config` (jsonb — the U1
seam) and snapshotted into the version at publish. This is FINER than the ADR-0086
registry dial: `is_active` = the firm-wide kill switch per attachment type;
`display_config` = one PD's choice for one WP's page. U2/U3 design the vocabulary
(which sections/types are selectable); U1 ships only the column.

`clone-from-previous-project` = pick a source project → matching briefs land as DRAFTS
on the target's leaves (match key is U2's design call; `clone_work_packages` is the
mechanical precedent) → PD edits deltas → publish per WP. work_category template
fallback (non-TFM) resolves through the §3 FK chain — v1 ships a stub note, not
template content. AI seeding, when it arrives, lands under ADR 0049 governance +
the ADR 0086 §5 hard lines (never publishes, never derives numbers); nothing AI ships
in these units.

### 4.5 Drawings register + stale flag + dial + usage signal (U4)

- Minimal `project_drawings` register (sheet_code, revision) so citations can be
  checked; brief chips warn `แบบมีฉบับใหม่กว่า` when a cited rev is superseded (item
  9). The DWG→register extraction script is an **operator tool documented in docs/**,
  never app code.
- The attachment-type dial UI (registry deactivate — ADR 0086 §2).
- The usage signal: per-attachment open/view events answering exactly the item-11
  query — "opens by field roles within the window". `interaction_events` (has
  `actor_role`, `route`, `context` jsonb, verified live) is the natural seam, but an
  `event_type` enum-add trips the exhaustiveness guards — U4 decides between that and
  a minimal dedicated table. No dashboards; the deliverable is one query.

## 5. Units

| U      | Ships                                                                                                                                                                                  | DB?                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **U1** | Schema: brief + immutable versions + criteria/slots + typed attachments (sheet_code/rev pin fields now, register FK later; per-type disable seam) + RLS + pgTAP                        | **Yes — 🔔 schema lane, held** |
| **U2** | PD authoring: clone-from-project, edit, publish                                                                                                                                        | No                             |
| **U3** | SA + PM surfaces: brief card in รูปถ่าย, evidence slots, soft gate, review criteria panel (355 tie-in)                                                                                 | No                             |
| **U4** | Drawings register + crop/ISO/GLB upload + stale-flag wiring + attachment-type operator dial + item-10/11 usage signal; DWG→register extraction documented as an OPERATOR tool in docs/ | Yes                            |
| **U5** | (later, optional) structured bar-schedule rows + rendered shape diagrams                                                                                                               | —                              |

## 6. Out of scope

Migrations in this unit · any UI code · any AI pipeline · any 3D/AI generation API
integration · GLB viewer (three.js/model-viewer) · telemetry dashboards · per-photo
criterion binding · clone diff UI · non-TFM template seeding beyond the §4.4 stub note.
Out-of-scope ideas land in §7, not in the build.

## 7. Open questions

1. **Per-photo ↔ criterion binding** (item 8) — v1 shows slot counts only; binding a
   specific photo to a specific criterion would strengthen review but adds a tagging
   step to capture. Revisit with field data after U3.
2. **Does the brief card render for `procurement` (read-only viewer)?** They open WP
   detail today; the brief is not secret, but the card costs screen space on a role
   that never shoots evidence. U3 decides; default = render (read-only parity).
3. **Criteria snapshot mechanism** — per-version child rows vs JSONB snapshot (§4.1);
   U1 decides against pgTAP-provable immutability.
4. **Does the ประวัติ timeline get a `brief published` row?** The spec-363 row model
   takes new kinds cheaply (`kind: "brief"`), and the version row is readable — but it
   is scope creep until asked. Logged, not built.
5. **Evidence-slot ↔ phase relationship** — slots are brief-defined ("มุมกว้างเห็นทั้ง
   ฐาน", "ระยะ covering ชัด"), photos carry `phase` and group by ROUND (spec 372); U1
   must decide whether a slot pins a phase or is phase-free. Lean phase-free (the
   criteria, not the lifecycle, define the shot list).
6. **Stale-flag propagation grain** — warn on the brief card only, or also on the PM
   review panel? U4 decides; both read the same predicate.
