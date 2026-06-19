-- Spec 149 U4a / ADR 0057 decision 12 — enqueue path: one idempotent enqueue
-- function + a generic SECURITY DEFINER trigger function + four AFTER-triggers on
-- the subledgers. The triggers only INSERT a queue row — they cannot fail the
-- operational write, and (being SECURITY DEFINER, owner-context) they work for
-- EVERY writer (appsheet_writer, site_admin, pm, service-role) with no role gate.
-- No posting logic here (that is the U4b drainer).

-- ----------------------------------------------------------------------------
-- enqueue_gl_posting — idempotent on (source_table, source_id, source_event):
-- dedups only an IN-FLIGHT job (pending|posting) — a second enqueue while one is
-- queued returns the same id. A prior posted|failed|skipped job DOES re-queue, so
-- a real money change (the triggers only fire on one — see the WHEN clauses)
-- re-drains and the poster reverse-and-reposts (auto-correct, U4b). Double-posting
-- on incidental re-fires is prevented at the trigger (WHEN money-changed), not here.
create function public.enqueue_gl_posting(
  p_source_table text,
  p_source_id    uuid,
  p_source_event text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.gl_posting_outbox
   where source_table = p_source_table
     and source_id    = p_source_id
     and source_event = p_source_event
     and status in ('pending', 'posting')
   limit 1;
  if found then
    return v_id;
  end if;

  insert into public.gl_posting_outbox (source_table, source_id, source_event)
  values (p_source_table, p_source_id, p_source_event)
  returning id into v_id;
  return v_id;
end;
$$;
-- Internal: reachable only via the SECURITY DEFINER triggers below (and the U4b
-- drainer, which gets its own grant). No session role calls it directly.
revoke all on function public.enqueue_gl_posting(text, uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Generic trigger function: SECURITY DEFINER so the outbox insert runs as owner
-- regardless of the writer (a NULL-role appsheet write must not be blocked).
-- TG_ARGV[0] = source_event; TG_ARGV[1] = the id column name on NEW (extracted
-- via to_jsonb so one function serves every subledger).
create function public.enqueue_gl_posting_tg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_gl_posting(
    tg_table_name,
    (to_jsonb(new) ->> tg_argv[1])::uuid,
    tg_argv[0]);
  return new;
end;
$$;

-- Purchase: the money event is a purchased ticket with an amount (covers both the
-- PO/record path 'purchased' and the on-site path 'site_purchased'). On UPDATE,
-- only fire when the money (amount/status) actually changed — an incidental update
-- (e.g. a delivery field) must not re-enqueue. On INSERT, OLD is NULL so the
-- distinct-from clauses are true.
create trigger purchase_requests_enqueue_gl_posting
  after insert or update on public.purchase_requests
  for each row
  when (new.amount is not null and new.status in ('purchased', 'site_purchased')
        and (new.amount is distinct from old.amount or new.status is distinct from old.status))
  execute function public.enqueue_gl_posting_tg('purchase', 'id');

-- DC payment: append-only — every recorded payment posts. AFTER INSERT only.
create trigger dc_payments_enqueue_gl_posting
  after insert on public.dc_payments
  for each row
  execute function public.enqueue_gl_posting_tg('dc_payment', 'id');

-- Labor freeze: UPSERT (re-freeze) — enqueue only when a cost actually changed
-- (a re-freeze to the same numbers must not re-post). Keyed by the WP. On INSERT,
-- OLD is NULL so the distinct-from clauses are true.
create trigger wp_labor_costs_enqueue_gl_posting
  after insert or update on public.wp_labor_costs
  for each row
  when (new.own_cost is distinct from old.own_cost or new.dc_cost is distinct from old.dc_cost)
  execute function public.enqueue_gl_posting_tg('labor_freeze', 'work_package_id');

-- Equipment rental batch: the inbound monthly cost. AFTER INSERT only.
create trigger equipment_rental_batches_enqueue_gl_posting
  after insert on public.equipment_rental_batches
  for each row
  execute function public.enqueue_gl_posting_tg('rental_batch', 'id');
