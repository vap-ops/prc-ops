# Spec 354 — image capture-method telemetry

Status: 📝 SPEC — written 2026-07-24, in operator review. Not yet built.
Owner units: U0–U6 below
ADR: none — additive telemetry, no architecture change (bytes untouched; no schema; no behaviour change to any flow).

## 1. The ask

Operator, 2026-07-24: asked whether app images are **taken in-app (camera)** or
**uploaded (gallery/file)** more often, across **all** image surfaces.

Investigation this session found the question is **not answerable from stored
data today**:

- No table records a per-image capture method. `photo_logs` carries
  `captured_at_client` (untrusted device time) but no source/method column.
- EXIF is stripped on downscale — `preparePhotoForUpload` re-encodes anything
  > 2000px long-edge to JPEG 0.8 via canvas (`src/lib/photos/downscale.ts`),
  killing `DateTimeOriginal`/`Make`. So the stored bytes can't be sniffed either.
- The only measurable proxy is **which surface** a photo came from, and even the
  dominant surface (`photos` bucket, 2410 images) accepts BOTH camera and gallery
  input with no per-photo distinction (see §3).

This spec adds the missing signal: record, per uploaded image, **which input
affordance the user tapped**, queryable in one place.

## 2. Approach — storage metadata stamp (brainstorm-locked 2026-07-24)

Operator selected **Shape B: metadata stamp, all surfaces, no EXIF** over the
alternatives (per-table enum columns; EXIF heuristic).

> At every image `.upload()` call, pass
> `{ metadata: { captureMethod } }`. supabase-js persists it into
> `storage.objects.user_metadata` (jsonb). One query reads it back across every
> bucket. **Zero migrations, zero schema, zero backfill schema.**

Why Shape B over the alternatives:

- **Per-table columns (Shape A)** would add a `capture_method` enum column to ~7
  tables (7 additive migrations, schema-lane serialized, ~7–8 units), and some
  surfaces are storage-only (no DB row) so they'd need a side table anyway.
  Shape B collapses all of that into one home that every bucket already has.
- **EXIF heuristic** was declined (YAGNI): adds an EXIF-reader dependency, is a
  guess, and downscale strips EXIF right after we'd read it. The affordance flag
  is honest and sufficient.

**Bytes are never touched** — `user_metadata` is object metadata, separate from
the stored file. The ADR-level invariant "photos are stored unmodified" holds.

## 3. Live evidence (gate-checked 2026-07-24; re-verify at each build unit)

Storage object counts (image mimetype only), by bucket:

| bucket | images | dominant input mode |
| --- | ---: | --- |
| `photos` (WP progress + defect) | 2410 | camera shutter **+** library button **+** defect picker |
| `po-attachments` | 305 | picker |
| `feedback-attachments` | 58 | picker |
| `contact-docs` | 54 | picker |
| `pr-attachments` (delivery, receipt-flag) | 49 | camera-forced |
| `expense-attachments` | 17 | picker |
| `catalog-images` | 13 | picker |

(`reports`, `company-docs` = PDFs, not user images — excluded.)

Capability facts confirmed this session:

- `@supabase/supabase-js` `^2.105.2` — the storage `.upload()` `metadata`
  option is supported at this version.
- `storage.objects.user_metadata` column **exists** on the live DB (queried
  `information_schema.columns`).
- The `photos` bucket has **no** separate thumbnail objects (thumbnails mint
  on-the-fly via signed-URL transform — `mint-thumbnails.ts`); 2410 = real
  photos, no inflation.
- `addPhoto()` in
  `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts` is the
  single `photo_logs` writer — camera shutter, spec-96 library button, and
  defect (`phase:'defect'`) all route through it. But the actual **byte upload**
  for progress photos happens later in the queue runner
  (`upload-queue-runner.tsx:57`) / `use-phase-capture.ts:123`, and offline via
  the IndexedDB queue (`upload-queue-idb.ts`) — so the method must be carried on
  the **queue item**, not just the metadata insert (see U1).

