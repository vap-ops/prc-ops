-- Spec 182 U4 — link a quotation document to a purchase_quotes row.
--
-- Each supplier quote (U1) can now carry its source document (the 📎). The doc
-- is an ordinary pr-attachments row (append-only, ADR 0015/0028) stamped
-- purpose='quote' + a quote_id FK to the quote it belongs to. Money posture
-- (the unit_price posture, ADR 0038): a quotation shows prices, so quote rows
-- are BACK-OFFICE-READ ONLY (a RESTRICTIVE select), matching purchase_quotes.
--
-- The 'quote' enum value was added in 20260809001400 (own migration); this names
-- it in the CHECK + the INSERT policy arm (separate transaction → safe).

-- ----------------------------------------------------------------------------
-- 1. The link column. ON DELETE CASCADE matches the sibling purchase_request_id
--    FK on this table — both are exercised only under the admin project
--    hard-delete (break-glass, append-only triggers disabled); in normal ops a
--    doc'd quote is kept (its remove is blocked by the append-only trigger, and
--    the UI disables removing a doc'd quote → kept for audit).
-- ----------------------------------------------------------------------------
alter table public.purchase_request_attachments
  add column quote_id uuid references public.purchase_quotes(id) on delete cascade,
  -- quote_id only on quote-purpose rows (a tombstone of one carries none).
  add constraint pra_quote_id_shape check (quote_id is null or purpose = 'quote');

create index purchase_request_attachments_quote_idx
  on public.purchase_request_attachments (quote_id)
  where quote_id is not null;

-- Column-scoped INSERT grant (the create migration revoked the table-level
-- insert + re-granted an explicit column list; a new column is not covered —
-- the spec-179 lesson). SELECT stays table-level (granted in the create
-- migration), so reads of the new column need no grant.
grant insert (quote_id) on public.purchase_request_attachments to authenticated;

-- ----------------------------------------------------------------------------
-- 2. INSERT policy: add the 'quote' arm. DROP + CREATE in place (the policy NAME
--    is unchanged → the policies_are / name pins stay green). Reconstructed from
--    the LIVE policy (20260752000000) — the reference/delivery/invoice arms are
--    verbatim; only the quote arm is new. Quote docs are back-office only
--    (site_admin excluded inside the arm), attach while the PR is APPROVED (the
--    sourcing window), and the quote_id must be a quote on THIS PR.
-- ----------------------------------------------------------------------------
drop policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments;

-- All current_user_role()/auth.uid() calls are wrapped in a scalar subselect
-- (eval-once; pgTAP file 40). The quote arm's purchase_quotes refs are
-- table-qualified: purchase_quotes also has a purchase_request_id column, so an
-- unqualified outer reference would be NAME-CAPTURED to q.purchase_request_id
-- (= itself, always true) and let a quote from another PR be linked here.
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
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_attachments.purchase_request_id
                      and pr.requested_by = (select auth.uid())
                      and pr.status = 'requested')
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

-- ----------------------------------------------------------------------------
-- 3. RESTRICTIVE read gate: quote-purpose rows (the price-bearing doc) are
--    visible to back office only — AND-ed with the permissive "select via
--    parent" so non-quote rows are unaffected and quote rows need both
--    parent-visibility and the back-office role.
-- ----------------------------------------------------------------------------
create policy "quote attachments readable by back office only"
  on public.purchase_request_attachments
  as restrictive
  for select
  to authenticated
  using (
    purpose <> 'quote'
    or (select public.current_user_role()) in
       ('project_manager', 'procurement', 'super_admin', 'project_director')
  );

-- ----------------------------------------------------------------------------
-- 4. Storage upload policy: a quote doc uploads while the PR is APPROVED, by
--    back office. DROP + CREATE from the LIVE policy (20260624000100) — adds
--    project_director to the role list and 'approved' to the status arm. The
--    table policy above stays the real per-purpose gate (storage cannot see
--    purpose); a stray byte upload without a matching row is an accepted orphan
--    (the table is the source of truth). objects.name stays qualified
--    (name-capture hazard vs work_packages.name).
-- ----------------------------------------------------------------------------
drop policy "pr attachment uploads by request owner or receiver"
  on storage.objects;

create policy "pr attachment uploads by request owner or receiver"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in
      ('site_admin', 'project_manager', 'procurement', 'super_admin', 'project_director')
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      join public.work_packages wp on wp.id = pr.work_package_id
      where pr.id::text = (storage.foldername(objects.name))[2]
        and wp.project_id::text = (storage.foldername(objects.name))[1]
        and (
          (pr.requested_by = auth.uid() and pr.status = 'requested')
          or pr.status in ('approved', 'purchased', 'on_route', 'delivered', 'site_purchased')
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Current-state view: expose quote_id (append-only at the end → CREATE OR
--    REPLACE keeps the grants + the security_invoker option). Same anti-join.
-- ----------------------------------------------------------------------------
create or replace view public.purchase_request_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_request_id, a.kind, a.purpose, a.storage_path, a.url,
         a.created_by, a.created_at, a.quote_id
  from public.purchase_request_attachments a
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_request_attachments t
                    where t.superseded_by = a.id);

comment on column public.purchase_request_attachments.quote_id is
  'Spec 182 U4 — FK to the purchase_quotes row this quotation document belongs to (purpose=''quote''). NULL for every other attachment purpose.';
