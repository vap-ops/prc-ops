# Spec 16 — Purchase-request enrichment: unit picker, needed_by, eta, attachments (iteration 3)

**Status:** DRAFT 2026-06-11 — awaiting operator lock. Designed under the
standing whole-app-upgrade brief from the operator's iteration-3 ask:
enrich the purchase-request form + data architecture; purchase admins
(AppSheet back office) record purchases / **ETA** / deliveries; SA-side:
**unit dropdown with free-text other**, **reference images + links**,
**needed-by date**. Design produced by a 12-agent constraint-mapping +
3-lens design + 3-skeptic adversarial pass; both major findings and all
minors are folded in below. Four operator questions gate the lock (§9);
each has a stated default so "go with defaults" is a valid lock.

This is the **first purchasing schema change since ADR 0025**. UI-only
iterations 1–2 (specs 14–15) did not touch the DB; this one does.

## Governance prerequisites (blocking, in order)

1. **ADR 0026** "Purchase-request enrichment: needed_by, eta,
   attachments" must land before code. It must: (a) amend ADR 0022 /
   migration `20260608120000`'s "no further ALTER expected" claim
   (stated twice, ADR 0022 ~lines 162/196 — add "amended by ADR 0026"
   pointers in place, per the ADR 0018→0025 pointer precedent); (b)
   amend the ADR 0018 grant matrix in place (eta joins the UPDATE
   column list; new `purchase_request_attachments` SELECT row) plus a
   pointer in ADR 0025's grant-relevant sections; (c) declare the new
   attachments table + private bucket; (d) record the audit posture for
   eta (§3) including the accepted bundled-transition gap; (e) record
   the deliberate two-layer-guard extension (PM/super remain technically
   able to write `needed_by`/`eta` via the open UPDATE policy; no server
   action exposes them); (f) record that pr-attachments signed-URL
   exposure is project-wide for PM/procurement/super (broader than the
   WP-scoped photos helper) and that pages may feed the minting helper
   only rows already selected for render.
2. Spec 16 locked (operator answers/accepts defaults on §9).
3. All schema work: timestamped migration → reviewed PR → `pnpm db:push`
   → `pnpm db:types` → `pnpm db:test`. Never the dashboard (the photos
   `public=true` drift is the standing exemplar). No new `audit_action`
   enum values anywhere in this design — the two-migration ALTER TYPE
   split is avoided entirely.

Note: `.claude/hooks/protect-audit-log.js` matches file **paths** against
`/supabase\/migrations\/.*audit[_-]?log.*/i` only. None of the migration
names below contain `audit_log`, so the hook will not fire; if any hook
ever blocks a write, surface it — do not bypass.

## Phasing — one spec, two shippable units

- **P1 — dates + unit picker:** migrations 1–2, validator/form/display
  work. No new tables. Independently shippable.
- **P2 — attachments:** migrations 3–5, bucket, stager UI, signed URLs,
  display. Depends on P1 only through the shared form file.

Each phase runs the full gate (`pnpm lint && pnpm typecheck && pnpm test`

- `pnpm db:test`) and updates the tracker.

## 1. Unit field — dropdown + free-text other (P1, zero schema change)

Column stays `text NOT NULL` + existing `pr_unit_nonblank` CHECK (enum
doctrine covers status fields only; an enum would forbid free text).

**Control:** native `<select>` + conditional free-text reveal — not
`<datalist>` (unreliable on iOS Safari / LINE in-app browser), not a
custom combobox (new a11y surface for no gain). In
`purchase-request-form.tsx`, keeping `h-9 w-full min-w-0` and label
หน่วย: disabled placeholder `เลือกหน่วย` → `COMMON_UNITS` → sentinel
`อื่น ๆ (ระบุเอง)` which reveals a text input (`maxLength={50}`,
placeholder ระบุหน่วย). Derived
`unit = unitChoice === UNIT_OTHER_VALUE ? unitOther : unitChoice` feeds
the existing single `unit` string — validator copy (หน่วยต้องไม่ว่าง),
action, and DB contract byte-for-byte unchanged; the sentinel is never
persisted. Select change counts toward `userTyped`.

