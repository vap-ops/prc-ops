-- Spec 249 U1c — re-drain guard on the receipt poster (self-review finding,
-- pre-merge). 063500's poster could DOUBLE-POST a superseded row: if R1 was
-- superseded by R2 and R2's drain already reversed R1's entry, re-running R1's
-- job found no un-reversed entry to reverse (the not-exists filter skips
-- reversed ones) and re-posted R1 unpaired. Guard: a row that ANY newer row
-- supersedes is non-current — post nothing for it; the successor's own drain
-- owns the reversal. This also makes the record→supersede→first-drain path
-- cleaner (the original never posts at all; only the survivor does).
-- Same flaw exists in post_dc_payment_to_gl (inherited pattern) — chipped
-- separately, not widened into this spec.
--
-- Own migration: 063500 is already APPLIED (editing an applied file no-ops).
-- CREATE OR REPLACE — signature unchanged.

CREATE OR REPLACE FUNCTION public.post_client_receipt_to_gl(p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.client_receipts;
  v_old   uuid;
  v_lines jsonb;
begin
  select * into v_row from public.client_receipts where id = p_source_id;
  if not found then
    raise exception 'post_client_receipt_to_gl: receipt not found' using errcode = 'P0001';
  end if;

  if v_row.superseded_by is not null then
    select e.id into v_old from public.journal_entries e
      where e.source_table = 'client_receipts' and e.source_id = v_row.superseded_by
        and e.source_event = 'client_receipt' and e.status = 'posted'
        and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
      limit 1;
    if v_old is not null then
      perform public.reverse_journal_internal(v_old, v_row.created_by, 'void: superseded client receipt');
    end if;
  end if;

  select e.id into v_old from public.journal_entries e
    where e.source_table = 'client_receipts' and e.source_id = p_source_id
      and e.source_event = 'client_receipt' and e.status = 'posted'
      and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)
    limit 1;
  if v_old is not null then
    perform public.reverse_journal_internal(v_old, v_row.created_by, 'auto-correct: client receipt re-posted');
  end if;

  -- A tombstone/void posts nothing new.
  if v_row.amount is null then
    return null;
  end if;

  -- Re-drain guard: a row a newer row supersedes is NON-CURRENT — never (re)post
  -- it. Its successor's drain owns any reversal of its prior entry.
  if exists (select 1 from public.client_receipts n where n.superseded_by = p_source_id) then
    return null;
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1110', 'debit', v_row.amount,
                       'project_id', v_row.project_id),
    jsonb_build_object('account_code',
                       case when v_row.client_billing_id is null then '2300' else '1200' end,
                       'credit', v_row.amount, 'project_id', v_row.project_id));

  return public.post_journal_internal(
    v_row.received_date, 'client_receipts', p_source_id, 'client_receipt',
    'Client receipt', v_lines, null, v_row.created_by);
end;
$$;
