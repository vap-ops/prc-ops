# Spec 16 — Purchase-request enrichment: unit picker, needed_by, eta, attachments (iteration 3)

**Status:** Locked 2026-06-11 — operator answered the four gating
questions: **Q1** purchase admins must be able to view attached images
from AppSheet (→ P3 image bridge + ADR 0027); **Q2** the requester may
REMOVE an attachment while the request is still pending (→
tombstone-supersede, ADR 0015 pattern; never UPDATE/DELETE); **Q3**
images + links only (no PDFs in v1); **Q4** no late badge — eta and
needed_by display plainly. A second adversarial pass on the post-lock
deltas found and fixed: two SQL name-capture blockers in the locked
policy snippets (both fail-closed), the Supabase default-privilege
revoke-all-first requirement, and a token-rotation inconsistency —
resolved by moving the capability token to a 1:1 side table so the
attachments table stays strictly append-only.

Designed under the standing whole-app-upgrade brief (iteration-3 ask):
enrich the purchase-request form + data architecture; purchase admins
(AppSheet back office) record purchases / **ETA** / deliveries; SA-side:
**unit dropdown with free-text other**, **reference images + links**,
**needed-by date**. Design produced by a 12-agent constraint-mapping +
3-lens design + 3-skeptic adversarial pass, plus the post-lock delta
pass above. This is the **first purchasing schema change since ADR
0025**.

## Governance prerequisites (blocking, in order)

