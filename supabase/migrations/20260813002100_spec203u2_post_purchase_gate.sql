-- Spec 203 U2 / ADR 0057 — widen post_purchase_to_gl's status gate so a committed
-- purchase still posts after it has progressed past 'purchased', and remediate the
-- 9 backlog jobs the drain outage stranded.
--
-- THE BUG (surfaced 2026-06-25 by the drain-schedule dig): the `purchase` job is
-- enqueued ONLY at the 'purchased'/'site_purchased' transition (the WP-bound enqueue
-- trigger, 20260813000500), and the poster ALSO gated on exactly those two statuses.
-- That pairing only holds if the drain runs PROMPTLY — while the PR is still
-- 'purchased'. During the 2-day drain outage, 9 WP-bound PRs advanced
-- 'purchased' -> 'delivered' before any drain ran, so the poster now refuses them
-- ('not a postable purchase, status delivered') and ~฿102k of real WP-bound AP never
-- reached the ledger.
--
-- THE FIX: a purchase that was committed (enqueued at 'purchased') is still postable
-- once it has merely PROGRESSED — 'on_route' / 'delivered' are the same committed AP,
-- not a new one. Widen the gate to the committed-and-not-voided set
-- ('purchased','site_purchased','on_route','delivered'); keep refusing the pre-purchase
-- ('requested','approved') and voided ('rejected','cancelled') states.
--
-- WHY THIS DOESN'T DOUBLE-BOOK (verified):
--   * Exactly ONE purchase job exists per PR — the enqueue trigger fires only on the
--     transition INTO 'purchased'/'site_purchased' (WP-bound); 'on_route'/'delivered'
--     do NOT enqueue. So the widened gate posts that single job, never a second.
--   * WP-less (store-bound) purchases still hit the `return null` suppression BEFORE
--     the posting block — their cost is Inventory via the receipt poster (spec 195 P3),
--     unchanged.
--   * The reverse-and-repost lookup still dedups if a re-post ever recurs.
--   * The divert mechanism (spec 198 U2, 20260813001000) reverses the WP entry DIRECTLY
--     and skips pending jobs — it no longer relies on the poster refusing 'delivered'
--     (that was the superseded 000900 approach).
--
-- RE-SOURCE: the body is the LIVE definition from 20260813001000 (the latest), verbatim,
-- with ONLY the gate line widened. SECURITY DEFINER + grants preserved across replace.

create or replace function public.post_purchase_to_gl(p_source_id uuid)
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
  -- Spec 203 U2: a committed purchase stays postable after it progresses. The gate
  -- admits the committed-and-not-voided statuses; only one purchase job is ever
  -- enqueued (at the 'purchased' transition), so this never double-books.
  if v_amount is null
     or v_status not in ('purchased', 'site_purchased', 'on_route', 'delivered') then
    raise exception 'post_purchase_to_gl: not a postable purchase (status %, amount %)', v_status, v_amount
      using errcode = 'P0001';
  end if;

  -- Spec 195 P3 / ADR 0063: a store-bound (WP-less) purchase is NOT expensed to
  -- WIP. Its cost is booked as Inventory (Dr 1500 / Cr AP) when the material is
  -- received into the store (the stock_receipt poster). Skip the purchase posting.
  if v_wp is null then
    return null;
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

-- ----------------------------------------------------------------------------
-- Remediate the backlog: reset the purchase jobs the old gate marked 'failed'
-- (the 9 'delivered' WP-bound PRs from the outage) back to 'pending', so the
-- gl-posting-drain cron posts them with the widened gate. Scoped to failed
-- purchase jobs; clears the stale error. Idempotent (only 'failed' rows match).
-- ----------------------------------------------------------------------------
update public.gl_posting_outbox
   set status = 'pending', last_error = null
 where status = 'failed'
   and source_table = 'purchase_requests'
   and source_event = 'purchase';