## 4. Vocabulary — `CaptureMethod`

Three honest values, one absence:

| value | means | example inputs |
| --- | --- | --- |
| `camera` | input had `capture="environment"` — provably camera, OS opens the rear camera directly, no gallery choice | WP shutter, delivery-photo, proof-of-delivery (when its capture toggle is on), receipt-flag |
| `library` | explicit "เลือกจากคลังภาพ" gallery button (spec-96) — no `capture`, gallery intent | WP capture-sheet secondary path only |
| `picker` | plain `accept="image/*"` — OS chooser returns an identical File whether the user shot or picked (ambiguous) | WP defect + ~14 other surfaces |
| *(absent)* | unknown — all pre-existing objects; no retroactive backfill possible | the ~2900 objects already stored |

The value is **static per input element** (each `<input>` hardcodes its
affordance) — no runtime sensor detection. Each component passes the constant its
input represents.

## 5. Mechanism & SSOT

- **SSOT:** `src/lib/photos/capture-method.ts` exports the `CaptureMethod` union
  type + the three string constants. Every call site imports from here — no
  magic strings (per the project's term-consistency doctrine).
- **Stamp:** each image upload becomes
  `.upload(path, blob, { contentType, metadata: { captureMethod } })`.
- **Read (the deliverable query):**
  ```sql
  select bucket_id,
         coalesce(user_metadata->>'captureMethod','unknown') as method,
         count(*)
  from storage.objects
  where (metadata->>'mimetype') like 'image/%'
  group by 1, 2
  order by 1, 3 desc;
  ```

## 6. Surfaces inventory

Every image `.upload()` call site (from grep of `src/**`, 2026-07-24). Method
column = the affordance to stamp; **each must be re-confirmed against the input's
actual attribute at build time** (only the ones marked ✓ were read this session).

| # | call site | bucket | method |
| --- | --- | --- | --- |
| WP progress (U1) |
| 1 | `use-phase-capture.ts` / `upload-queue-runner.tsx` (shutter) | photos | `camera` ✓ |
| 2 | capture-sheet spec-96 library input | photos | `library` ✓ |
| 3 | `use-defect-photos.ts` (report-defect-control) | photos | `picker` ✓ |
| Purchasing / delivery (U2) |
| 4 | `delivery-photo-uploader.tsx` | pr-attachments | `camera` ✓ |
| 5 | `proof-of-delivery-uploader.tsx` (via delivery-proof-block `captureUploader` toggle) | pr-attachments | `camera`\|`picker` — toggle-dependent |
| 6 | `upload-receipt-flag-photo.ts` (receipt-flag-sheet) | pr-attachments | `camera` ✓ |
| 7 | `create-purchase-order-sheet.tsx` | po-attachments | verify |
| 8 | `invoice-uploader.tsx` | po/pr-attachments | verify |
| 9 | `purchase-request-attachment-stager.tsx` | pr-attachments | verify |
| 10 | `quote-doc-attach.tsx` | attachments | verify (may be PDF-only) |
| Expenses (U3) |
| 11 | `upload-expense-receipt.ts` | expense-attachments | verify |
| 12 | `upload-rental-receipt.ts` | expense/equipment | verify |
| Catalog / feedback (U4) |
| 13 | `catalog-image-control.tsx` | catalog-images | `picker` ✓ |
| 14 | `feedback-form.tsx` | feedback-attachments | `picker` ✓ |
| 15 | `report-issue-fab.tsx` | feedback-attachments | `picker` ✓ |
| Contacts / portal / profile / register (U5) |
| 16 | `add-technician-sheet.tsx` | contact-docs | `picker` ✓ |
| 17 | `contact-documents-block.tsx` | contact-docs | verify |
| 18 | `portal-documents.tsx` | portal/contact-docs | verify |
| 19 | `worker-id-card-update.tsx` | contact-docs | verify |
| 20 | `profile-bank-section.tsx` | contact-docs | verify |
| 21 | `staff-registration-form.tsx` | contact-docs | verify |
| 22 | `payout-nominee-form.tsx` | payroll/contact-docs | verify |
| Excluded (not user images) |
| — | `upload-company-doc.ts` | company-docs | PDF — skip |
| — | `run-report-job.ts` | reports | generated PDF — skip |

## 7. Units

**U0 — spike: prove the deployed client persists `metadata`.**
`src/lib/photos/path.ts:71` warns that deployed-client `.upload()` behaviour has
surprised the team before. Before instrumenting 20 sites, prove it once: upload a
throwaway object (browser anon client AND server client) with
`{ metadata: { captureMethod: 'camera' } }`, then query
`storage.objects.user_metadata` and confirm the value landed. **If it does not
persist, STOP and report — no silent fallback** (library-discipline rule). This
is the gate the whole spec rests on.

**U1 — SSOT + WP photos (`photos` bucket).**
Create `src/lib/photos/capture-method.ts`. Thread `captureMethod` through the
progress-photo queue item (including the IndexedDB-persisted offline queue —
old queued items with no field read as `unknown`/`picker`) so the runner's
`.upload()` stamps it; wire the shutter (`camera`), the spec-96 library input
(`library`), and the defect path (`picker`). Covers the 2410-image bucket.

**U2 — purchasing / delivery (`pr-attachments`, `po-attachments`).**
Sites 4–10. Confirm each input's attribute; delivery/PoD/receipt-flag =
`camera`, the rest per their actual affordance.

**U3 — expenses / rental (`expense-attachments`).** Sites 11–12.

**U4 — catalog / feedback (`catalog-images`, `feedback-attachments`).** Sites 13–15 (all `picker`).

**U5 — contacts / portal / profile / register.** Sites 16–22.

**U6 — the report.** The §5 query as the deliverable — either run ad-hoc and
report to the operator, or (optional) a small read-only tile on
`/settings/integrity`. The tile must label `picker` as **affordance, not
sensor** (see §9).

U1 writes the SSOT file; **U2–U5 only read it**, so after U1 lands they are
independent code-only lanes (different feature dirs). Serialize any *other* lane
that edits these upload components.

## 8. Non-goals

- **No backfill.** Existing ~2900 objects stay `unknown` — the method is
  unknowable retroactively.
- **No EXIF** sniffing.
- **No behaviour change** to any capture/upload flow — pure telemetry.
- **No PDF surfaces** (`company-docs`, `reports`).
- **No new UI beyond the U6 read** — this is a measurement feature, not a
  product change.

## 9. Known limitation — how to read the numbers (state this in the report)

`capture="environment"` provably means camera. A plain `accept="image/*"` picker
returns an **identical File** whether the user shot a new photo or chose an
existing one — so `picker` records the **affordance tapped, not the sensor
used**. Camera-vs-gallery is only truly answered on the `camera` and `library`
surfaces (essentially WP progress + field proof). The `picker` count answers
"how often the ambiguous attach path was used", not "how often people uploaded
vs shot". The U6 report must say so, or the number will be over-read.

## 10. Testing

- **Per unit, RED-first:** mock the storage client, assert the `.upload()` call
  receives `metadata.captureMethod === '<expected value>'`, and assert its
  absence before the change (mutation-checked both directions).
- **U0 is the real-flow proof** — a live round-trip, not a mock.
- **PDPA:** `captureMethod` is non-PII; no consent/RLS gate needed beyond the
  existing `storage.objects` policies.

## 11. Open questions

- **Site 5 (proof-of-delivery):** its capture is toggle-driven
  (`captureUploader`). Stamp the *actual* value per toggle state, or collapse to
  `picker`? Recommend: stamp the real per-call value — it's free once wired.
- **U6 surface:** ad-hoc SQL (cheapest) vs a `/settings/integrity` tile
  (discoverable, but a build). Recommend ad-hoc first; promote to a tile only if
  the operator wants it standing.
