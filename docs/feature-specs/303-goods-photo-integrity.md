# Spec 303 — Goods-photo integrity: real-time capture, coverage, amount trace

- Status: Approved (2026-07-12). Operator: "Make sure they take photo of that real
  time and as proof of receiving (make sure the image covers all items received,
  they can take more than one picture but we need to be able to trace back the
  amount delivered)." Design fork offered via AskUserQuestion (camera strictness ×
  photo-gap flag) went unanswered — recommended options adopted, both derived from
  the operator's own wording; trivially flippable.
- **Code-only, no schema.** Follows spec 302 in the same card region.

## Problem

1. **Nothing enforces real-time.** `DeliveryPhotoUploader` has `accept` + `multiple`
   but no `capture` — on the SA's phone the picker offers the gallery, so an old
   photo can "confirm" a delivery. The WP capture-sheet already uses
   `capture="environment"` (spec 63 idiom); the receive proof doesn't.
2. **Coverage is unstated.** No copy tells the SA the photos must show everything
   received.
3. **The amount↔photo link exists but is invisible.** The photo IS the accept
   (spec 24 / ADR 0030) and แบ่งรับบางส่วน splits create separate PR rows, so each
   receive event already owns its quantity and its photos + append-only
   `created_at`/`created_by`. No UI ever states the pairing, so an auditor can't
   see "these photos prove THIS amount" without reading the database.
4. **A photo-less `delivered` is silent.** The PO receive checklist
   (`receivePoLines`, back-office) flips lines to `delivered` with zero photos —
   no surface flags the missing proof.

## Change (single unit, code-only)

1. **Force the live camera on mobile:** `capture="environment"` on the
   `DeliveryPhotoUploader` file input. Repeat taps take more photos (`multiple`
   stays for browsers that honor both). Desktop file dialog cannot be locked and
   in-browser EXIF verification is unreliable — stated limitation, not silently
   claimed.
2. **Coverage copy** under the uploader button (labels SSOT):
   `DELIVERY_PHOTO_COVERAGE_HINT` = `ถ่ายให้เห็นของที่รับครบทุกรายการ — ถ่ายได้หลายรูป`.
3. **Amount-trace caption** on the photo group: the รูปยืนยันการรับของ label line
   gains the row's quantity — `รูปยืนยันการรับของ · จำนวนที่รับ X <unit>` — making the
   photos↔amount pairing explicit per PR row (split rows = per-event exactness;
   the receive date already sits in the status timeline).
4. **Photo-gap flag** (extends the #471 missing-flag pattern): `delivered` with
   zero confirmation photos → amber `DELIVERY_PHOTO_MISSING_LABEL` =
   `ยังไม่มีรูปยืนยันการรับของ` on the receive card, ALL roles (goods proof is the
   core evidence; the photo-less state is produced by the BO checklist path, and
   the SA holding the goods is the one who can cure it).
   `planRequestDocSections` gains `hasDeliveryPhotos` → `deliveryPhotoMissingFlag`.

## Out of scope / seams

- No server-side rejection of non-camera uploads (impossible to verify honestly
  in-browser); no EXIF checks.
- No per-photo quantity annotation and no receive-events table — split rows
  already carry the binding; revisit only if multi-event-per-row receiving ever
  lands.
- AI coverage check ("do the photos show N items?") — natural future agent job
  ([[ai-first-prove-value-doctrine]]), not v1.
- PO receive checklist itself unchanged (no photo requirement added to the BO
  path; the amber flag surfaces the gap instead).

## Verification

- TDD: capture attribute + hint rendered by `DeliveryPhotoUploader` (RTL);
  `deliveryPhotoMissingFlag` matrix; caption label; new label strings.
- Full suite + guards green; browser real-flow: delivered PR with photos shows
  caption with qty; photo-less delivered PR shows amber flag (both roles); input
  carries `capture="environment"`. Zero console errors.

## References

Spec 302 (+#470/#471 — the card this extends) · spec 24 / ADR 0030
(photo-completes-delivery) · spec 300 (photo-always operator decision) · spec 134
U3 (แบ่งรับบางส่วน split rows) · spec 37 (offline queue bracket — untouched).
