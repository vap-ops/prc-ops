-- Spec 149 U4b / ADR 0057 — the first subledger poster: a purchase → its AP
-- journal. Reverse-and-repost (operator decision 2026-06-19, auto-correct): if a
-- current entry already exists for this purchase, reverse it first, then post the
-- corrected one — so an amount/VAT correction flows through.
--
-- Posting (ADR 0057 map; net/VAT mirror src/lib/purchasing/vat.ts deriveVatBreakdown):
--   Dr WIP-construction (1400)  net   [project + work_package dims]
--   Dr Input VAT       (1300)  vat   [if vat_rate > 0]
--   Cr AP - trade      (2100)  gross [supplier party]
-- amount is canonically GROSS (ADR 0045); net = round(gross/(1+rate/100)),
-- vat = gross - net, so net + vat = gross exactly (balanced).
--
-- SECURITY DEFINER, owner-context — reads the zero-grant amount/vat without a
-- human role. Called by the U4c drainer (service_role) and by pgTAP directly.
-- WIP-materials account is the construction-standard skeleton's 1400 (accountant
-- refines to a materials-specific WIP later).

create function public.post_purchase_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount    numeric(14,2);
  v_vat_rate  numeric;
  v_wp        uuid;
  v_project   uuid;
  v_supplier  uuid;
  v_actor     uuid;
  v_purchased date;
  v_status    text;
  v_net       numeric(14,2);
  v_vat       numeric(14,2);
  v_old       uuid;
  v_lines     jsonb;
begin
  select amount, vat_rate, work_package_id, supplier_id,
         coalesce(requested_by, received_by_id), coalesce(purchased_at::date, current_date),
         status::text
    into v_amount, v_vat_rate, v_wp, v_supplier, v_actor, v_purchased, v_status
    from public.purchase_requests where id = p_source_id;
  if not found then
    raise exception 'post_purchase_to_gl: purchase not found' using errcode = 'P0001';
  end if;
  if v_amount is null or v_status not in ('purchased', 'site_purchased') then
    raise exception 'post_purchase_to_gl: not a postable purchase (status %, amount %)', v_status, v_amount
      using errcode = 'P0001';
  end if;

  select project_id into v_project from public.work_packages where id = v_wp;

  if coalesce(v_vat_rate, 0) <= 0 then
    v_net := v_amount;
    v_vat := 0;
  else
    v_net := round(v_amount / (1 + v_vat_rate / 100), 2);
    v_vat := round(v_amount - v_net, 2);
  end if;

  -- Reverse-and-repost: reverse the current (non-reversed) purchase entry, if any.
  select e.id into v_old
    from public.journal_entries e
   where e.source_table = 'purchase_requests'
     and e.source_id    = p_source_id
     and e.source_event = 'purchase'
     and e.status       = 'posted'
     and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
   limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_actor, 'auto-correct: purchase re-posted');
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1400', 'debit', v_net,
                       'project_id', v_project, 'work_package_id', v_wp));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_object('account_code', '1300', 'debit', v_vat,
                       'project_id', v_project, 'work_package_id', v_wp);
  end if;
  v_lines := v_lines || jsonb_build_object('account_code', '2100', 'credit', v_amount,
                       'supplier_id', v_supplier);

  return public.post_journal_internal(
    v_purchased, 'purchase_requests', p_source_id, 'purchase',
    'AP purchase', v_lines, null, v_actor);
end;
$$;
revoke all on function public.post_purchase_to_gl(uuid) from public, anon, authenticated;
grant execute on function public.post_purchase_to_gl(uuid) to service_role;
