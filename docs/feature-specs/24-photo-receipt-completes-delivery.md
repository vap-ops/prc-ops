# Spec 24 — Receipt photo on on_route completes the delivery

**Origin:** operator chat 2026-06-11 — "when status is on_route, users
on site can attach images, then we know delivery is complete."
Decision record: ADR 0030 (amends ADR 0028's delivered-only gate).

## Behavior

1. A request in กำลังจัดส่ง (`on_route`) shows the
   ยืนยันการรับของด้วยรูป uploader on `/requests` (today it appears only
   on delivered rows).
2. When the first delivery-confirmation photo lands on an `on_route`
   parent, the DATABASE completes the delivery: `delivered_at = now()`,
   `received_by =` the confirmer's `users.full_name` (uuid fallback),
   derive trigger advances `on_route → delivered`, audit trigger writes
   the `purchase_request_delivery` row (principal `authenticator` — the
   app path; ADR 0030 records this signature).
3. Adding more photos on an already-delivered parent stays legal
   (unchanged ADR 0028 behavior). `purchased` rows accept NO
   confirmation photos (operator's flow starts at on_route — open
   question recorded).
4. AppSheet's delivery write path is untouched; both paths converge.

## Changes

- Migration `20260614110000_photo_receipt_completes_delivery.sql`:
  - DROP + recreate the attachments INSERT policy with the confirmation
    branch widened to `pr.status in ('on_route', 'delivered')`.
  - DROP + recreate the storage upload policy with the same widening.
  - New `purchase_request_attachments_complete_delivery()`
    (SECURITY DEFINER, search_path pinned) + AFTER INSERT trigger:
    content + delivery_confirmation + parent on_route ⇒ parent UPDATE
    (delivered_at, received_by). No new audit shape — the existing
    derive/audit triggers do the rest.
- UI (`/requests`): uploader + photo section render for
  `on_route` AND `delivered`; footer copy gains the photo-confirmation
  sentence; uploader refresh shows the flipped status immediately.
- pgTAP test 20 gains a section: photo on on_route parent lives, parent
  becomes delivered with delivered_at/received_by set, delivery audit
  row written, photo on purchased parent still raises 42501.

## Thai strings

Unchanged labels; footer addition:
`เมื่อของถึงหน้างาน ถ่ายรูปยืนยันการรับของได้ทันทีที่สถานะ "กำลังจัดส่ง" — ระบบจะบันทึกเป็น "ได้รับของแล้ว" ให้อัตโนมัติ`

## Verification checklist

- [ ] pgTAP green post-push (plan count updated).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] Manual: on_route request → attach photo → card shows ได้รับของแล้ว
      with the stepper completed.
- [ ] Tier-2 smoke unaffected (no appsheet_writer grant change).