1. **ADR 0026** "Purchase-request enrichment: needed_by, eta,
   attachments" must land before P1/P2 code. It must: (a) amend ADR
   0022 / migration `20260608120000`'s "no further ALTER expected"
   claim (stated twice, ADR 0022 ~lines 162/196 — add "amended by ADR
   0026" pointers in place, per the ADR 0018→0025 pointer precedent);
   (b) amend the ADR 0018 grant matrix in place (eta joins the UPDATE
   column list; new rows for `purchase_request_attachments`, the token
   table, and the views) plus a pointer in ADR 0025's grant-relevant
   sections; (c) declare the new tables + private bucket + the two
   security_invoker views; (d) record the audit posture for eta (§3)
   including the accepted bundled-transition gap; (e) record the
   deliberate two-layer-guard extension (PM/super remain technically
   able to write `needed_by`/`eta` via the open UPDATE policy; no
   server action exposes them); (f) record that pr-attachments
   signed-URL exposure is project-wide for PM/procurement/super
   (broader than the WP-scoped photos helper) and that pages may feed
   the minting helper only rows already selected for render; (g) record
   the accepted tombstone/approval TOCTOU race (a tombstone whose
   snapshot saw `status='requested'` can commit just after an approval
   commits — same class as the photos flow accepts); (h) record that
   tombstone same-parent/same-kind is DB-enforced via the composite FK
   (§4) while `created_by = requested_by` remains transitively true at
   insert time only.
2. **ADR 0027** "AppSheet image bridge — capability-URL read path" must
   land before **P3 only** (P1/P2 do not depend on it). It owns the
   no-login read-path posture: scope (reference images only — this
   bucket never holds site progress photos), per-attachment UUIDv4
   token (≈122 random bits), rotation = service-role UPDATE on the
   token side table (§5), no listing/enumeration surface, the
   trusted-role link-sharing residual risk, and the timing posture
   (`crypto.timingSafeEqual`; row-found-vs-not latency reveals only
   unguessable-id existence — accepted).
3. All schema work: timestamped migration → reviewed PR → `pnpm db:push`
   → `pnpm db:types` → `pnpm db:test`. Never the dashboard (the photos
   `public=true` drift is the standing exemplar). No new `audit_action`
   enum values anywhere in this design.

**Implementation hazards called out by the adversarial passes (binding):**

- **SQL name-capture in policy subqueries.** A subquery FROM the same
  table (or any table sharing a column name) silently captures
  unqualified outer references — `superseded_by` resolved against the
  `target` alias, and `name` inside the storage policy resolved against
  `work_packages.name`. Outer-row references inside policy subqueries
  MUST be qualified by the outer table name
  (`purchase_request_attachments.superseded_by`, `objects.name`), as
  written in the locked SQL below. pgTAP pins the qualified text.
- **Supabase default privileges.** The platform's
  `ALTER DEFAULT PRIVILEGES` grants ALL on every new table AND view to
  anon/authenticated. Every new object's migration MUST open with
  `revoke all … from anon, authenticated` before re-granting (the
  repo's universal precedent) — including both views and the token
  table, or the posture below silently fails open.
- `.claude/hooks/protect-audit-log.js` matches file **paths** against
  `/supabase\/migrations\/.*audit[_-]?log.*/i` only; no migration name
  below matches. If any hook blocks a write, surface it — do not
  bypass.

## Phasing — one spec, three shippable units

- **P1 — dates + unit picker:** migrations 1–2, validator/form/display
  work. No new tables. Independently shippable.
- **P2 — attachments (create, remove-while-pending, display):**
  migrations 3–5, bucket, stager UI, tombstone removal, signed URLs,
  display. Depends on P1 only through the shared form file.
- **P3 — AppSheet image bridge:** ADR 0027 + a code-only route handler
  (no migration — the token table ships in P2) + AppSheet operator
  config. Depends on P2.

Each phase runs the full gate (lint, typecheck, unit tests, db tests)
and updates the tracker.

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
TS constant, not a DB table. Default 25 entries (operator may amend any
time by code PR): ถุง, กระสอบ, ก้อน, แผ่น, เส้น, ท่อน, ม้วน, มัด,
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
  `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })`). Note:
  this gives the validator a clock dependence — tests compute
  today-Bangkok at runtime and must tolerate the midnight-Bangkok
  boundary. Client `<input type="date" min={todayBangkok}>` as soft
  guard. Validator value carries `neededBy: string | null` (always
  present — `exactOptionalPropertyTypes`-safe; the happy-path `toEqual`
  pin in the existing test breaks FIRST by design).
- **Write path:** INSERT-time only, by the requester. Zero
  grant/policy/trigger change (authenticated INSERT is table-level on
  purchase_requests). NOT editable post-insert in v1 (UPDATE policy
  excludes site_admin; an SA-edit RPC is a recorded seam).
  `decidePurchaseRequest` untouched.
- **appsheet_writer:** auto-visible via table-level SELECT; must NOT be
  writable — pgTAP pins
  `has_column_privilege('appsheet_writer', …, 'needed_by', 'UPDATE') = false`
  and smoke asserts 42501. **Operational requirement (not a note):**
  `needed_by` — and every non-granted purchase_requests column — must
  be marked read-only in the AppSheet column config, or every AppSheet
  row save on a view that surfaces it fails 42501 wholesale (AppSheet
  UPDATEs SET every editable column). Amend
  `docs/go-live-checklist.md` §2a with this step; it precedes the
  Tier-2 re-run.
- **Display:** `/requests` card fact line
  `ต้องการรับของภายใน {formatThaiDate}`; `/pm/requests` adds
  `needed_by` to its select and renders the same line beside ขอเมื่อ
  (urgency signal).
- New `formatThaiDate(iso)` (date-only, Buddhist era, Asia/Bangkok,
  invalid input degrades to the raw string) beside `formatThaiDateTime`
  in `src/lib/i18n/labels.ts`.

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
- **Display (Q4 locked: dates only, no comparison badge):** `/requests`
  card, status approved|purchased with eta non-null:
  `คาดว่าจะได้รับของ {formatThaiDate}`; hidden once delivered. Footer
  gains: `ฝ่ายจัดซื้อจะอัปเดตวันที่คาดว่าจะได้รับของจากระบบหลังบ้าน`.
  `/pm/requests` shows only `requested` rows (eta cannot exist there) —
  no change. LINE notification on late ETA stays out of scope (tracker
  open question).

## 4. Attachments — reference images + links (P2)

### Table — one table, kind discriminator, triple-enforced append-only, tombstone removal

```sql
create type public.purchase_request_attachment_kind as enum ('image','link');
create table public.purchase_request_attachments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  kind                public.purchase_request_attachment_kind not null,
  storage_path        text,   -- image content rows only; canonical, server-built
  url                 text,   -- link content rows only
  superseded_by       uuid,   -- tombstone rows only (ADR 0015 pattern); composite FK below
  created_by          uuid not null references public.users(id),
  created_at          timestamptz not null default now(),
  -- Tombstones carry no payload; content rows carry exactly one payload per kind.
  constraint pra_tombstone_shape check (superseded_by is null or (storage_path is null and url is null)),
  constraint pra_image_shape check (kind <> 'image' or superseded_by is not null or (storage_path is not null and length(trim(storage_path)) > 0 and url is null)),
  constraint pra_link_shape  check (kind <> 'link'  or superseded_by is not null or (url is not null and storage_path is null)),
  constraint pra_url_shape   check (url is null or (url ~* '^https?://' and length(url) <= 2048)),
  -- Same-parent + same-kind tombstoning is a DB invariant, not app courtesy:
  constraint pra_identity_uniq unique (id, purchase_request_id, kind),
  constraint pra_supersede_fk foreign key (superseded_by, purchase_request_id, kind)
    references public.purchase_request_attachments (id, purchase_request_id, kind)
);
create index purchase_request_attachments_pr_idx
  on public.purchase_request_attachments (purchase_request_id);
-- One tombstone per target; also the ADR 0009 anti-join index.
create unique index purchase_request_attachments_supersede_uniq
  on public.purchase_request_attachments (superseded_by)
  where superseded_by is not null;
```

No `updated_at`. **Append-only is triple-enforced like audit_log:** (1)
revoke-all-first then re-grant (below); (2) RLS with no UPDATE/DELETE
policies; (3) a `purchase_request_attachments_block_write()` BEFORE
UPDATE OR DELETE **OR TRUNCATE** trigger raising `P0001` (audit_log
precedent — TRUNCATE included; this table is more security-relevant
than photos). pgTAP `throws_ok` pins all three.

**Removal (Q2 locked) is an INSERT, never a DELETE:** the requester
removes an attachment while the parent is still `requested` by
inserting a **tombstone** row — same `kind` (composite-FK-enforced),
both payloads NULL, `superseded_by` = the removed content row's id
(load the `supersede-pattern` skill when implementing). Current-state
read = ADR 0009/0015: content rows (`superseded_by IS NULL`) with the
anti-join. The removed image's Storage object stays (orphan-accepted,
photos precedent). After the PM decides, the parent leaves `requested`
and the INSERT policy freezes the set (modulo the recorded TOCTOU
race, ADR 0026 §(g)).

