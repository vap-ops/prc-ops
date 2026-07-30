# ADR 0086 — WP brief (ข้อมูลงาน): derived definition-of-done + typed reference attachments

**Status:** Proposed (design locked with the operator 2026-07-30; docs-only — build not
started) · **Spec:** [377](../feature-specs/377-wp-brief.md)
Extends [0074](0074-wp-subwp-hierarchy.md) (briefs bind to งานย่อย leaves),
[0015](0015-photo-logs-tombstone-supersede.md) (immutable-history philosophy),
[0046](0046-document-first-po-creation.md) (file handling: canonical formats, signed-URL
viewing, upload-on-submit), [0049](0049-ai-feature-governance.md) (AI assists, human
publishes), [0059](0059-work-package-mutation-lifecycle.md) (per-field DEFINER-RPC house
pattern), [0033](0033-contractor-wp-owners.md) (crews have no logins — shapes who a brief
can reach). Mirrors the [spec 331](../feature-specs/331-company-document-types.md)
typed-registry pattern.

## Context

A งานย่อย row today carries `name`, `description`, `notes` — prose. What "done" means
lives in the PM's head and surfaces only at review time as a rejection (spec 355's
three reason families: photos-missing, photos-wrong, work-unfinished — live 2026-07-30:
`incomplete` 17 · `mismatch` 13 · `premature` 0, plus 37 pre-355 rows with no reason —
each a failure to communicate the definition of done BEFORE the work). The firm
builds the same TFM store repeatedly (spec 245 precedent), so the definition of done for
"ผูกเหล็กฐานราก F1" is nearly identical project to project — yet it is re-explained
verbally every branch.

A **WP brief** (ข้อมูลงาน) is a structured definition-of-done per งานย่อย: scope
(รวม / ไม่รวม), quantity + location, binary acceptance criteria, an evidence plan
(required photo slots mapped to criteria), and reference attachments (sheet crops, 3D
ISO renders, bar-bending schedules). The SA reads it where they already work (the
รูปถ่าย tab, spec 363); the PM reviews against the same criteria list.

Reference material raises two architectural questions this ADR settles: **how
attachments are typed and governed** (including experimental 3D types that may not earn
their keep), and **what records a publish** (briefs must be immutable once published —
the SA must never wonder which version of the instruction they are being judged
against).

## Decisions

### 1. The brief is a DERIVED view — drawings govern

The brief never becomes an authority. Every quantity/location cites its source sheet +
revision (`sheet_code` + `sheet_rev`, pinned as plain columns now; an FK into a drawings
register is a later seam — spec 377 U4). 3D renders carry a visible **"อ้างอิงเท่านั้น"**
stamp. Thai framing is **ข้อมูลงาน** — information about the work — never a
วิธีการทำงาน (method statement) replacement; the brief states WHAT done looks like, not
HOW to build. When a cited sheet's revision is superseded in the register, the brief
surfaces a stale-warning chip; it does not block anything (the drawings, not the app,
are the authority being tracked).

### 2. Attachment types are a REGISTRY, not an enum

`wp_brief_attachment_types` follows the spec-331 registry pattern (stable `code`,
bilingual name, `sort_order`, `is_active`, no DELETE — deactivate; super-gated DEFINER
RPCs). Seeded types:

| code           | what                                                       | canonical stored formats |
| -------------- | ---------------------------------------------------------- | ------------------------ |
| `sheet_crop`   | drawing crop, pinned `sheet_code` + revision               | PNG/JPEG/PDF             |
| `iso_render`   | 3D isometric render (**EXPERIMENTAL**)                     | PNG set                  |
| `model_3d`     | 3D model file (**EXPERIMENTAL**)                           | GLB, download-only in v1 |
| `bar_schedule` | bar-bending schedule ใบดัดเหล็ก, PD-entered photo or table | PNG/JPEG/PDF             |
| `other`        | anything else worth attaching                              | PNG/JPEG/PDF             |

Why not a Postgres enum: the operator must be able to **disable a type in-app**
(decision 3), and an enum cannot be dialed at runtime (the spec-331
`contact_doc_purpose` lesson). The registry's deactivate semantics ARE the per-type
operator dial: a deactivated type disappears from the attach picker while its existing
attachments keep rendering — exactly the off-ramp an experiment needs. The dial UI ships
in spec 377 U4; the seam (the registry itself) ships in U1 so no schema change is needed
to flip a type off.

### 3. The FILE is the engine port — the app never integrates a 3D/AI generation API

Generation happens **outside** the app — a freelancer, CAD, any tool, any vendor —
and its output enters as files through the publish gate, like every other attachment.
Canonical formats are the contract: images = PNG/JPEG/PDF; 3D = **GLB + an ISO PNG
set**. (A deliberate narrowing decided HERE — ADR 0046's attachment bucket admits
jpeg/png/webp/heic + pdf; 0086 pins a tighter set so the engine port stays crisp.) Field-facing v1 for 3D is the ISO PNGs; the GLB is stored for a future viewer and
renders as download-only in v1 (no three.js / model-viewer dependency).

