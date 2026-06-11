-- Spec 23 / ADR 0028 (spec 16 §4 locked design) — appsheet_writer read
-- access to attachments + tokens, and the _appsheet view that feeds the
-- future image bridge (ADR 0029). Separate role-touching migration
-- (140100 precedent) — re-run the Tier-2 smoke ritual after this lands.
--
-- NEVER rule honored: no current_user_role()/auth.uid() in these
-- policies — both are NULL for a raw DB role.

grant select on public.purchase_request_attachments to appsheet_writer;
grant select on public.purchase_request_attachment_tokens to appsheet_writer;

-- Status list written explicitly (defense in depth against the parent
-- policy's future source='appsheet' seam); on_route included per ADR 0027.
create policy "appsheet_writer select via parent status"
  on public.purchase_request_attachments
  for select
  to appsheet_writer
  using (exists (select 1 from public.purchase_requests pr
                 where pr.id = purchase_request_id
                   and pr.status in ('approved', 'purchased', 'on_route', 'delivered')));

-- Token visibility inherits the attachments gate (subquery runs under
-- appsheet's attachments RLS). Outer reference qualified — name-capture.
create policy "appsheet_writer select tokens via attachment"
  on public.purchase_request_attachment_tokens
  for select
  to appsheet_writer
  using (exists (select 1 from public.purchase_request_attachments a
                 where a.id = purchase_request_attachment_tokens.attachment_id));

create view public.purchase_request_attachments_appsheet
  with (security_invoker = true) as
  select a.id, a.purchase_request_id, a.kind, a.purpose, a.storage_path, a.url,
         a.created_at, tok.access_token
  from public.purchase_request_attachments a
  left join public.purchase_request_attachment_tokens tok
    on tok.attachment_id = a.id
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_request_attachments t
                    where t.superseded_by = a.id);

revoke all on public.purchase_request_attachments_appsheet from anon, authenticated;
grant select on public.purchase_request_attachments_appsheet to appsheet_writer;
