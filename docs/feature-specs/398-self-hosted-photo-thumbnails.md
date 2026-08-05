# Spec 398 — รูปย่อที่เก็บเอง (self-hosted photo thumbnails)

**Status:** DESIGN, 2026-08-05. Operator-directed the same day. Not yet built.
**No schema.** Code + one backfill script; the schema lane (held by lane `attend`) is not needed
— see D2, which is the decision that removes the migration.

**Operator ask (2026-08-05):** the Supabase dashboard showed a warning; asked to check it, then
asked which of three options to take and chose **C — stop using the Storage image-transformation
API and serve thumbnails we generate and store ourselves.**

---

## 1. Why

The org badge on the Supabase dashboard reads **`EXCEEDING USAGE LIMITS`**. One metric is over,
and it is over by a lot:

| Metric                            | Used / included |          |
| --------------------------------- | --------------- | -------- |
| **Storage Image Transformations** | **689 / 100**   | **689%** |
| Egress                            | 11.40 / 250 GB  | 5%       |
| Storage Size                      | 1.72 / 100 GB   | 2%       |
| Cached Egress                     | 0.18 / 250 GB   | <1%      |
| Monthly Active Users              | 30 / 100,000    | <1%      |

Billing cycle 19 Jul – 19 Aug; overage 589. Dashboard copy, verbatim: _"You have exceeded your
Pro Plan quota in this billing cycle. Disable your spend cap to continue using Supabase without
restrictions."_ The spend cap is **ON**, so Supabase does not bill the overage — it restricts.

### The single cause

`src/lib/photos/mint-thumbnails.ts:39` mints a transformed signed URL **per photo**:

```ts
transform: { width: THUMB_SIZE, height: THUMB_SIZE, resize: "contain" }
```

Supabase counts **distinct origin images transformed per billing cycle**. The `photos` bucket
holds **2,768 objects (1,633 MB)**, **2,268 of them uploaded in July alone**. Two surfaces call
it — the schedule calendar photo strips (`src/app/projects/[projectId]/schedule/actions.ts:69`)
and the WP-catalogue reference section
(`src/components/features/wp-catalog/reference-photo-section.tsx:61`) — so the counter tracks
how many distinct photos anyone scrolls past. **100/month was never going to hold**, and the
included allowance does not grow with the plan we are on.

### It is NOT currently broken — measured, not assumed

Probed the live render path as service role, signing the exact URL shape the app produces:

