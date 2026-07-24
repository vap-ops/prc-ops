# Image capture-method telemetry — Implementation Plan (spec 352)

> **For agentic workers:** each Unit is a `ship-unit` cycle (claim lane → gate-check LIVE → RED-first → verify → fresh-eyes → ship via `scripts/ship-pr.sh`). Load the `ship-unit` skill for every Unit. Steps use `- [ ]` for tracking. This plan is a 2026-07-24 snapshot — **gate-check every file/line against your worktree HEAD and the live DB before editing** (line numbers drift).

**Goal:** Record, per uploaded image, which input affordance the user tapped (`camera` / `library` / `picker`) into `storage.objects.user_metadata`, so "images taken in-app vs uploaded" becomes a one-query answer — across every image surface, with zero schema.

**Architecture:** A tiny SSOT (`src/lib/photos/capture-method.ts`) defines the vocabulary + a metadata builder. Every image `.upload()` gains a `metadata: { captureMethod }` option. Queued uploads (offline IDB queue) carry the value on the queue item so replay preserves it; direct uploads pass it inline. No DB migration, no behaviour change, no backfill.

**Tech Stack:** Next.js 16 App Router, `@supabase/supabase-js` ^2.105.2 (storage `FileOptions.metadata`, confirmed live), Vitest (jsdom), pgTAP (none needed here).

## Global Constraints (verbatim from spec 352)

- **Zero schema, zero migration.** The flag lives only in `storage.objects.user_metadata`. No `supabase/migrations/` file. (So no schema lane — this whole plan is code-only.)
- **Bytes untouched.** `metadata` is object metadata, not the file. The "photos stored unmodified" invariant holds.
- **No backfill.** Existing ~2900 objects stay absent → read as `unknown`.
- **No EXIF.** Do not add an EXIF reader.
- **No behaviour change** to any capture/upload flow — pure telemetry.
- **SSOT, no magic strings.** Every call site imports from `src/lib/photos/capture-method.ts`.
- **Method = affordance, static per input element.** No runtime sensor detection. Each input hardcodes its value.
- **`picker` = affordance, not sensor** — the U6 report must say so.

## Locked SSOT contract (Unit 1 creates this; all later units consume it verbatim)

```ts
// src/lib/photos/capture-method.ts
export const CAPTURE_METHODS = ["camera", "library", "picker"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** Storage upload `metadata` option that stamps the capture affordance into
 *  storage.objects.user_metadata (spec 352). Spread into the FileOptions:
 *    .upload(path, blob, { contentType, upsert: false, metadata: captureMethodMetadata("camera") })
 */
export function captureMethodMetadata(
  method: CaptureMethod,
): { captureMethod: CaptureMethod } {
  return { captureMethod: method };
}
```

## Shared test pattern (used in every Unit)

Mock the storage client's `upload`; assert the option is passed, and mutation-check the absence:

```ts
expect(uploadMock).toHaveBeenCalledWith(
  expect.any(String),
  expect.anything(),
  expect.objectContaining({ metadata: { captureMethod: "camera" } }),
);
```