**List:** new pure module `src/lib/purchasing/units.ts` —
`COMMON_UNITS: readonly string[]` + `UNIT_OTHER_VALUE = "__other__"`.
TS constant, not a DB table (static presentation data; AppSheet reads
the stored text, never the list). Default 25 entries (operator may amend
any time by code PR): ถุง, กระสอบ, ก้อน, แผ่น, เส้น, ท่อน, ม้วน, มัด,
กล่อง, ชุด, ตัว, อัน, ชิ้น, ใบ, ถัง, แกลลอน, กระป๋อง, เมตร, ตารางเมตร,
ลูกบาศก์เมตร, คิว, กิโลกรัม, ตัน, ลิตร, เที่ยว.

## 2. needed_by — requester's wanted-arrival date (P1)

- `needed_by date NULL` on `purchase_requests` (day-granular; no
  Bangkok/UTC off-by-one; comparable with eta). Optional — making it
  mandatory later is a validator-only change.
- **No DB CHECK against past dates** (now()-relative CHECKs invalidate
  rows over time and break restore). Rule lives in
  `validateCreatePurchaseRequest`: when provided — ISO `yyyy-mm-dd`,
  valid calendar date, `>= today` in Asia/Bangkok (via
  `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`).
  Note: this gives the validator a clock dependence — tests compute
  today-Bangkok at runtime and must tolerate the midnight-Bangkok
  boundary. Client `<input type="date" min={todayBangkok}>` as soft
  guard. Validator value carries `neededBy: string | null` (always
  present — `exactOptionalPropertyTypes`-safe; the happy-path `toEqual`
  pin in the existing test breaks FIRST by design).
- **Write path:** INSERT-time only, by the requester. Zero
  grant/policy/trigger change (authenticated INSERT is table-level).
  NOT editable post-insert in v1 (UPDATE policy excludes site_admin; an
  SA-edit RPC is a recorded seam). `decidePurchaseRequest` untouched.
- **appsheet_writer:** auto-visible via table-level SELECT; must NOT be
  writable — pgTAP pins
  `has_column_privilege('appsheet_writer', …, 'needed_by', 'UPDATE') = false`
  and smoke asserts 42501. **Operational requirement (not a note):**
  `needed_by` — and every non-granted purchase_requests column — must be
  marked read-only in the AppSheet column config, or every AppSheet row
  save on a view that surfaces it fails 42501 wholesale (AppSheet UPDATEs
  SET every editable column). Amend `docs/go-live-checklist.md` §2a with
  this step; it precedes the Tier-2 re-run.
- **Display:** `/requests` card fact line
  `ต้องการรับของภายใน {formatThaiDate}`; `/pm/requests` adds `needed_by`
  to its select and renders the same line beside ขอเมื่อ (urgency
  signal).
- New `formatThaiDate(iso)` (date-only, Buddhist era, Asia/Bangkok,
  invalid input degrades to the raw string) beside `formatThaiDateTime`
  in `src/lib/i18n/labels.ts` — the existing formatter would render a
  phantom 00:00.

## 3. eta — purchase admin's expected arrival (P1)

- `eta date NULL`. Writer: **appsheet_writer only**, via additive
  `grant update (eta) … to appsheet_writer;`. Row gate = the existing
  `"appsheet_writer update by status"` policy unchanged — AppSheet may
  set eta on an `approved` row before recording the purchase (desired).
  The app never writes eta. PM/super technical writability via the open
  UPDATE policy is the recorded two-layer-guard extension (ADR 0026).
- **Derive trigger untouched** — eta is a fact column, not a transition
  driver; eta-only updates pass through.