| Probe                                       | Result                                                         |
| ------------------------------------------- | -------------------------------------------------------------- |
| Recent photo, 320×320 (the app's real size) | `HTTP 200 image/jpeg` **9,918 B** (full 567,693)               |
| **Oldest photo (2026-06-20), 317×317**      | `HTTP 200 image/jpeg` **20,094 B** (full 1,229,276)            |
| Plain signed URL, both photos (control)     | `HTTP 200` — proves auth + object, so the 200s are not a fluke |

The second row is the one that settles it: an **unusual size on the oldest object in the bucket
cannot be a CDN cache hit**, so the transformer rendered it fresh while the org sat at 689%.

⭐ **So this spec is not an outage response.** The cost of doing nothing is not a broken screen
today — it is that `mintPhotoThumbnails` **swallows the error and drops the photo**
(`if (thumb?.error || !thumb?.data?.signedUrl || !fullUrl) continue`), so the day Supabase does
start restricting, photo strips go **silently blank** with no error anywhere. That is the risk
being bought out.

---

## 2. Decisions

**D1 — Generate and store our own thumbnails; stop calling the transformation API.**
The alternatives were weighed and rejected: _disable the spend cap_ (~$3 this cycle, ~$11/mo at
July's photo rate — buys time, fixes nothing, and the meter stays armed); _drop the transform and
serve full-size_ (free, but 600 KB–1.2 MB per tile to a gloved hand on site 4G — it punishes
exactly the users the app exists for).

**D2 — Thumbnails live at a DERIVED KEY in the EXISTING `photos` bucket. No new bucket, no
migration, no schema lane.** Queried live: `photos.allowed_mime_types` is
`{image/jpeg, image/png, image/webp, image/heic}` — **webp is already allowed** — and
`file_size_limit` is 25 MB. So a thumbnail is just another object in a bucket whose Storage RLS
policy already exists and already covers it. This is what turns a danger-path migration PR into
a code-only one. Extra objects are invisible to app logic: nothing lists the bucket, every reader
addresses an explicit `storage_path`.

**D3 — The key is `thumbs/<storage_path>.webp`.** Derived, not stored: no column on
`photo_logs` (which is append-only, so a column would be a migration AND a backfill). Paths are
uuid-keyed (`<project>/<wp>/<photo-id>.jpeg`) and therefore **ASCII by construction** — the
`supabase-storage-key-ascii` trap does not bite here, but the key builder must not invent
non-ASCII either, and a test pins that.

**D4 — A missing thumbnail falls back to the FULL-SIZE url, deliberately NOT to the transform.**
Keeping transform as the fallback leaves the meter armed: it would work, decay quietly, and blow
again with nobody watching. Falling back to full-size is honest — a slower tile, never a missing
one. ⚠️ **This fallback is load-bearing**: both callers DROP a photo whose URL is absent
(`schedule/actions.ts:76` `if (!url) continue`, `reference-photo-section.tsx:65` `flatMap`), so a
miss must degrade to a big image, never to a vanished photo.

**D5 — New thumbnails are generated server-side after the metadata insert, via `after()` from
`next/server` — the offline upload queue is NOT touched.** Generating client-side at capture is
the theoretically cheapest option and is rejected: the queue (ADR 0039, `src/lib/photos/upload-queue.ts`)
is evidence-critical, its invariant is _"an item is removed ONLY after both steps succeed"_, and
adding a third artifact to that pipeline risks the one thing in this app that must not lose data.
`after()` is **stable since Next 15.1** (repo is on 16.3.0), valid in Server Components, Server
Functions and Route Handlers, and on Vercel is backed by `waitUntil`, so the work survives the
response.

**D6 — Existing photos are backfilled by a one-off script, not lazily on read.** Lazy generation
was considered (self-backfilling, converges on exactly the photos people view) and rejected as
the primary mechanism because it makes the first view of every photo slower forever and makes
the acceptance metric unmeasurable. The backfill is ~2,768 downloads ≈ **1.7 GB one-time egress,
0.7% of the 250 GB budget**.

---

## 3. Units

**U1 — the thumbnail store (code + script, no schema).**

- `src/lib/photos/thumb-key.ts` — pure `thumbKeyFor(storagePath): string`, the SSOT for D3.
  ASCII-only assertion pinned.
- `src/lib/photos/generate-thumb.ts` — download an object, `sharp().resize(320, 320, { fit: "inside" }).webp()`,
  upload at the derived key with `upsert: false` (so a concurrent generation 409s harmlessly,
  the same idempotence shape the upload queue already relies on).
- `scripts/backfill-photo-thumbs.ts` — walk `photo_logs` where `storage_path is not null`,
  skip keys that already exist, generate the rest. Resumable, rate-limited, prints a running
  count. **Run against prod as part of this unit; its output is the unit's evidence.**
- ⚠️ **Gate-check first: `sharp` is a root dependency (`^0.35.3`) but is used NOWHERE in `src/`
  today** — only `spikes/01-pdf-generation/generate-fixtures.ts`. U1 is its first production
  use. Confirm it loads in the Vercel Node runtime before U2 depends on it.

**U2 — generate on write.** Hook the photo metadata insert path so a newly-inserted
`photo_logs` row schedules `generatePhotoThumb` in `after()`. Covers the offline queue for free:
the queue's `insertMeta` calls the same server action, so a replayed upload gets a thumbnail on
the same path as a live one. Failure is non-fatal and logged — a photo without a thumbnail still
renders (D4).

**U3 — flip the reader and DELETE the transform.** `mintPhotoThumbnails` mints thumb URLs with
the bulk `createSignedUrls` (no `transform` option ⇒ **zero** transformation quota), falls back
to the full-size URL per D4, and the `transform:` block goes. **Ships only after U1's backfill
has run**, so the fallback is rare rather than universal.

---

## 4. Acceptance

- **The metric, not the code:** `Storage Image Transformations` stops climbing. Re-read the org
  usage page ≥24 h after U3 deploys (the counter refreshes every 24 h) and confirm the cumulative
  figure is flat. It will NOT drop — the count is cumulative for the cycle and resets 19 Aug.
- Thumb objects exist for ≥99% of `photo_logs` rows with a `storage_path`, verified by a count,
  not by a spot check.
- A schedule photo strip and a WP-catalogue reference section both render every photo they
  rendered before, at a comparable byte size (~10–20 KB/tile, i.e. the transform's own output
  size — not 600 KB).
- Mutation check on D4: break the thumb lookup and confirm tiles fall back to full-size rather
  than disappearing.

---

## 5. Open / owed, deliberately not built

- **Superseded and tombstoned photos** keep their thumbnails (originals are append-only and are
  never deleted either). Harmless orphans, ~15 KB each. No cleanup path is proposed.
- **The other buckets are untouched.** `po-attachments` (154 MB), `contact-docs`,
  `feedback-attachments`, `expense-attachments` render no thumbnails today and are not part of
  this spec. If any of them grows a gallery, it must use this store, not the transform API.
- **Nothing surfaces quota health in-app.** The warning was found because the operator happened
  to look at the dashboard. A tile that reads the usage API is a real (small) feature and is not
  in scope here — recorded so the next person meets a decision, not a gap.
- **The spend cap stays ON and stays the operator's call.** This spec removes the pressure on it;
  it does not change a billing setting.
