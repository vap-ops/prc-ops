-- Field bug 2026-07-28 — the material-catalog image upload 403'd for
-- procurement_manager (silent: the control shows only "อัปโหลดรูปไม่สำเร็จ").
--
-- Spec 175 U4 created the catalog-images INSERT policy with a HARDCODED role
-- array (pm/super/procurement/director). Spec 261 / ADR 0070 then made
-- procurement_manager a full superset of procurement and widened
-- public.is_back_office — which the /catalog page gate (BACK_OFFICE_ROLES), the
-- setCatalogItemImage action and the set_catalog_item_image RPC all follow. The
-- storage policy was the one layer left behind, so the button rendered and the
-- RPC would have accepted the write while Storage refused the bytes:
-- affordance-then-refuse. Every sibling bucket policy (equipment-images,
-- po-attachments, pr-attachments, rental-settlement-receipts, photos) already
-- carries procurement_manager; catalog-images was the last hardcoded holdout.
--
-- Fix = delegate to the same SSOT the other three layers use, so the set can
-- never drift again. ADDITIVE: same bucket, same command, same grantee — this
-- only widens the with-check by one role. is_back_office returns false (never
-- null) for an unbound caller, so the policy stays fail-closed; the
-- (select …) wrapper keeps current_user_role() an initplan rather than a
-- per-row call (drop+create rewrites the policy, so the wrapper is re-applied
-- deliberately here).

drop policy if exists "catalog-images uploads by back-office" on storage.objects;

create policy "catalog-images uploads by back-office"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'catalog-images'
    and public.is_back_office((select public.current_user_role()))
  );