- **Audit — one canonical shape.** eta is audited **only** as a case-3
  correction diff (action `update`, `changed:{eta:[old,new]}`). The
  case-1 purchase payload and case-2 delivery payload are NOT amended —
  one fact, one audit shape. Consequence (recorded in ADR 0026 as the
  accepted posture): an eta change bundled into the same UPDATE
  statement as a status transition is not separately audited — exactly
  the pre-existing accepted gap for supplier/order_ref/amount bundled
  with transitions. The function's 7-column diff list and the trigger's
  WHEN clause are **both** hard-coded (verified: function body lines
  94–114, WHEN lines 149–155 of `20260608140300`) — the migration must
  `CREATE OR REPLACE` the function (8th `is distinct from` diff branch)
  AND `DROP TRIGGER` + recreate with the 8th WHEN predicate inside the
  correction arm (WHEN is not ALTERable). Mutual exclusion with the
  decision trigger (`old.status='requested'`) is preserved. Grant and
  audit amendment land in the **same migration** so there is no window
  where eta is writable but its corrections are unaudited.
- **Display:** `/requests` card, status approved|purchased with eta
  non-null: `คาดว่าจะได้รับของ {formatThaiDate}`; hidden once delivered
  (actual receipt supersedes the estimate). Footer gains:
  `ฝ่ายจัดซื้อจะอัปเดตวันที่คาดว่าจะได้รับของจากระบบหลังบ้าน`.
  `/pm/requests` shows only `requested` rows (eta cannot exist there) —
  no change. A "late" cue when `eta > needed_by` is **gated on operator
  question Q4** (display-policy precedent: the withheld amount display);
  it ships only if approved. LINE notification on late ETA is out of
  scope (tracker open question).

## 4. Attachments — reference images + links (P2)

### Table — one table, kind discriminator, triple-enforced append-only

```sql
create type public.purchase_request_attachment_kind as enum ('image','link');
create table public.purchase_request_attachments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  kind                public.purchase_request_attachment_kind not null,
  storage_path        text,   -- image only; canonical, server-built
  url                 text,   -- link only
  created_by          uuid not null references public.users(id),
  created_at          timestamptz not null default now(),
  constraint pra_image_shape check (kind <> 'image' or (storage_path is not null and length(trim(storage_path)) > 0 and url is null)),
  constraint pra_link_shape  check (kind <> 'link'  or (url is not null and storage_path is null)),
  constraint pra_url_shape   check (url is null or (url ~* '^https?://' and length(url) <= 2048))
);
create index purchase_request_attachments_pr_idx
  on public.purchase_request_attachments (purchase_request_id);
```

No `updated_at`. **Append-only is triple-enforced like audit_log /
photo_logs** (adversarial-pass major finding — two layers are not
enough when the codebase actively uses admin clients): (1) explicit
`revoke update, delete … from authenticated`; (2) RLS with no
UPDATE/DELETE policies; (3) a
`purchase_request_attachments_block_write()` BEFORE UPDATE OR DELETE
trigger raising `P0001` (clone of `photo_logs_block_write`), catching
the service_role path. pgTAP `throws_ok` pins both UPDATE and DELETE.
No audit trigger (repo precedent: content creation is unaudited;
decisions/lifecycle are audited; the immutable row attributed by
`created_by`+`created_at` IS the record). No `access_token` column —
the AppSheet image-bridge is gated on Q1 and is a separate ADR+spec.

### RLS (same migration; revoke all from anon; grant select, insert to authenticated)

- SELECT `"select via parent"` TO authenticated:
  `using (exists (select 1 from public.purchase_requests pr where pr.id = purchase_request_id))`
  — the subquery runs under the caller's parent RLS, so visibility
  mirrors purchase_requests exactly (SA own; PM/procurement/super all).
- INSERT `"insert by request owner while pending"` TO authenticated:
  `with check (created_by = auth.uid() and exists (select 1 from public.purchase_requests pr where pr.id = purchase_request_id and pr.requested_by = auth.uid() and pr.status = 'requested'))`
  — only the requester, only while undecided; the evidence the PM
  decides on is frozen. Precise invariant (ADR 0026 wording): the
  attachment author equals `auth.uid()` at insert time and the parent
  must be the caller's own pending request; `created_by =