**No audit trigger** (repo precedent: content creation is unaudited;
the immutable rows attributed by `created_by`+`created_at` — including
tombstones — ARE the record).

### Capability-token side table (P3's credential lives OUTSIDE the append-only table)

Rotation of a leaked token must not require violating append-only.
Tokens therefore live in a 1:1 side table that is mutable by service
role only:

```sql
create table public.purchase_request_attachment_tokens (
  attachment_id uuid primary key references public.purchase_request_attachments(id) on delete cascade,
  access_token  uuid not null default gen_random_uuid(),
  rotated_at    timestamptz
);
```

- Rows are created by an AFTER INSERT trigger on
  `purchase_request_attachments` (SECURITY DEFINER, search_path pinned,
  ADR 0011 checklist) for **image content rows only** (links need no
  token; tombstones never get one).
- **Rotation** = a service-role `UPDATE … set access_token =
gen_random_uuid(), rotated_at = now()` — no block-write trigger here
  by design; the recorded rotation seam.
- Grants/RLS: `revoke all from anon, authenticated` (deny-all — no
  policies for them; browser principals can NEVER read a token);
  RLS enabled; `grant select to appsheet_writer` + explicit policy
  `for select to appsheet_writer using (exists (select 1 from
public.purchase_request_attachments a where a.id =
purchase_request_attachment_tokens.attachment_id))` — the subquery
  runs under appsheet's attachments RLS, so token visibility inherits
  the approved/purchased/delivered gate. (Outer reference qualified —
  name-capture hazard.)

### Grants — revoke-all-first (platform default privileges), then re-grant

- Attachments table: `revoke all … from anon, authenticated;` then
  `grant select on … to authenticated;` and
  `grant insert (id, purchase_request_id, kind, storage_path, url,
superseded_by, created_by) on … to authenticated;` (`created_at`
  fills from default; `id` is client-pre-assigned for the storage
  path, photos precedent). No UPDATE/DELETE grants.
- Both views: `revoke all … from anon, authenticated;` then re-grant
  per view below.
- appsheet_writer: base-table `grant select` (separate role-touching
  migration). No INSERT/UPDATE/DELETE anywhere (smoke asserts 42501).
- PostgREST idiom pin: the repo's `.insert({…}).select("id")` works
  against these grants; supabase-js inserts without `.select()` use
  `return=minimal` and need no SELECT privilege.

