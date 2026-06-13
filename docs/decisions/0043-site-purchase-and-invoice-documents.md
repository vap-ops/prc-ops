# ADR 0043 — On-site purchases & invoice/receipt documents

- Status: Accepted (2026-06-13)
- Context: spec 66. Field staff reported two gaps: invoices/receipts (which
  arrive with a delivery) have no obviously-named home, and ad-hoc **on-site
  cash purchases** that never went through request→approve cannot be recorded
  at all — so the receipt and the spend have nowhere to live.

## Decisions

1. **Invoice/receipt = a new attachment purpose `'invoice'`** on
   `purchase_request_attachments` (kind = image, v1). Label ใบส่งของ/ใบเสร็จ.
   Distinct from `'reference'` (pre-decision) and `'delivery_confirmation'`
   (the proof photo that auto-completes delivery). Safe: the delivery
   auto-complete trigger (`20260614110000`) keys strictly on
   `purpose='delivery_confirmation'`, so an invoice attach never advances
   status. Invoices attach when the parent is `purchased | on_route |
delivered | site_purchased` — i.e. once goods/docs exist. **PDF is a
   recorded seam** (the bucket is image-only); field reality is paper
   photographed.

2. **On-site purchase = a `purchase_request` with `source='site_purchase'`**,
   created by a SECURITY DEFINER RPC `record_site_purchase`. Reuse the
   existing table/attachments/RLS/card/detail machinery rather than fork a
   parallel `site_purchases` table (WP-centric "model as children of the WP,
   not parallel structures"). The `source` TEXT column already exists; the
   `pr_source_valid` CHECK is amended `('app','appsheet') → (+'site_purchase')`.

3. **Dedicated status `'site_purchased'`, NOT reuse of `'delivered'`.**
   Goods are physically on site, so reusing `delivered` is tempting and
   functionally survivable, but it would (a) leak site purchases into the
   `appsheet_writer` select/update worklist (ADR 0034 keeps AppSheet to the
   procurement segment), (b) render the delivery-confirmation uploader on rows
   that should only take an invoice, and (c) conflate delivery reports/audit
   (a `delivered` row with no `purchase_request_delivery` audit chain is an
   anomaly). Each of those is fixed only by **uncompiled** predicate / `source`
   branch edits. A new enum value's blast radius is instead **typecheck-
   enforced** — the exhaustive `switch`/`Record` + `_exhaustive: never` in
   `status-colors.ts` and `labels.ts` fail the build at every site that must
   change — plus one pgTAP `enum_has_labels` pin. Lower net risk. (Red-team,
   spec 66.)

4. **Governance = record + PM acknowledge** (operator decision). The purchase
   is already paid; logging never blocks. A PM acknowledges after the fact via
   `acknowledge_site_purchase` (pm/super), which sets new nullable columns
   `acknowledged_at` / `acknowledged_by`. The card badge derives from
   `source='site_purchase' AND acknowledged_at` (amber รอรับทราบ → รับทราบแล้ว)
   — **not** a status transition, so the status enum stays clean and the
   decision columns (`approved_by`/`decided_at`) keep their requisition
   meaning. The ack columns are RPC-written only; **not** in any authenticated
   grant.

5. **Scope = item + receipt** (operator decision): item description, qty/unit,
   and the receipt image. Baht amount/supplier are **deferred** (the `amount`
   column exists, RPC-writable later) so a busy on-site moment stays low-
   friction. The receipt has the amount on it anyway.

6. **WP visibility in `record_site_purchase`.** SECURITY DEFINER bypasses RLS,
   so the RPC re-implements the guards the INSERT policy gives for free: the
   role gate (`site_admin/pm/super`, else 42501) and **WP existence** (the FK
   plus an explicit `exists` probe for a clean error). It does **not** add a
   per-project scope check — v1 access is **role-level** (ADR 0013, "no
   membership in v1"): these roles read _all_ work packages, so there is no
   per-WP visibility to escalate past; the existing PR INSERT policy itself
   does no per-project check. Revisit if a per-project access model lands.

7. **No notification on creation** (recorded). A direct INSERT at
   `site_purchased` fires neither `notify_pr_created` (keyed `status='requested'`)
   nor the UPDATE-path status-change capture — so the PM is **not** LINE-pinged.
   The ack is a pull (badge/count). Push-on-create is a seam (notifications
   aren't activated yet, §8). The audit row is **one** `audit_log` row reusing
   the existing `action='insert'` value with `payload.source='site_purchase'`
   — no new `audit_action` enum value (avoids the grep-all-pins hazard).

## Consequences

- `purchase_request_status` gains `site_purchased`; `…attachment_purpose` gains
  `invoice`; `purchase_requests` gains `acknowledged_at`/`acknowledged_by`;
  `pr_source_valid` widened. Two RPCs. The attachments INSERT + storage upload
  policies gain an invoice arm (DROP+CREATE in place, preserving the
  `pr_attachment_tombstone_target_ok` recursion cure and `objects.name`
  qualification). pgTAP enum pins (status, purpose) updated same-unit.
- A site purchase is visible to PM/super (and its own requester) exactly like a
  requisition, distinguished by `source` + the `site_purchased` status, and
  excluded from the AppSheet worklist for free.
