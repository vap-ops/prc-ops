# Spec 23 — Delivery-confirmation photos (รูปยืนยันการรับของ)

**Origin:** operator chat 2026-06-11 — "stepper works but user cannot
attach images to confirm received."

## Relationship to spec 16 P2 (read this first)

Spec 16 §4 locked the `purchase_request_attachments` architecture for
REFERENCE attachments (requester, while `requested`). This spec ships
that locked table/bucket/token infrastructure **verbatim where possible**
and extends it with a second attachment purpose:

- New discriminator column `purpose purchase_request_attachment_purpose
not null default 'reference'` — enum `('reference',
'delivery_confirmation')`.
- The locked INSERT policy gains a SECOND branch for
  delivery-confirmation rows.
- **UI in this spec = delivery-confirmation photos ONLY.** The
  reference-image stager (spec 16 P2 UI) stays queued; the DB it needs
  ships now. The spec-16 P2 UI unit shrinks to pure app code.
- ADR numbering: ADR 0027 was taken by on_route; the AppSheet image
  bridge ADR (spec 16 P3) becomes **ADR 0029**. This spec's decision
  record is **ADR 0028**.

## Decision deltas vs the locked spec-16 design (recorded in ADR 0028)

1. **Post-decision attaching is now allowed for ONE purpose.** Spec 16
   Q2 froze the attachment set once the parent left `requested`; the
   operator's receipt-photo ask reverses that for
   `purpose = 'delivery_confirmation'` only:
   - kind `image` only (a "confirmation link" is meaningless);
   - parent `status = 'delivered'` (receipt is confirmed against a
     recorded delivery, keeping AppSheet the delivery authority);
   - `created_by = auth.uid()` with requester-capable role — ANY site
     staff member may confirm receipt, not just the original requester
     (the receiver is often a different person).
2. **Tombstone removal extends to confirmation photos** for their own
   creator while the parent is `delivered` (mistake-fix path; same
   tombstone shape, composite FK already enforces same-parent/same-kind).
3. **Storage upload policy** gains the matching second branch
   (delivered-parent, any requester-capable role).
4. CHECK `pra_link_purpose`: a `delivery_confirmation` row must have
   `kind = 'image'` (tombstones inherit kind via composite FK).

Everything else — table shape, triple-enforced append-only, tombstone
well-formedness, token side table + trigger, `_current`/`_appsheet`
views, revoke-all-first grants, name-capture-qualified policy text,
private bucket — is the locked spec-16 §4 design unchanged (the views
and AppSheet policy gain the `purpose` column passthrough).

## Migrations

1. `20260614100000_create_purchase_request_attachments.sql` — enums
   (kind, purpose) + table + CHECKs + composite FK + indexes + token
   side table + token trigger + RLS enable + revoke-all-first +
   authenticated grants + the two authenticated policies (INSERT policy
   carries both branches) + block-write triggers + `_current` view.
2. `20260614100100_grant_appsheet_writer_attachments_select.sql` —
   appsheet_writer SELECT grants + explicit policies + `_appsheet` view.
3. `20260614100200_create_pr_attachments_bucket.sql` — private
   `pr-attachments` bucket + the path-bound INSERT storage policy (both
   branches).

## UI (this spec)

- New pure modules `src/lib/purchasing/attachment-path.ts`
  (`buildPrAttachmentStoragePath`) and
  `src/lib/purchasing/validate-attachment.ts` (spec 16 §4 contracts;
  failing tests first).
- New server action `addDeliveryConfirmationPhoto({purchaseRequestId,
attachmentId, ext})` in `src/app/requests/actions.ts` — server
  rebuilds the canonical path, inserts
  `{kind:'image', purpose:'delivery_confirmation'}` under caller RLS.
- New client component
  `src/components/features/delivery-photo-uploader.tsx` ('use client'
  justified: file input + per-tile upload state machine, phase-uploader
  precedent): shown on `/requests` cards with `status='delivered'`,
  button ยืนยันการรับของด้วยรูป; uploads direct to `pr-attachments`
  (pre-assigned uuid path), then calls the action.
- Display: delivered cards query
  `purchase_request_attachments_current` filtered
  `purpose='delivery_confirmation'`, render heading รูปยืนยันการรับของ
  with signed-URL thumbnails (new `server-only`
  `src/lib/purchasing/attachment-signed-urls.ts`, photos-helper clone).
- Removal: creator-only ลบ on own photos while parent stays delivered
  (tombstone via `removePurchaseRequestAttachment`).

## Thai strings

| Surface                 | String                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| Upload button / section | ยืนยันการรับของด้วยรูป                                                |
| Display heading         | รูปยืนยันการรับของ                                                    |
| Progress / errors       | phase-uploader copy verbatim; บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง |
| Remove + confirm        | ลบ / ลบรายการแนบนี้หรือไม่?                                           |

## Out of scope

Reference-attachment UI (spec 16 P2 unit), AppSheet image bridge (P3 /
ADR 0029), PDFs, token-rotation action.

## Verification checklist

- [ ] pgTAP file 20 (attachments) + 21 (bucket) green post-push; spec-16
      §7 test contracts honored for the shipped surface.
- [ ] Unit tests RED→GREEN for the two pure modules.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
- [ ] Manual: photo attach on a delivered request from a phone; thumbnail
      renders; removal tombstones.
- [ ] Tier-2 smoke re-run (role-touching migration 2).