### RLS (enabled in the table migration)

- SELECT `"select via parent"` TO authenticated:
  `using (exists (select 1 from public.purchase_requests pr where pr.id = purchase_request_id))`
  — visibility mirrors purchase_requests exactly (SA own;
  PM/procurement/super all).
- INSERT `"insert by request owner while pending"` TO authenticated —
  **outer references inside the self-referential subquery MUST be
  table-qualified** (unqualified `superseded_by` would capture
  `target`'s own column and break the branch):

```sql
with check (
  public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
  and created_by = auth.uid()
  and exists (select 1 from public.purchase_requests pr
              where pr.id = purchase_request_id
                and pr.requested_by = auth.uid()
                and pr.status = 'requested')
  and (superseded_by is null
       or exists (select 1 from public.purchase_request_attachments target
                  where target.id = purchase_request_attachments.superseded_by
                    and target.purchase_request_id = purchase_request_attachments.purchase_request_id
                    and target.superseded_by is null))
)
```

— only a requester-capable role (parity with the parent INSERT
policy; a demoted visitor can no longer write), only the requester,
only while undecided; a tombstone must target a CONTENT row of the
SAME parent (policy + composite FK; the partial unique index blocks
double-tombstoning, including concurrently). Negative pgTAP
role-simulation cases prove: non-owner INSERT onto a foreign
requested parent denied; tombstone targeting another request's
attachment denied; tombstone-of-tombstone denied; owner tombstone on
own pending parent succeeds.

- appsheet_writer (separate role-touching migration, 140100 precedent):
  explicit policy
  `for select to appsheet_writer using (exists (select 1 from public.purchase_requests pr where pr.id = purchase_request_id and pr.status in ('approved','purchased','delivered')))`
  — status list written explicitly (defense in depth against the
  parent's `-- future: source='appsheet'` seam). No
  `current_user_role()`/`auth.uid()` in its policies (NULL for this
  role — NEVER rule).

### Current-state views (security_invoker — base RLS applies to the querying role)

```sql
create view public.purchase_request_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_request_id, a.kind, a.storage_path, a.url,
         a.created_by, a.created_at
  from public.purchase_request_attachments a
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_request_attachments t
                    where t.superseded_by = a.id);
-- revoke all from anon, authenticated; then:
grant select on public.purchase_request_attachments_current to authenticated;

create view public.purchase_request_attachments_appsheet
  with (security_invoker = true) as
  select a.id, a.purchase_request_id, a.kind, a.storage_path, a.url,
         a.created_at, tok.access_token
  from public.purchase_request_attachments a
  left join public.purchase_request_attachment_tokens tok
    on tok.attachment_id = a.id
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_request_attachments t
                    where t.superseded_by = a.id);
-- revoke all from anon, authenticated; then:
grant select on public.purchase_request_attachments_appsheet to appsheet_writer;
```

App pages read `_current`. AppSheet reads `_appsheet` (token feeds the
P3 image URL; links directly clickable). `security_invoker` checks the
INVOKER's privileges + RLS on the base tables — consistent with the
grants above (authenticated cannot project `_appsheet`: no token-table
privilege; PG15+ required — implementation check). The anti-join has no
RLS blind spot: a tombstone and its target share a parent, so per-role
visibility of `a` and `t` is identical.

### Storage — private bucket, path-bound upload policy

- New **private** bucket `pr-attachments` declared by migration (clone
  of `20260524040000`): `public=false`, `file_size_limit=26214400`,
  `allowed_mime_types = {image/jpeg,image/png,image/webp,image/heic}`
  (Q3 locked). Do NOT reuse `photos` (its path contract is
  WP/photo_log-linked).
- **Upload policy binds the path to the caller's own pending request.**
  Inside the subquery, the outer object key MUST be qualified
  `objects.name` — `work_packages.name` would capture an unqualified
  `name` (the second name-capture blocker):

```sql
create policy "pr attachment uploads by request owner"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      join public.work_packages wp on wp.id = pr.work_package_id
      where pr.id::text = (storage.foldername(objects.name))[2]
        and wp.project_id::text = (storage.foldername(objects.name))[1]
        and pr.requested_by = auth.uid()
        and pr.status = 'requested'
    )
  );
```

Cross-project namespace writes are closed. No SELECT/UPDATE/DELETE
storage policies — reads only via service-role batched signed URLs
(and the P3 bridge); append-only `upsert:false`; orphans from
abandoned uploads and removed images accepted; attachment truth = the
table, never the bucket. The Tier-2 smoke MUST include a
positive-path upload probe — a qual that merely "contains
foldername" passes broken SQL.

- **Path:** `{project_id}/{purchase_request_id}/{attachment_id}.{ext}`
  — new pure module `src/lib/purchasing/attachment-path.ts`
  (`buildPrAttachmentStoragePath`), reusing `isValidUuid`,
  `mimeToPhotoExt`, `PHOTO_EXTS` from `@/lib/photos/path`.

### Upload UX — staged-at-create pipeline + recovery/removal expander

1. SA stages images (pre-assigned `crypto.randomUUID()` + ext;
   unsupported MIME → phase-uploader copy verbatim) and links
   (client-validated) before submit; staged chips removable (ลบ) — pure
   client state.
2. Submit → `createPurchaseRequest` (now also inserting `needed_by`) →
   `{ok:true, id}`. บันทึกแล้ว shows immediately; attachment failures
   never roll back the request.
3. Per staged image, sequentially: browser uploads bytes direct to
   `pr-attachments` under the user session (`upsert:false`) at the path
   built from the returned id + `projectId`, then calls new server
   action `addPurchaseRequestAttachment({purchaseRequestId, kind, …})`
   — metadata only, never a client path. Links: action call only.
   `projectId` sourcing: the pinned-WP query in `/requests/page.tsx`
   **already selects `project_id`** (no select change; the form prop
   gains `projectId`); the **own-rows WP lookup**
   (`select("id, code, name")`) must ADD `project_id` and pass it
   per-card to the recovery expander.
4. The action: strict per-kind validation (uuid/ext via the path
   module; trim + `^https?://` + ≤2048 via new
   `src/lib/purchasing/validate-attachment.ts`), `auth.getUser()`,
   reads the PR joined to `work_packages.project_id` under **caller
   RLS** (`maybeSingle`, no existence leak), **reconstructs the
   canonical storage_path server-side**, INSERTs under the user session
   (RLS pins role+owner+pending), `revalidatePath('/requests')`.
5. Per-item state machine cloned from phase-uploader
   (`uploading → upload-error` retry re-uploads same uuid;
   `inserting → insert-error` retry replays the action only). New
   client component
   `src/components/features/purchase-request-attachment-stager.tsx`
   (justified: file input + per-tile state machine).
6. **Recovery + removal:** own `/requests` cards with
   `status='requested'` get an เพิ่มรูปหรือลิงก์ expander reusing the
   stager with the known PR id, and each displayed attachment gets a ลบ
   control (`window.confirm` `ลบรายการแนบนี้หรือไม่?` — photo-remove
   precedent) calling new server action
   `removePurchaseRequestAttachment({attachmentId})`, which inserts the
   tombstone under the user session (RLS enforces
   role+own+pending+same-parent). Once the PM decides, both controls
   disappear with the status.

### Signed URLs + display

- New `server-only` `src/lib/purchasing/attachment-signed-urls.ts`
  cloning `mintSignedUrlsForPhotos` against `pr-attachments`
  (`createAdminClient()`, batched `createSignedUrls(paths, 120)`, Map
  keyed by attachment id, per-entry errors skipped, URLs never
  persisted). Pages feed it ONLY attachment rows already selected for
  render under caller RLS (ADR 0026 records the broader-than-photos
  exposure radius for PM/procurement/super).
- `/requests` + `/pm/requests`: one
  `.in('purchase_request_id', ids)` query against
  `purchase_request_attachments_current` under caller RLS (ordered by
  `created_at`); headings รูปอ้างอิง (lazy thumbnails; tap-to-enlarge
  reuses `ZoomablePhoto`) and ลิงก์อ้างอิง (anchors
  `target="_blank" rel="noopener noreferrer nofollow"`, truncated
  display — never embedded; user-supplied URLs).

## 5. AppSheet image bridge (P3 — Q1 locked: required; gated on ADR 0027)

Purchase admins work in AppSheet, which connects as a raw Postgres role
(no JWT, no Storage API) — it can never consume the app's 120-s signed
URLs. The bridge is a **capability URL**: an unguessable per-attachment
link that renders the image with no login, usable inside AppSheet's
image/URL column types.

- **Token** lives in the P2 side table (§4) — readable ONLY by
  appsheet_writer and service role; rotation is a plain service-role
  UPDATE (no append-only conflict).
- **Route (code-only, no migration):**
  `src/app/api/pr-attachments/[attachmentId]/route.ts` — GET with
  `?t=<token>`: validates both uuids, queries
  **`purchase_request_attachments_appsheet` via the admin client**
  (the view pre-encodes kind/current-state/token — hand-rolling the
  anti-join here is the exact ADR 0009 trap), compares tokens with
  `crypto.timingSafeEqual`, then 302 to a fresh 60-s signed URL. Any
  failure → 404 (bad id, bad token, tombstoned, non-image, and
  mint-failure are indistinguishable). `Cache-Control: no-store` on
  BOTH the 404 and the 302. No listing endpoint; no session.
- **AppSheet config (go-live checklist §2a amendment):** virtual column
  `CONCATENATE("https://prc-ops.vercel.app/api/pr-attachments/", [id], "?t=", [access_token])`
  on the `_appsheet` view, typed Image/URL.
- **Posture (ADR 0027):** anyone holding a link can view that one
  reference image until its token is rotated; accepted because (a) the
  bucket holds requester-chosen reference images only, never site
  progress photos; (b) tokens are UUIDv4 (≈122 random bits) per
  attachment; (c) the trusted-role sharing vector is recorded; (d)
  rotation = the token-table UPDATE seam (shipping a rotation action is
  a follow-up).

## 6. Migrations in order

1. `20260613100000_add_purchase_requests_needed_by_eta.sql` — two
   `add column … date` + column comments. [P1]
2. `20260613100100_appsheet_writer_eta_grant_and_audit.sql` —
   `grant update (eta)` + audit function CREATE OR REPLACE (8th diff
   branch only) + trigger drop/recreate (8th WHEN predicate). One
   migration: no writable-but-unaudited-corrections window.
   Role-touching → Tier-2 smoke re-run mandatory. [P1]
3. `20260613100200_create_purchase_request_attachments.sql` — enum +
   attachments table (CHECKs, composite FK, indexes) + token side table
   - token-creation trigger + RLS enable on both + **revoke-all-first**
   - column-scoped authenticated grants + the two authenticated
     policies + block-write function/triggers (UPDATE/DELETE/TRUNCATE) +
     the `_current` view (revoke-first + grant). [P2]
4. `20260613100300_grant_appsheet_writer_attachments_select.sql` —
   appsheet_writer grants (attachments table, token table) + the two
   explicit TO appsheet_writer policies + `_appsheet` view
   (revoke-first + grant). Separate role-touching migration, reviewable
   in isolation. [P2]
5. `20260613100400_create_pr_attachments_bucket.sql` — idempotent
   private bucket insert + the single path-bound storage INSERT
   policy. [P2]

After each phase's migrations: `pnpm db:push` → `pnpm db:types` →
`pnpm db:test`.

## 7. Tests

**Vitest (failing test FIRST, stated explicitly):**

1. NEW `tests/unit/purchase-request-units.test.ts` — COMMON_UNITS
   pinned (exact list, no dupes/blanks, ≤50 chars trimmed);
   UNIT_OTHER_VALUE not in the list. [P1]
2. UPDATE `tests/unit/validate-purchase-request.test.ts` — happy-path
   `toEqual` pin gains `neededBy: null` (breaks first by design); new
   cases: omitted→ok/null; today/future ok; past (Bangkok)→error
   /วันที่ต้องการรับของ/; malformed→error. Existing pins untouched.
   Today-Bangkok computed at runtime; tolerate the midnight boundary.
   [P1]
3. NEW `tests/unit/format-thai-date.test.ts` — Buddhist-era date-only
   output; invalid input → raw passthrough. [P1]
4. NEW `tests/unit/validate-attachment.test.ts` — link: https?://
   required, trim, ≤2048, rejects javascript:/data:/ftp:/bare-host;
   image: uuid+ext gates; Thai error copy pins. [P2]
5. NEW `tests/unit/pr-attachment-path.test.ts` —
   `buildPrAttachmentStoragePath` shape + bad-uuid/ext rejection. [P2]

**Declared verified-by-checklist posture** (spec-15 precedent):
`attachment-signed-urls.ts` (clone of the untested photos precedent),
the `addPurchaseRequestAttachment` / `removePurchaseRequestAttachment`
action wiring, the stager component, the P3 route handler, and the
form/page surfaces are verified by lint/typecheck/build/e2e + the
checklist below; the pure seams carrying failing-first tests are the
five files above (P3 extracts a pure token-comparison helper with its
own test if non-trivial).

**pgTAP:**

- `17-purchase-requests.test.sql` — `has_column` + type `date` +
  nullable for needed_by/eta; SA INSERT carrying needed_by persists;
  derive-trigger pass-through unaffected by an eta-only update; named
  existence checks for any new policy (no total-count pins). [P1]
- `18-appsheet-writer-purchasing.test.sql` —
  `has_column_privilege(eta, UPDATE)=true` (8 permitted);
  `(needed_by, UPDATE)=false` (protected set → 4); regression guards:
  `pg_get_triggerdef` contains `eta`, `pg_get_functiondef` contains the
  eta diff branch; payload-shape pins: purchase-transition payload keys
  exactly {principal,supplier,order_ref,amount,purchased_at} (no eta);
  eta-only update on an approved row emits an `update` row whose
  `changed` contains eta. [P1]
- NEW `19-purchase-request-attachments.test.sql` — tables/columns/types
  (incl. composite FK, token table + default + trigger-created rows);
  enum exactly {image,link}; FK cascades; named CHECKs reject bad
  shapes (`throws_ok`: image+url, link+path, ftp:// url, blank path,
  tombstone carrying a payload, cross-kind tombstone via composite FK,
  cross-parent tombstone via composite FK); partial unique index blocks
  double-tombstone; `relrowsecurity` on both tables; named policies
  with pinned roles/cmds; zero UPDATE/DELETE policies; privilege
  matrix: authenticated select+insert(column-scoped) on attachments /
  NOTHING on tokens; appsheet select on both / no writes anywhere; anon
  nothing; **policy qual text pins the table-qualified outer references**
  (`purchase_request_attachments.superseded_by`) — an unqualified
  rewrite must fail the suite; appsheet policy qual contains all three
  status literals; **block-write: UPDATE, DELETE and TRUNCATE all
  `throws_ok` P0001**; role-simulation: non-owner INSERT onto a foreign
  requested parent denied; tombstone targeting another request's
  attachment denied; tombstone-of-tombstone denied; owner tombstone on
  own pending parent succeeds; visitor (demoted) INSERT denied;
  `_current` excludes tombstoned content rows, has
  `security_invoker=true`, exposes no token; `_appsheet` grant matrix
  (appsheet only). [P2]
- NEW `20-pr-attachments-bucket.test.sql` — bucket exists,
  **`public=false`**, size limit, exact mime array (no PDF), the INSERT
  policy pinned **by name**, its qual contains `objects.name` AND
  `current_user_role` (the qualified form — "contains foldername" alone
  passes broken SQL). [P2]

**Tier-2 smoke (`supabase/scripts/smoke/appsheet_writer_p2.sql`) —
phase-tagged amendments, each probe in its own `begin/exception` block
(a missing-table reference must not abort the ritual):**

- [P1 probes, run after migration 2]: eta UPDATE on an approved row
  permitted; needed_by UPDATE → [PASS] on 42501; keep the existing
  item_description denied probe.
- [P2 probes, land in the same PR as migration 4, run **after the P2 UI
  ships** — hard go-live gate]: explicit operator fixture protocol
  cloning the SETUP-FAILED pattern (operator creates two requests via
  the app, attaches image+link to both, **uploads succeed** — the
  positive-path probe for the storage policy — removes one attachment
  to create a tombstone, leaves one request pending and has the PM
  approve the other; the script raises SETUP FAILED if no attachment
  rows exist): attachments of the requested parent → 0 rows; of the
  approved parent → visible; `_appsheet` excludes the tombstoned row
  and exposes access_token; attachments INSERT/UPDATE/DELETE → 42501;
  token-table read returns rows / writes → 42501.
- [P3 verification, not smoke]: route — bad id/token → 404 (no-store);
  good pair → 302 (no-store) to a working short-TTL URL; tombstoned
  attachment → 404; image renders inside AppSheet via the virtual
  column.

## 8. Thai display strings (spec-14 glossary-conformant)

| Surface                                              | String                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unit label / error (unchanged pins)                  | หน่วย / หน่วยต้องไม่ว่าง                                                            |
| Unit select placeholder / other option / other input | เลือกหน่วย / อื่น ๆ (ระบุเอง) / ระบุหน่วย                                           |
| needed_by form label                                 | ต้องการรับของภายใน (ไม่บังคับ)                                                      |
| needed_by fact line                                  | ต้องการรับของภายใน {วันที่}                                                         |
| needed_by errors                                     | วันที่ต้องการรับของไม่ถูกต้อง · วันที่ต้องการรับของต้องไม่เป็นวันที่ผ่านมาแล้ว      |
| eta fact line                                        | คาดว่าจะได้รับของ {วันที่}                                                          |
| Footer addition (/requests)                          | ฝ่ายจัดซื้อจะอัปเดตวันที่คาดว่าจะได้รับของจากระบบหลังบ้าน                           |
| Attachments form section                             | รูปและลิงก์อ้างอิง (ไม่บังคับ)                                                      |
| Attach buttons / expander                            | แนบรูป / เพิ่มลิงก์ / เพิ่มรูปหรือลิงก์                                             |
| Staged chip remove / retry                           | ลบ / ลองใหม่                                                                        |
| Saved-attachment remove + confirm                    | ลบ / ลบรายการแนบนี้หรือไม่?                                                         |
| Remove failed                                        | ลบรายการแนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง                                           |
| Progress states                                      | กำลังอัปโหลด… / กำลังบันทึก…                                                        |
| Unsupported file / upload failed                     | phase-uploader copy verbatim                                                        |
| Metadata save failed (image / link)                  | บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง / บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง |
| Invalid link / link placeholder                      | ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// / https://…                              |
| Card display headings                                | รูปอ้างอิง / ลิงก์อ้างอิง                                                           |

All dates via `formatThaiDate`; error suffix convention
กรุณาลองใหม่อีกครั้ง preserved.

## 9. Operator decisions (locked 2026-06-11)

- **Q1 — AppSheet image viewing: REQUIRED** → P3 capability-URL bridge
  - ADR 0027 (§5). The read-only-procurement-page alternative is the
    recorded longer-term replacement when the `procurement` role gets an
    in-app surface.
- **Q2 — attachment removal while pending: ALLOWED** →
  tombstone-supersede (§4); post-decision the set freezes (modulo the
  recorded TOCTOU race). Post-approval ADDING remains default-deny
  (recorded seam).
- **Q3 — file types: images + links only.** PDFs are a recorded future
  decision (mime list + document tile end-to-end).
- **Q4 — late cue: NO badge.** eta and needed_by display plainly.

## 10. Out of scope

Post-approval attaching; PDF/quotation attachments (Q3); late-ETA
badge (Q4) and LINE notification; SA post-insert edit of needed_by
(recorded seam); the token-rotation ACTION (the seam ships; the action
is a follow-up); `amount` display (standing open question); everything
in the iteration-3 structural queue (header refactor, theme, PWA,
dialogs).

## 11. Verification checklist

- [ ] ADR 0026 merged before P1/P2 code, including all in-place
      back-pointer edits (ADR 0018 matrix, ADR 0022 ×2, ADR 0025);
      ADR 0027 merged before P3 code.
- [ ] New unit tests RED before each pure module exists, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass per phase.
- [ ] `pnpm db:push` → `pnpm db:types` → `pnpm db:test` green per
      phase; updated plan counts.
- [ ] pgTAP: block-write P0001 throws_ok (UPDATE+DELETE+TRUNCATE),
      tombstone shape + composite-FK + uniqueness + policy branches,
      token-table privilege matrix (authenticated = nothing), view
      security_invoker + column sets, qualified-policy-text pins,
      policy-name pins, audit payload-shape pins all present.
- [ ] Tier-2 smoke re-run after migration 2 [P1] and after the P2 UI
      ships [P2] with the operator fixture protocol incl. the
      positive-path upload probe; AppSheet column config (needed_by
      read-only; bridge virtual column on `_appsheet`) done per
      go-live checklist §2a amendment.
- [ ] `pnpm build` + `pnpm test:e2e` pass.
- [ ] Locked behaviors intact: spec-10 pinned-form modes, spec-12
      back-nav, spec-14 glossary, spec-15 fact-line display; enum
      values/routes/redirects untouched.
- [ ] No dashboard changes; bucket created private and pgTAP-pinned.
- [ ] P3: route 404s on bad id/token/tombstone, 302s on good pair, both
      `no-store`; image renders inside AppSheet via the virtual column.