RED-first proof: run the new assertion BEFORE the production edit and see it fail with "metadata: undefined" (the option isn't there yet). Mutation-check: after GREEN, delete the `metadata:` line by hand, re-run, confirm RED, restore.

---

## Unit 0 — Spike: prove the deployed client persists `metadata` (GATE — no production code)

**This gates the entire plan.** `src/lib/photos/path.ts:71` warns deployed-client `.upload()` behaviour has surprised the team. If the option does not survive the round-trip, Shape B is dead and we STOP and re-plan (Shape A / per-table columns).

**Files:**
- Create (scratchpad, NOT committed): `<scratchpad>/spec352-probe.mjs`

- [ ] **Step 1: Write the probe.** Uses the anon key (approximates the browser client, the path most uploads take):

```js
// spec352-probe.mjs — run once, then delete. Reads env from ../prc-ops/.env.local
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(process.env.ENVFILE, "utf8").split("\n").filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const key = `spec352-probe/${crypto.randomUUID()}.txt`;
const up = await sb.storage.from("photos").upload(key, new Blob(["probe"]), {
  contentType: "text/plain", upsert: false, metadata: { captureMethod: "camera" },
});
console.log("upload:", up.error?.message ?? "ok", key);
```

> Note: anon RLS on the `photos` bucket may reject an unauthenticated upload. If so, run the probe from a tiny Node script using the **service-role** key (read `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`) to isolate the *metadata-persistence* question from the *auth* question — persistence is what U0 must answer. Record which client was used.

- [ ] **Step 2: Run it.**

```
cd /d/claude/projects/prc-ops/prc-ops-352capmethod
export PATH="/c/Program Files/nodejs:$PATH"
ENVFILE=../prc-ops/.env.local node <scratchpad>/spec352-probe.mjs
```

- [ ] **Step 3: Read back the metadata via SQL** (replace `<key>` with the printed key):

```
pnpm exec supabase db query --linked "select name, user_metadata from storage.objects where name = '<key>';"
```
**Expected (PASS):** one row, `user_metadata` = `{"captureMethod": "camera"}`.
**If `user_metadata` is null/empty → FAIL → STOP.** Report: option not persisted by this client/version; re-plan to Shape A.

- [ ] **Step 4: Clean up the probe object.**

```
pnpm exec supabase db query --linked "delete from storage.objects where name = '<key>';"
```
(or `sb.storage.from('photos').remove([key])`). Delete the scratchpad script.

- [ ] **Step 5: Record the result** in `docs/progress-tracker.md` (PASS + which client, or FAIL + STOP). No commit, no PR — U0 is an investigation gate.

---

## Unit 1 — SSOT + WP photos (`photos` bucket)

Covers the 2410-image bucket. The progress-photo bytes upload in the **queue runner** (`upload-queue-runner.tsx:57`), fed by the IDB queue, so the value rides `QueuedUploadBase`. Defect photos upload directly in `use-defect-photos.ts`.

**Files:**
- Create: `src/lib/photos/capture-method.ts` (the locked contract above)
- Create: `tests/unit/photos/capture-method.test.ts`
- Modify: `src/lib/photos/upload-queue.ts` — add `captureMethod: CaptureMethod` to `QueuedUploadBase`; normalize kind-less/legacy IDB items to `"picker"` on read (there's already a normalize-on-read seam for the pre-`kind` items — extend it)
- Modify: `src/components/features/photos/upload-queue-runner.tsx:57` — add `metadata: captureMethodMetadata(item.captureMethod)` to the `uploadBytes` `.upload()` options
- Modify: the WP enqueue sites so each stamps its affordance:
  - capture-sheet camera shutter enqueue → `captureMethod: "camera"`
  - capture-sheet spec-96 "เลือกจากคลังภาพ" enqueue → `captureMethod: "library"`
  - (gate-check where enqueue happens — `use-phase-capture.ts` and/or the capture-sheet handler that builds the `QueuedUpload`)
- Modify: `src/app/projects/[projectId]/work-packages/[workPackageId]/use-defect-photos.ts:77` — add `metadata: captureMethodMetadata("picker")` to its `.upload()`
- Test: extend `tests/unit/.../upload-queue*.test.ts`, the capture-sheet test, and `use-defect-photos` test

**Interfaces produced (later units consume):**
- `captureMethodMetadata(method: CaptureMethod): { captureMethod: CaptureMethod }` — the ONLY way any unit builds the option.
- `QueuedUploadBase.captureMethod: CaptureMethod` — the runner reads it; enqueue sites set it.

- [ ] **Step 1: RED — SSOT unit test.**

```ts
import { CAPTURE_METHODS, captureMethodMetadata } from "@/lib/photos/capture-method";
it("exposes the three affordances", () => {
  expect(CAPTURE_METHODS).toEqual(["camera", "library", "picker"]);
});
it("builds the upload metadata option", () => {
  expect(captureMethodMetadata("camera")).toEqual({ captureMethod: "camera" });
});
```
Run: `pnpm test tests/unit/photos/capture-method.test.ts` → FAIL (module not found).

- [ ] **Step 2: GREEN — create the SSOT file** (locked contract). Re-run → PASS.

- [ ] **Step 3: RED — runner stamps the queued method.** In the queue-runner test, enqueue a `phase_photo` item with `captureMethod: "library"`, run the drain, assert the mocked `.upload()` got `expect.objectContaining({ metadata: { captureMethod: "library" } })`. Run → FAIL (`metadata: undefined`).

- [ ] **Step 4: GREEN — add the field + runner option.** Add `captureMethod` to `QueuedUploadBase`; default legacy IDB items to `"picker"` in the normalize-on-read seam; add `metadata: captureMethodMetadata(item.captureMethod)` at `upload-queue-runner.tsx:57`. Re-run → PASS.

- [ ] **Step 5: RED+GREEN — enqueue sites.** Test that the camera shutter enqueues `captureMethod:"camera"`, the library button `"library"`, defect `"picker"`; wire each. Mutation-check each direction.

- [ ] **Step 6: Verify.** `pnpm lint && pnpm typecheck && pnpm test`. Browser drive is optional here (no visible change); the real proof is U0 + the unit assertions. Optionally: capture one photo on dev-preview, then `select user_metadata from storage.objects where name like '<wp>/%' order by created_at desc limit 1;` → shows `{"captureMethod":"camera"}`.

- [ ] **Step 7: Ship.** Fresh-eyes review (`cavecrew-reviewer` on the diff), then:

```
cd /d/claude/projects/prc-ops/prc-ops-352capmethod
bash scripts/ship-pr.sh "feat: spec 352 U1 — capture-method SSOT + WP photos"
```
Code-only → danger-guard passes → auto-merges on green.

---

## Unit 2 — Purchasing / delivery (`pr-attachments`, `po-attachments`)

Sites 4–10 (spec §6). Some already flow through the same queue (`delivery_photo`, `reference_attachment` kinds) — those are **already covered by U1's `QueuedUploadBase` field**; only their **enqueue sites** need to set the value. Direct `.upload()` sites get the inline option.

**Files (gate-check each against HEAD — set the value from the input's ACTUAL attribute):**
- `src/components/features/purchasing/delivery-photo-uploader.tsx:101` → `"camera"` (has `capture="environment"`)
- `src/lib/store/upload-receipt-flag-photo.ts:40` → `"camera"` (receipt-flag-sheet has `capture="environment"`)
- `src/components/features/purchasing/proof-of-delivery-uploader.tsx:90` → per the `delivery-proof-block` `captureUploader` toggle: `"camera"` when true else `"picker"` (thread the toggle value; see spec §11 Q1 — decision: stamp the real per-call value)
- `src/components/features/purchasing/create-purchase-order-sheet.tsx:259` → verify attr → `"picker"` unless a `capture` is present
- `src/components/features/purchasing/invoice-uploader.tsx:94` → verify → `"picker"` (may be PDF too — still stamp; harmless)
- `src/components/features/purchasing/purchase-request-attachment-stager.tsx:172` → verify → likely `"picker"` (or `"camera"` if its input has capture)
- `src/components/features/purchasing/quote-doc-attach.tsx:80` → verify → `"picker"` (may be PDF-only; stamp anyway)
- Tests: each component's existing test extended with the shared assertion.

- [ ] **Step 1: Gate-check attributes.** `grep -n "capture=\\|accept=" ` each component; record the true affordance per site.
- [ ] **Step 2–N: per site, RED → GREEN → mutation-check** using the shared test pattern, with the gate-checked value.
- [ ] **Verify + Ship** as U1. Title: `feat: spec 352 U2 — capture-method on purchasing/delivery uploads`.

---

## Unit 3 — Expenses / rental (`expense-attachments`)

**Files:**
- `src/lib/expenses/upload-expense-receipt.ts:45` → verify attr → value
- `src/lib/equipment/upload-rental-receipt.ts:50` → verify attr → value
- Tests: the callers' tests (these are lib fns — assert the passed option; if no caller test exists, add a focused unit test that calls the fn with a stub client and asserts the `.upload` option).

- [ ] Gate-check each input's attribute → RED → GREEN → mutation-check → Verify → Ship. Title: `feat: spec 352 U3 — capture-method on expense/rental receipts`.

---

## Unit 4 — Catalog / feedback (`catalog-images`, `feedback-attachments`)

All three are plain `accept` → `"picker"` (✓ confirmed).

**Files:**
- `src/components/features/catalog/catalog-image-control.tsx:45` → `"picker"`
- `src/components/features/feedback/feedback-form.tsx:38` → `"picker"`
- `src/components/features/sa/report-issue-fab.tsx:88` → `"picker"`
- Tests: each component's test.

- [ ] RED → GREEN → mutation-check per site → Verify → Ship. Title: `feat: spec 352 U4 — capture-method on catalog/feedback uploads`.

---

## Unit 5 — Contacts / portal / profile / register

Sites 16–22. Gate-check each attribute; most are `"picker"`.

**Files (verify attr each):**
- `src/components/features/sa/add-technician-sheet.tsx:167` → `"picker"` (✓)
- `src/components/features/contacts/contact-documents-block.tsx:122` → verify
- `src/components/features/portal/portal-documents.tsx:98` → verify
- `src/components/features/portal/worker-id-card-update.tsx:76` → verify
- `src/components/features/profile/profile-bank-section.tsx:101` → verify
- `src/components/features/register/staff-registration-form.tsx:451` → verify
- `src/components/features/payroll/payout-nominee-form.tsx:99` → verify
- Tests: each component's test.

- [ ] RED → GREEN → mutation-check per site → Verify → Ship. Title: `feat: spec 352 U5 — capture-method on contacts/portal/profile/register uploads`.

---

## Unit 6 — The report (the deliverable)

**Files:**
- Run the read query (below) and report to the operator. (Spec §11 Q2 decision: ad-hoc SQL first; promote to a `/settings/integrity` tile only if the operator wants it standing — if so, that tile is a follow-up unit and MUST label `picker` as affordance-not-sensor.)

```sql
select bucket_id,
       coalesce(user_metadata->>'captureMethod','unknown') as method,
       count(*)
from storage.objects
where (metadata->>'mimetype') like 'image/%'
group by 1, 2
order by 1, 3 desc;
```

- [ ] Run it once ~a week after U1–U5 are live (needs new uploads to accumulate — existing objects read `unknown`). Report split per bucket, stating the §9 caveat: `picker` counts the ambiguous attach path, not "gallery"; camera-vs-gallery is only real on `camera`/`library` rows.

---

## Self-review (2026-07-24)

**Spec coverage:** §2 approach → SSOT + stamp (U1). §4 vocabulary → SSOT (U1). §6 all 22 sites → U1 (3) + U2 (7) + U3 (2) + U4 (3) + U5 (7) = 22 ✓. §5 read query → U6. §7 spike → U0. §8 non-goals honored (no migration/backfill/EXIF anywhere). §9 caveat → U6 report + any tile. §11 forks → decided inline (U2 PoD = real per-call value; U6 = ad-hoc SQL first).

**Placeholder scan:** the `verify` markers in U2/U3/U5 are deliberate build-time gate-checks (the affordance must be read from the live input attribute, not assumed) — each step says exactly what to grep and how to set the value. Not TODOs.

**Type consistency:** `captureMethodMetadata` / `CaptureMethod` / `QueuedUploadBase.captureMethod` named identically in the SSOT (U1) and every consumer (U2–U5). The upload option shape `{ metadata: { captureMethod } }` is identical in the runner, every direct site, and the U0 probe.

**Ordering:** U0 gates all. U1 creates the SSOT + the queue field; U2–U5 consume it and are mutually independent (different feature dirs) — after U1 merges they may run as parallel code-only lanes, but each still imports the SSOT (read-only) so no write-contention. U6 last.
