-- Spec 211 U11b — a self-purchase carries an ITEM image, not just the receipt.
--
-- บันทึกการซื้อหน้างาน records a purchase as a PR born status='site_purchased'
-- (record_site_purchase). The invoice/docs arm already admits an attachment at
-- that status, but the 'reference' (item photo) arm only admitted status
-- 'requested' (PR creation time) — so a self-purchase could attach the receipt
-- but NOT a photo of the item. Widen the reference arm to also admit a
-- site_purchased parent, matching the invoice arm's posture on the same PR.
--
-- ADDITIVE: the change only ADMITS more inserts (purpose='reference' on a
-- site_purchased parent); it removes nothing. The requested-creation branch
-- keeps its requester pin (requested_by = caller) verbatim, so the spec-16
-- owner-only-while-pending guarantee is untouched.
--
-- DROP + CREATE in place (the policy NAME is unchanged → the policies_are / name
-- pins stay green). Reconstructed VERBATIM from the LIVE policy (20260809001500
-- spec 182 U4) — the delivery/invoice/quote arms, the role list, the eval-once
-- scalar subselects, and the tombstone clause are byte-for-byte; ONLY the
-- reference arm gains the site_purchased branch. The storage upload policy
-- already admits site_purchased uploads (its receiver branch) and is left as-is;
-- storage cannot see purpose, so the table policy below stays the real gate.

drop policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments;

create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'procurement', 'super_admin', 'project_director')
    and created_by = (select auth.uid())
    and (
      (
        purpose = 'reference'
        and (
          -- creation-time reference: the requester, while the PR is pending.
          exists (select 1 from public.purchase_requests pr
                  where pr.id = purchase_request_attachments.purchase_request_id
                    and pr.requested_by = (select auth.uid())
                    and pr.status = 'requested')
          -- Spec 211 U11b: a self-purchase's item photo — same status the
          -- invoice arm admits; the site team attaches both images.
          or exists (select 1 from public.purchase_requests pr
                     where pr.id = purchase_request_attachments.purchase_request_id
                       and pr.status = 'site_purchased')
        )
      )
      or
      (
        purpose = 'delivery_confirmation'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_attachments.purchase_request_id
                      and pr.status in ('on_route', 'delivered'))
      )
      or
      (
        purpose = 'invoice'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_attachments.purchase_request_id
                      and pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased'))
      )
      or
      (
        -- Spec 182 U4: a quotation doc — back-office only (NOT site_admin),
        -- while the PR is approved, linked to a quote on this PR.
        purpose = 'quote'
        and (select public.current_user_role()) in
          ('project_manager', 'procurement', 'super_admin', 'project_director')
        and quote_id is not null
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_attachments.purchase_request_id
                      and pr.status = 'approved')
        and exists (select 1 from public.purchase_quotes q
                    where q.id = purchase_request_attachments.quote_id
                      and q.purchase_request_id = purchase_request_attachments.purchase_request_id)
      )
    )
    and (superseded_by is null
         or public.pr_attachment_tombstone_target_ok(
              superseded_by, purchase_request_id, (select auth.uid())))
  );
