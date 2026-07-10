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

---

# P1a — Site-issue log (แจ้งปัญหา) — SA-home unit

**Status:** addendum written 2026-07-11 (build-ready). This is an **SA-home epic unit**
(sibling of the P0 `/sa` rebuild — PR #361), NOT a category-identity unit; it lives here
because the SA home is the same 277 epic surface. Deferred since 2026-07-07 only on
schema-lane serialization behind spec 275 #360 — that merged; the lane is free.

## Why

Feedback `3d66bb37` (feedback #2130, from a `site_admin`, verbatim): _"In the past there had
been work pauses due to incidents like machines breaking down or rains, but we don't know
where to upload these images and what information to put."_ That is a direct request for a
**place to log a site problem with photos and structured information**. It also aligns with
the one proven SA behaviour (memory `sa-real-usage-photos-2026-07`): the SA's real activity
is photographing the site. แจ้งปัญหา gives that instinct a home for the _problem_ case (the
`#wp-photos` capture already covers the _progress_ case).

The site issue is deliberately **light**: a type, an optional note, photos — no workflow, no
assignment, no SLA. v1 is "record it and make the PM aware when it's serious"; richer handling
is a later unit.

## Data model (PR 1 — schema, migration `20260813075640`)

Two Postgres enums (CLAUDE.md: statuses/types are enums, never free-text):

- **`site_issue_type`** — the "what information to put" the reporter asked for, as a fixed
  cause picker: `weather` (สภาพอากาศ/ฝน), `equipment` (เครื่องจักร/อุปกรณ์เสีย —
  the feedback's "machines breaking down"), `safety` (ความปลอดภัย/อุบัติเหตุ),
  `access` (เข้าพื้นที่ไม่ได้), `other` (อื่น ๆ). Labels in `labels.ts` (PR 2).
- **`site_issue_status`** — `open`, `resolved`. Two-state v1 (an `acknowledged` middle state
  is a documented later option, not built now).

**`site_issues`** (project-scoped, optional WP scope):

| col               | type                                        | notes                                                                      |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| `id`              | uuid pk                                     | `gen_random_uuid()`                                                        |
| `project_id`      | uuid **not null** → `projects(id)`          | the scope; RLS keys off this                                               |
| `work_package_id` | uuid null → `work_packages(id)`             | optional; when set, must belong to `project_id`                            |
| `issue_type`      | `site_issue_type` not null                  |                                                                            |
| `status`          | `site_issue_status` not null default `open` |                                                                            |
| `note`            | text null                                   | optional; `check (note is null or length(btrim(note)) between 1 and 1000)` |
| `reported_by`     | uuid not null → `users(id)`                 | `auth.uid()` at report time                                                |
| `resolved_by`     | uuid null → `users(id)`                     | set by `resolve_site_issue`                                                |
| `resolved_at`     | timestamptz null                            |                                                                            |
| `created_at`      | timestamptz not null default `now()`        |                                                                            |

Index `(project_id, status, created_at desc)` for the "today's open issues" read.

**`site_issue_attachments`** — cloned verbatim off `feedback_attachments`
(`20260813000200`): `id`, `site_issue_id` (→ `site_issues(id)` **on delete cascade**),
`storage_path text` (`check length(btrim) between 1 and 400`), `uploaded_by` → `users(id)`,
`created_at`; index `(site_issue_id, created_at)`; **append-only** (BEFORE
UPDATE/DELETE/TRUNCATE trigger raising `P0001`, the attachment doctrine).

**RLS + grants**

- `site_issues`: RLS on; `revoke all from anon, authenticated`; `grant select to
authenticated`; **SELECT policy** `using (public.can_see_project(project_id))` — the exact
  pattern LIVE on `daily_work_plans`. No INSERT/UPDATE/DELETE grant or policy → all writes go
  through the DEFINER RPCs.
- `site_issue_attachments`: RLS on; `revoke all from anon, authenticated`; `grant select to
authenticated`; **SELECT policy** `using (exists (select 1 from public.site_issues s where
s.id = site_issue_id and public.can_see_project(s.project_id)))`. Append-only triggers as
  above; no write grant/policy.

**Storage** — private bucket `site-issues` (10 MiB, `image/jpeg|png|webp|heic`), cloned off
the `feedback-attachments` bucket. Object key `issue/{issueId}/{attachmentId}.{ext}` →
`foldername = ['issue', issueId]`. **Owner-bound INSERT policy** (upload allowed only for the
caller's OWN issue): `bucket_id='site-issues' and array_length(foldername,1)=2 and
foldername[1]='issue' and exists(select 1 from site_issues s where s.id::text = foldername[2]
and s.reported_by = (select auth.uid()))`. No storage SELECT policy — image bytes are served
via **service-role signed URLs** (the house pattern: feedback / contact-docs). The attachment
_rows_ are readable by members (grant above) so the SA/PM home can list + sign them.

**DEFINER RPCs** (`security definer`, `set search_path=public`, `revoke all from public, anon`,
`grant execute to authenticated`) — clones of `record_site_purchase` / `add_feedback_attachment`:

1. **`report_site_issue(p_project_id uuid, p_work_package_id uuid, p_issue_type site_issue_type, p_note text) returns uuid`**
   - Null-safe role gate: `current_user_role() is null or not in
('site_admin','project_manager','super_admin','project_director')` → `42501`
     (same set as `record_site_purchase`; `project_director` kept so the pgTAP file-91
     PM-RPC pin holds).
   - Validate note (trim; length ≤ 1000 else `P0001`).
   - **Project existence** → `P0001` 'project not found'.
   - **Membership gate AFTER existence** (F2/F3 lesson): `if not can_see_project(p_project_id)`
     → `42501`. Unknown project stays `P0001`; only a non-member gets `42501`.
   - Optional WP: if `p_work_package_id` not null, require it exists **and**
     `project_id = p_project_id` (else `P0001` 'work package not found in project') — membership
     already proven by `can_see_project`.
   - Insert (`reported_by = auth.uid()`, `status='open'`); write an `audit_log` row; return id.
2. **`add_site_issue_attachment(p_site_issue_id uuid, p_storage_path uuid→text) returns uuid`**
   - Clone `add_feedback_attachment`: signed-in; the issue must be the caller's OWN
     (`exists(... reported_by = auth.uid())`) else `42501`; path required (`22023`);
     insert, return id. (Owner-only mirrors the storage INSERT policy — the reporter attaches
     their own photos in the same report flow.)
3. **`resolve_site_issue(p_site_issue_id uuid) returns uuid`**
   - Null-safe role gate (same set).
   - **Existence** → `P0001`; **membership AFTER existence** via `can_see_project` of the
     issue's project → `42501`.
   - Idempotent: set `status='resolved'`, `resolved_by=auth.uid()`, `resolved_at=now()` where
     still `open`; audit row; return id.

## PR 1 — verification

- pgTAP `supabase/tests/database/293-site-issues.sql` RED first, then GREEN: enum/table/RLS
  shape; `report_site_issue` member-OK / non-member `42501` / unknown-project `P0001`;
  attachment owner-only; `resolve_site_issue` flips status; append-only trigger fires.
- `pnpm db:push && pnpm db:types && pnpm db:test` green; zero collateral (known reds 200/221).
- LIVE-prove the RPC gates in a self-rolled-back transaction (member ok / non-member `42501`
  / residue 0), per the ship-unit real-flow gate for a schema unit.

## PR 2 — SA UI (code-only, after PR 1 merges)

- **`ปัญหาวันนี้` section** on `/sa`: today's `open` issues for the SA's visible projects,
  each row = `site_issue_type` label + icon (lucide) + note snippet + photo thumbnail(s)
  (signed URL) + relative time. Follows the home's conditional-section idiom — **renders
  nothing when there are no open issues today** (like `SaActionSection` / `MusterStrip`).
- **แจ้งปัญหา entry** — a **red FAB**. `CameraFab` already occupies `fixed bottom-right`;
  the report FAB stacks **directly above it** in the same corner (red vs the neutral camera,
  so the two read as a small action pair, not a collision). A floating (not section-embedded)
  entry is required because the section is conditional — the SA must be able to report the
  first issue of the day when the list is empty. _(Placement decision — the P0 mockup/spec is
  silent on P1a; flagged to operator, smallest-change choice.)_
- **Report sheet**: `site_issue_type` picker (5 chips) → optional note → photo attach that
  **reuses the existing capture/upload-queue machinery** (same as `CameraFab` / `#wp-photos`),
  uploading unmodified images into the `site-issues` bucket under `issue/{id}/…`. On submit:
  `report_site_issue` → per photo `add_site_issue_attachment` + storage upload.
- RTL TDD; browser-verify as a dev-preview SA (view-as), zero console errors.

## PR 3 — PM-alert automation (AUTOMATION #1, danger-path — held)

- **Serious set** = `{ safety, access, equipment }` (block work / endanger people / need PM
  action). `weather` + `other` do **not** auto-alert (routine / unknown → noise). SSOT =
  a TS predicate `isSeriousSiteIssueType(type)` (mirrors the DB enum), TDD'd.
- On a serious `report_site_issue`, notify the **project's PM** via the app's existing
  notification pathway (clone whatever LINE/TG push the app uses today — investigated in PR 3).
  Notifications are a danger-path surface → the PR HOLDS for the operator.
- **Create `docs/automations.md`** (the registry does not exist yet — this is automation #1):
  per the automation-documentation doctrine, one row = trigger · action · config · toggle. The
  entry ships in the SAME PR as the automation.
- TDD the testable core (serious predicate, PM-recipient resolution, payload build); live-verify
  the send against a safe target if the house pattern allows, else document the operator's
  manual verify-on-merge.

## Out of scope for P1a (surfaced, not built)

Issue assignment / ownership, resolution workflow beyond open→resolved, an `acknowledged`
state, SLA/aging, an issue list route or PM console, editing/superseding an issue, comment
threads, `material` as an issue type (P1b owns the material-shortage pill), and any wiring of
the category identity chip into the issue row.
