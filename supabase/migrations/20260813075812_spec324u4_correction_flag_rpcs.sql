-- Spec 324 U4 — the SA flag lifecycle RPCs + notification capture.
--
-- submit_receipt_correction_request — a project member (the SA who received)
--   flags a suspected miscount. Floors: proposed_qty in [0, booked), non-empty
--   reason + photo. One PENDING flag per receipt is enforced by the U1 partial-
--   unique index (23505), NOT a TOCTOU app check. A prior REJECTED flag closes
--   the receipt to further flags (no unbounded disagreement loop).
--
-- decide_receipt_correction_request — back-office approves or rejects. Locks the
--   request row + re-asserts pending (mirror decide_identity_change), so a
--   double-apply of one flag is safe. Approve delegates to correct_stock_receipt
--   (which trues on-hand + sets the flag 'applied' + links the correction);
--   reject sets 'rejected' with a required note.
--
-- Notification capture (ADR 0037 posture — DEFINER, pinned search_path, failures
-- SWALLOWED so a notification never blocks the write): an AFTER INSERT enqueues
-- 'receipt_correction_flagged' (→ back-office pool, routed in U1's
-- resolve-recipients); an AFTER UPDATE on pending→applied/rejected enqueues
-- 'receipt_correction_resolved' (→ the flag's requester). A reverse-driven
-- pending→obsolete is deliberately NOT a resolution (excluded by the WHEN).

-- ---------------------------------------------------------------------------
create function public.submit_receipt_correction_request(
  p_receipt_id   uuid,
  p_proposed_qty numeric,
  p_reason       text,
  p_photo_path   text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_photo   text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_project uuid;
  v_qty     numeric;
  v_id      uuid;
begin
  select project_id, qty into v_project, v_qty
    from public.stock_receipts where id = p_receipt_id;
  if v_project is null then
    raise exception 'submit_receipt_correction_request: unknown receipt' using errcode = '22023';
  end if;

  -- Gate: a member who can see the receipt's project (null-safe — can_see_project
  -- is false for an unbound / non-member caller).
  if not public.can_see_project(v_project) then
    raise exception 'submit_receipt_correction_request: not a project member' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'submit_receipt_correction_request: reason required' using errcode = 'P0001';
  end if;
  if v_photo is null then
    raise exception 'submit_receipt_correction_request: photo required' using errcode = 'P0001';
  end if;
  if p_proposed_qty is null or p_proposed_qty < 0 or p_proposed_qty >= v_qty then
    raise exception 'submit_receipt_correction_request: proposed_qty must be in [0, %)', v_qty using errcode = 'P0001';
  end if;
  -- Reject closes the receipt to further flags.
  if exists (select 1 from public.receipt_correction_requests
             where receipt_id = p_receipt_id and status = 'rejected') then
    raise exception 'submit_receipt_correction_request: ปิดรับการรายงานสำหรับใบรับนี้แล้ว' using errcode = 'P0001';
  end if;

  -- One PENDING per receipt = the partial-unique index (raises 23505 on race).
  insert into public.receipt_correction_requests
    (receipt_id, proposed_qty, reason, photo_path, requested_by)
  values (p_receipt_id, p_proposed_qty, v_reason, v_photo, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_receipt_correction_request(uuid, numeric, text, text) from public, anon;
grant execute on function public.submit_receipt_correction_request(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
create function public.decide_receipt_correction_request(
  p_request_id uuid,
  p_approve    boolean,
  p_true_qty   numeric default null,
  p_note       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.user_role := public.current_user_role();
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_req        public.receipt_correction_requests%rowtype;
  v_project    uuid;
  v_correction uuid;
begin
  if v_role is null or not public.is_back_office(v_role) then
    raise exception 'decide_receipt_correction_request: role not permitted' using errcode = '42501';
  end if;

  select * into v_req from public.receipt_correction_requests where id = p_request_id for update;
  if not found then
    raise exception 'decide_receipt_correction_request: request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'decide_receipt_correction_request: request already decided' using errcode = 'P0001';
  end if;

  -- Membership scope PARITY with the approve path (correct_stock_receipt gates the
  -- same way): a non-member project_manager must not reject — and thereby
  -- reject-CLOSE — a flag on a project it has no authority over. Applies to BOTH
  -- branches (harmless-redundant on approve, where correct_stock_receipt re-checks).
  select project_id into v_project from public.stock_receipts where id = v_req.receipt_id;
  if not (public.can_see_project(v_project) or v_role in ('procurement', 'procurement_manager')) then
    raise exception 'decide_receipt_correction_request: not a project member' using errcode = '42501';
  end if;

  if p_approve then
    if p_true_qty is null then
      raise exception 'decide_receipt_correction_request: true_qty required to approve' using errcode = 'P0001';
    end if;
    -- correct_stock_receipt applies its own back-office + fresh-pool gates, sets
    -- the flag to 'applied', and links the correction id.
    v_correction := public.correct_stock_receipt(
      v_req.receipt_id, p_true_qty, coalesce(v_note, v_req.reason), p_request_id);
    return v_correction;
  else
    if v_note is null then
      raise exception 'decide_receipt_correction_request: a note is required to reject' using errcode = 'P0001';
    end if;
    update public.receipt_correction_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = p_request_id;
    return p_request_id;
  end if;
end;
$$;
revoke all on function public.decide_receipt_correction_request(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.decide_receipt_correction_request(uuid, boolean, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Notification capture (ADR 0037): DEFINER, pinned search_path, failures
-- swallowed (a notification must NEVER block the flag write). item_description
-- rides in the payload for the drain's Thai compose; requested_by for the
-- resolve-recipients routing (flagged excludes the flagger; resolved targets it).
-- ---------------------------------------------------------------------------
create function public.notify_receipt_correction_flagged()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_item    text;
begin
  select sr.project_id, ci.base_item into v_project, v_item
    from public.stock_receipts sr
    join public.catalog_items ci on ci.id = sr.catalog_item_id
   where sr.id = new.receipt_id;
  insert into public.notification_outbox (event_type, payload)
  values ('receipt_correction_flagged',
          jsonb_build_object('requested_by', new.requested_by,
                             'item_description', v_item,
                             'project_id', v_project));
  return new;
exception when others then
  raise warning '[notify_receipt_correction_flagged] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;
create trigger receipt_correction_requests_notify_flagged
  after insert on public.receipt_correction_requests
  for each row execute function public.notify_receipt_correction_flagged();

create function public.notify_receipt_correction_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_item    text;
begin
  select sr.project_id, ci.base_item into v_project, v_item
    from public.stock_receipts sr
    join public.catalog_items ci on ci.id = sr.catalog_item_id
   where sr.id = new.receipt_id;
  insert into public.notification_outbox (event_type, payload)
  values ('receipt_correction_resolved',
          jsonb_build_object('requested_by', new.requested_by,
                             'item_description', v_item,
                             'project_id', v_project));
  return new;
exception when others then
  raise warning '[notify_receipt_correction_resolved] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;
-- Only a real BO decision (applied/rejected) is a "resolution"; a reverse-driven
-- pending→obsolete is not (excluded here).
create trigger receipt_correction_requests_notify_resolved
  after update on public.receipt_correction_requests
  for each row
  when (old.status = 'pending' and new.status in ('applied', 'rejected'))
  execute function public.notify_receipt_correction_resolved();