pr.requested_by` therefore holds transitively today but is not an
  independent DB constraint. A negative pgTAP role-simulation case
  proves a non-owner INSERT onto a foreign requested parent is denied.
- appsheet_writer (separate role-touching migration, 140100 precedent):
  `grant select` + explicit policy
  `for select to appsheet_writer using (exists (select 1 from public.purchase_requests pr where pr.id = purchase_request_id and pr.status in ('approved','purchased','delivered')))`
  — status list written explicitly in the child policy (defense in
  depth against the parent's `-- future: source='appsheet'` seam). No
  INSERT/UPDATE/DELETE grant (smoke asserts 42501). No
  `current_user_role()`/`auth.uid()` anywhere in its policies (NULL for
  this role — NEVER rule).

### Storage — private bucket, path-bound upload policy

- New **private** bucket `pr-attachments` declared by migration (clone
  of `20260524040000`): `public=false`, `file_size_limit=26214400`,
  `allowed_mime_types = {image/jpeg,image/png,image/webp,image/heic}`.
  Do NOT reuse `photos` (its path contract is WP/photo_log-linked;
  foreign objects would read as orphans to v2 cleanup/watermarking).
- **Upload policy binds the path to the caller's own pending request**
  (adversarial-pass major finding — the photos bucket's role-only
  looseness must not carry over here, because this path is built from a
  client-held prop and uploaded before any server validation):

```sql
create policy "pr attachment uploads by request owner"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and array_length(storage.foldername(name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      join public.work_packages wp on wp.id = pr.work_package_id
      where pr.id::text = (storage.foldername(name))[2]
        and wp.project_id::text = (storage.foldername(name))[1]
        and pr.requested_by = auth.uid()
        and pr.status = 'requested'
    )
  );
```

The subquery runs under the uploader's own RLS. A privileged user can
no longer write arbitrary keys (cross-project namespace writes are
closed, not "accepted looseness"). No SELECT/UPDATE/DELETE storage
policies — reads only via service-role batched signed URLs;
append-only `upsert:false`; orphans from abandoned uploads accepted
(photos precedent); attachment truth = the table, never the bucket.

- **Path:** `{project_id}/{purchase_request_id}/{attachment_id}.{ext}`
  — new pure module `src/lib/purchasing/attachment-path.ts`
  (`buildPrAttachmentStoragePath`), reusing `isValidUuid`,
  `mimeToPhotoExt`, `PHOTO_EXTS` from `@/lib/photos/path`.

### Upload UX — staged-at-create pipeline + recovery expander

1. SA stages images (pre-assigned `crypto.randomUUID()` + ext;
   unsupported MIME → phase-uploader copy verbatim) and links
   (client-validated) before submit; staged chips removable (ลบ) —
   pure client state.
2. Submit → `createPurchaseRequest` (now also inserting `needed_by`) →
   `{ok:true, id}`. บันทึกแล้ว shows immediately; attachment failures
   never roll back the request.
3. Per staged image, sequentially: browser uploads bytes direct to
   `pr-attachments` under the user session (`upsert:false`) at the path
   built from the returned id + `projectId`, then calls new server
   action `addPurchaseRequestAttachment({purchaseRequestId, kind, …})`
   — metadata only, never a client path. Links: action call only.
   `projectId` sourcing (adversarial-pass fix — the draft had this
   inverted): the pinned-WP query in `/requests/page.tsx` **already
   selects `project_id`** (no select change; the form prop gains
   `projectId`); the **own-rows WP lookup** (`select("id, code, name")`)
   must ADD `project_id` and pass it per-card to the recovery expander.
4. The action: strict per-kind validation (uuid/ext via the path
   module; trim + `^https?://` + ≤2048 via new
   `src/lib/purchasing/validate-attachment.ts`), `auth.getUser()`,
   reads the PR joined to `work_packages.project_id` under **caller
   RLS** (`maybeSingle`, no existence leak), **reconstructs the
   canonical storage_path server-side**, INSERTs under the user session
   (RLS pins owner+pending), `revalidatePath('/requests')`.
5. Per-item state machine cloned from phase-uploader
   (`uploading → upload-error` retry re-uploads same uuid;
   `inserting → insert-error` retry replays the action only). New
   client component
   `src/components/features/purchase-request-attachment-stager.tsx`
   (justified: file input + per-tile state machine).