3D types ship marked **EXPERIMENTAL**, with the kill condition and dormancy path locked
in spec 377 (§2 item 11): if the field does not open them, the off-ladder is _stop
commissioning models → dial the types off → nothing to rip out_ — no API integration,
no viewer, no pipeline ever existed inside the app. This is deliberate option-buying:
the marginal cost of being wrong about 3D is a dormant registry row, not a subsystem.

### 4. Published brief versions are IMMUTABLE; the version row IS the publish event

Publishing snapshots the brief into `wp_brief_versions` — an **append-only** table
(house triple enforcement: no UPDATE/DELETE grants, no UPDATE/DELETE policies, and
block-write trigger(s) raising `P0001` — live `approvals` uses two single-event
triggers on one function; `audit_log` additionally covers TRUNCATE; U1 picks the
shape). Edit-after-publish = new draft →
republish → new version row; the chain is ADR 0015's philosophy applied at document
grain (versions supersede whole, no tombstones needed — a brief is replaced, never
partially removed). The SA always reads the latest published version; historical
versions remain readable so "which instruction was I judged against" is answerable.

**The publish event does NOT ride `approvals`.** Fact-checked 2026-07-30 against the
live table, and it fails three ways, each sufficient alone:

1. `approvals.decision` is a **NOT NULL** `approval_decision` enum
   (`approved | rejected | needs_revision`) — a publish row would need a fourth value
   whose semantics are not a review decision, polluting an enum every consumer
   exhausts.
2. `approvals_notify_decision` (AFTER INSERT) fires `notify_wp_decision()` on **every**
   insert, unconditionally — publishing a brief would enqueue a bogus `wp_decision`
   row in `notification_outbox`, and the function swallows its own errors
   (`exception when others → raise warning`), so the corruption would be silent.
3. Every reader treats the newest row per WP as _the latest decision_: the spec-337
   resubmit boundary (`decided_at` of the latest decision), the spec-371 review-queue
   zone predicate, the spec-355 attention card (it reads the latest decision's
   `revision_reason`). A non-decision row would silently shift the resubmit photo
   boundary and mis-zone the queue — the exact class of quiet corruption the
   fact-check exists to catch.

Instead the version row itself carries `published_by uuid not null` +
`published_at timestamptz not null` and is written by a SECURITY DEFINER RPC running
under the **user session** (the spec-337 U1 attribution lesson: admin-client writes
record nobody). Append-only + attributed by construction; no separate publish-event
table is needed.

### 5. Authoring: clone-from-previous → PD edits deltas → PD publishes; AI seeds only

TFM branches are prototypes of each other, so the primary authoring path is **clone the
brief set from a previous project** (mechanical precedent: `clone_work_packages`, live).
For non-TFM work, `work_category` templates are the fallback seed — the chain is clean
in the live schema: leaf WP → `category_id` → `project_categories.work_category_id` →
`work_categories` (verified 2026-07-30; no code-parsing needed). Template content beyond
a stub is out of v1 scope.

AI may assist **seeding** a draft (extraction from sheets, phrasing criteria) under the
ADR 0049 posture — human verifies, and two hard lines on top of it: **AI never
auto-publishes, and AI never derives dimensions or quantities** (numbers enter by a
human citing a sheet, decision 1). The publish gate is a person (PD) every time.

## Alternatives rejected

- **Ride `approvals` for the publish event** — see decision 4; three independent
  disqualifiers, all live-verified.
- **Attachment `kind` as a Postgres enum** — cannot be operator-dialed; the whole 3D
  off-ramp depends on runtime deactivation (spec 331 precedent).
- **Integrate a 3D/AI generation API** (or build the GLB viewer now) — commits the app
  to a vendor and a pipeline before the experiment has proven the field opens 3D at
  all. Files are the interface; the experiment's failure mode must round to zero code.
- **Brief fields as `work_packages` columns** — no versioning, no immutability, no
  publish attribution; `description`/`notes` already hold prose and stay untouched.
- **A separate publish-events table beside the versions table** — redundant: the
  version row is already the attributable append-only fact; a second table is a second
  thing to keep consistent.

## Consequences

- Spec 377 carries the build: U1 schema (brief + versions + criteria/slots + typed
  attachments + registry + RLS + pgTAP — schema lane, held) · U2 PD authoring · U3
  SA/PM surfaces · U4 drawings register, uploads, stale flag, dial UI, usage signal ·
  U5 (optional) structured bar-schedule rows.
- The SA's รูปถ่าย tab gains a brief card + evidence slots (spec 363's 3-tab set
  stands — NO new tab); the submit gate stays SOFT ("ยังขาดรูป N จุด" warns, submit
  allowed — operator ruling 2026-07-30).
- A lightweight per-attachment open/view signal (spec 377 U4) exists solely to answer
  the 3D kill-condition query — no dashboards.
- Briefs bind to leaves only (ADR 0074 D1 posture: groups reject photos/money/content
  bindings; D4 keeps money leaf-level); the group row never carries a brief.
- New authority surface: PD authors/publishes; the danger-path guard will hold U1 for
  operator merge as intended.