6. **Recovery:** own `/requests` cards with `status='requested'` get an
   เพิ่มรูปหรือลิงก์ expander reusing the stager with the known PR id
   (the INSERT policy already permits exactly this).

### Signed URLs + display

- New `server-only` `src/lib/purchasing/attachment-signed-urls.ts`
  cloning `mintSignedUrlsForPhotos` against `pr-attachments`
  (`createAdminClient()`, batched `createSignedUrls(paths, 120)`, Map
  keyed by attachment id, per-entry errors skipped, URLs never
  persisted). Pages feed it ONLY attachment rows already selected for
  render under caller RLS (ADR 0026 records the broader-than-photos
  exposure radius for PM/procurement/super).
- `/requests` + `/pm/requests`: one
  `.in('purchase_request_id', ids)` query under caller RLS (ordered by
  `created_at`); headings รูปอ้างอิง (lazy thumbnails; tap-to-enlarge
  reuses `ZoomablePhoto`) and ลิงก์อ้างอิง (anchors
  `target="_blank" rel="noopener noreferrer nofollow"`, truncated
  display — never embedded; user-supplied URLs).

### AppSheet visibility — explicit v1 posture

appsheet_writer reads attachment **rows**: link `url`s are fully usable
in AppSheet; image `storage_path`s are inert strings (private bucket;
the app's 120-s URLs are unconsumable there). v1 accepts this: the PM
sees images at the decision point; purchasing gets links. NOT done
(each violates a recorded invariant): public bucket, persisted long-TTL
URLs, capability-URL/proxy endpoint (posture change ⇒ own ADR, gated on
Q1).

## 5. Migrations in order

1. `20260613100000_add_purchase_requests_needed_by_eta.sql` — two
   `add column … date` + column comments. [P1]
2. `20260613100100_appsheet_writer_eta_grant_and_audit.sql` —
   `grant update (eta)` + audit function CREATE OR REPLACE (8th diff
   branch only) + trigger drop/recreate (8th WHEN predicate). One
   migration: no writable-but-unaudited-corrections window.
   Role-touching → Tier-2 smoke re-run mandatory. [P1]
3. `20260613100200_create_purchase_request_attachments.sql` — enum +
   table + CHECKs + index + RLS enable + revokes + grants + the two
   authenticated policies + block-write function/triggers. [P2]
4. `20260613100300_grant_appsheet_writer_attachments_select.sql` —
   grant + explicit TO appsheet_writer policy (separate role-touching
   migration, reviewable in isolation). [P2]
5. `20260613100400_create_pr_attachments_bucket.sql` — idempotent
   private bucket insert + the single path-bound storage INSERT
   policy. [P2]

After each phase's migrations: `pnpm db:push` → `pnpm db:types` →
`pnpm db:test`.

## 6. Tests

**Vitest (failing test FIRST, stated explicitly):**

1. NEW `tests/unit/purchase-request-units.test.ts` — COMMON_UNITS
   pinned (exact list, no dupes/blanks, ≤50 chars trimmed);
   UNIT_OTHER_VALUE not in the list. [P1]
2. UPDATE `tests/unit/validate-purchase-request.test.ts` — happy-path
   `toEqual` pin gains `neededBy: null` (breaks first by design); new
   cases: omitted→ok/null; today/future ok; past (Bangkok)→error
   /วันที่ต้องการรับของ/; malformed→error. Existing /หน่วย/ /วัสดุ/
   /จำนวน/ /รายการงาน/ pins untouched. Today-Bangkok computed at
   runtime; tolerate the midnight boundary. [P1]
3. NEW `tests/unit/format-thai-date.test.ts` — Buddhist-era date-only
   output; invalid input → raw passthrough. [P1]
4. NEW `tests/unit/validate-attachment.test.ts` — link: https?://
   required, trim, ≤2048, rejects javascript:/data:/ftp:/bare-host;
   image: uuid+ext gates; Thai error copy pins. [P2]
5. NEW `tests/unit/pr-attachment-path.test.ts` —
   `buildPrAttachmentStoragePath` shape + bad-uuid/ext rejection. [P2]

**Declared verified-by-checklist posture** (spec-15 precedent —
required sentence, else CLAUDE.md's letter rejects the unit):
`attachment-signed-urls.ts` (clone of the untested photos precedent),
the `addPurchaseRequestAttachment` action wiring, the stager component,
and the form/page surfaces are verified by
lint/typecheck/build/e2e + the checklist below; the pure seams carrying
failing-first tests are the five files above.

**pgTAP:**

- `17-purchase-requests.test.sql` — `has_column` + type `date` +
  nullable for needed_by/eta; SA INSERT carrying needed_by persists
  (role-simulation mechanism already in the file); derive-trigger
  pass-through unaffected by an eta-only update; **named existence
  checks** for any new policy (the file's no-DELETE check is
  deliberately count-independent — do not add total-count pins). [P1]
- `18-appsheet-writer-purchasing.test.sql` —
  `has_column_privilege(eta, UPDATE)=true` (8 permitted);
  `(needed_by, UPDATE)=false` (protected set → 4); silent-audit-gap
  regression guards: `pg_get_triggerdef` contains `eta`,
  `pg_get_functiondef` contains the eta diff branch; payload-shape
  pins: the purchase-transition payload keys are exactly
  {principal,supplier,order_ref,amount,purchased_at} (no eta) and an
  eta-only update on an approved row emits an `update` row whose
  `changed` contains eta. [P1]
- NEW `19-purchase-request-attachments.test.sql` — table/columns/types;
  enum exactly {image,link}; FK cascade; named CHECKs reject bad shapes
  (`throws_ok`: image+url, link+path, ftp:// url, blank path);
  `relrowsecurity`; named policies (3 exactly: 2 authenticated + 1
  appsheet) with pinned roles/cmds; zero UPDATE/DELETE policies;
  privilege matrix (authenticated select+insert true / update+delete
  false; appsheet_writer select true / others false; anon all false);
  appsheet policy qual contains all three status literals;
  **block-write triggers: UPDATE and DELETE both `throws_ok` P0001**;
  negative role-simulation INSERT onto a foreign requested parent is
  denied; index exists. (Behavioral appsheet_writer row-gating cannot
  be impersonated in pgTAP — ADR 0025; catalog assertions + Tier-2
  smoke cover it.) [P2]
- NEW `20-pr-attachments-bucket.test.sql` — bucket exists,
  **`public=false`** (day-one drift guard), size limit, exact mime
  array, the INSERT policy pinned **by name** (file-11 precedent — no
  global policy counts) and its qual contains `foldername`. [P2]

**Tier-2 smoke (`supabase/scripts/smoke/appsheet_writer_p2.sql`) —
phase-tagged amendments, each probe in its own `begin/exception` block
(a missing-table reference must not abort the ritual):**

- [P1 probes, run after migration 2]: eta UPDATE on an approved row
  permitted; needed_by UPDATE → [PASS] on 42501; keep the existing
  item_description denied probe.
- [P2 probes, land in the same PR as migration 4, run **after the P2 UI
  ships**, not merely after the migration — hard go-live gate]:
  explicit operator fixture protocol cloning the SETUP-FAILED pattern
  (operator creates two requests via the app, attaches image+link to
  both, leaves one pending and has the PM approve the other; the script
  raises SETUP FAILED if no attachment rows exist — the
  requested-parent probe must not pass vacuously on an empty table):
  attachments of the requested parent → 0 rows; of the approved parent
  → visible; attachment INSERT/UPDATE/DELETE → 42501.

## 7. Thai display strings (spec-14 glossary-conformant)

| Surface                                              | String                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unit label / error (unchanged pins)                  | หน่วย / หน่วยต้องไม่ว่าง                                                            |
| Unit select placeholder / other option / other input | เลือกหน่วย / อื่น ๆ (ระบุเอง) / ระบุหน่วย                                           |
| needed_by form label                                 | ต้องการรับของภายใน (ไม่บังคับ)                                                      |
| needed_by fact line                                  | ต้องการรับของภายใน {วันที่}                                                         |
| needed_by errors                                     | วันที่ต้องการรับของไม่ถูกต้อง · วันที่ต้องการรับของต้องไม่เป็นวันที่ผ่านมาแล้ว      |
| eta fact line                                        | คาดว่าจะได้รับของ {วันที่}                                                          |
| Late cue (only if Q4 approves)                       | ช้ากว่าวันที่ต้องการ (amber)                                                        |
| Footer addition (/requests)                          | ฝ่ายจัดซื้อจะอัปเดตวันที่คาดว่าจะได้รับของจากระบบหลังบ้าน                           |
| Attachments form section                             | รูปและลิงก์อ้างอิง (ไม่บังคับ)                                                      |
| Attach buttons / expander                            | แนบรูป / เพิ่มลิงก์ / เพิ่มรูปหรือลิงก์                                             |
| Staged chip remove / retry                           | ลบ / ลองใหม่                                                                        |
| Progress states                                      | กำลังอัปโหลด… / กำลังบันทึก…                                                        |
| Unsupported file / upload failed                     | phase-uploader copy verbatim                                                        |
| Metadata save failed (image / link)                  | บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง / บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง |
| Invalid link / link placeholder                      | ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// / https://…                              |
| Card display headings                                | รูปอ้างอิง / ลิงก์อ้างอิง                                                           |

All dates via `formatThaiDate`; error suffix convention
กรุณาลองใหม่อีกครั้ง preserved.

## 8. Out of scope

AppSheet image-bridge (capability URL / procurement web page — own
ADR+spec, gated on Q1); post-decision attaching and attachment removal
(default-deny, gated on Q2); PDF/quotation attachments (gated on Q3);
late-ETA LINE notification; SA post-insert edit of needed_by (recorded
seam); `amount` display (standing open question); everything in the
iteration-3 structural queue (header refactor, theme, PWA, dialogs).

## 9. Operator questions gating the lock (defaults stated)

- **Q1 — AppSheet image viewing.** v1: purchase admins see clickable
  link URLs in AppSheet but cannot open attached image files (PM views
  images in-app at decision time). Default: accept for v1; follow-up
  ADR if needed.
- **Q2 — attachment lifecycle.** v1: only the requester attaches, only
  while pending; never editable/removable after. Default: accept
  (frozen evidence).
- **Q3 — file types.** v1: images + links only. PDFs (quotations)
  change the mime list/bucket posture end-to-end — deciding now is
  cheap. Default: images + links.
- **Q4 — late cue.** Show the amber ช้ากว่าวันที่ต้องการ badge to
  requesters when eta > needed_by? Display-policy decision (amount
  precedent). Default: ship eta display without the comparison badge.

(Unit list is not lock-gating: the 25 defaults ship and are amendable
by code PR.)

## 10. Verification checklist

- [ ] ADR 0026 merged first, including all in-place back-pointer edits
      (ADR 0018 matrix, ADR 0022 ×2, ADR 0025).
- [ ] New unit tests RED before each pure module exists, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass per phase.
- [ ] `pnpm db:push` → `pnpm db:types` → `pnpm db:test` green per
      phase; updated plan counts.
- [ ] pgTAP: block-write P0001 throws_ok (UPDATE+DELETE), policy-name
      pins, privilege matrix, audit payload-shape pins all present.
- [ ] Tier-2 smoke re-run after migration 2 [P1] and after the P2 UI
      ships [P2] with the operator fixture protocol; AppSheet column
      config (needed_by read-only) done BEFORE the re-run; go-live
      checklist §2a amended.
- [ ] `pnpm build` + `pnpm test:e2e` pass (no purchasing copy pinned in
      e2e today).
- [ ] Locked behaviors intact: spec-10 pinned-form modes, spec-12
      back-nav, spec-14 glossary, spec-15 fact-line display; enum
      values/routes/redirects untouched.
- [ ] No dashboard changes; bucket created private and pgTAP-pinned.
