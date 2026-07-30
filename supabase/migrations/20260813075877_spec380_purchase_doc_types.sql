-- Spec 380 U1 — purchase document typing + accounting-only waivers.
-- doc_type is NULLABLE on purpose: 393 legacy attachments stay untyped and count
-- as covered-loose (spec §2 decision ② — retyping history is accounting's
-- opportunistic job, not a migration). Waivers are the §2 ladder's dead-end
-- record (VAT vendor refuses → input VAT becomes cost) — one per PR, visible to
-- everyone who can see the PR, written ONLY by accounting/super via DEFINER.

create type public.purchase_doc_type as enum (
  'tax_invoice_full',   -- ใบกำกับภาษีเต็มรูป (ม.86/4; the VAT-class satisfier)
  'receipt_cash_bill',  -- ใบเสร็จรับเงิน / บิลเงินสด ที่ระบุผู้ขาย (ม.105 ทวิ)
  'payment_voucher',    -- ใบสำคัญรับเงิน (+ สำเนาบัตรผู้รับ, บุคคลธรรมดา)
  'cert_in_lieu',       -- ใบรับรองแทนใบเสร็จรับเงิน (internal, seller won't sign)
  'delivery_note',      -- ใบส่งของ — supporting only, never satisfies (ม.65 ตรี (18))
  'transfer_slip',      -- สลิปโอน — supporting only, never satisfies
  'other'
);

create type public.purchase_doc_waiver_reason as enum (
  'vendor_refused', 'docs_unobtainable', 'other'
);

alter table public.purchase_request_attachments
  add column doc_type public.purchase_doc_type;
alter table public.purchase_order_attachments
  add column doc_type public.purchase_doc_type;

comment on column public.purchase_request_attachments.doc_type is
  'Spec 380: accounting doc class. NULL = legacy untyped upload (covered-loose in doc-chase).';
comment on column public.purchase_order_attachments.doc_type is
  'Spec 380: accounting doc class. NULL = legacy untyped upload (covered-loose in doc-chase).';

create table public.purchase_doc_waivers (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null unique
    references public.purchase_requests(id) on delete cascade,
  reason public.purchase_doc_waiver_reason not null,
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  -- a named reason explains itself; 'other' without a note explains nothing
  constraint pdw_note_required_for_other check (reason <> 'other' or note is not null)
);

alter table public.purchase_doc_waivers enable row level security;

-- Read follows the parent PR exactly like purchase_request_attachments
-- ("select via parent"): whoever may see the order may see that its docs were
-- waived. No INSERT/UPDATE/DELETE policies — the DEFINER RPCs are the only writers.
create policy "select via parent pr" on public.purchase_doc_waivers
  for select to authenticated
  using (exists (
    select 1 from public.purchase_requests pr
    where pr.id = purchase_doc_waivers.purchase_request_id));

revoke all on public.purchase_doc_waivers from anon;

create or replace function public.waive_purchase_docs(
  p_purchase_request uuid,
  p_reason public.purchase_doc_waiver_reason,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  -- Decision ③ (2026-07-30): waiving is accounting's call, nobody else's.
  if v_role is null or v_role::text not in ('accounting', 'super_admin') then
    raise exception 'waive_purchase_docs: role not permitted' using errcode = '42501';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'waive_purchase_docs: note required for reason other' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.purchase_requests where id = p_purchase_request) then
    raise exception 'waive_purchase_docs: purchase request not found' using errcode = 'P0001';
  end if;

  -- Re-waive updates in place (idempotent correction of the reason/note);
  -- every call still audits, so the trail keeps each decision.
  insert into public.purchase_doc_waivers (purchase_request_id, reason, note, created_by)
  values (p_purchase_request, p_reason, v_note, auth.uid())
  on conflict (purchase_request_id) do update
    set reason = excluded.reason,
        note = excluded.note,
        created_by = excluded.created_by,
        created_at = now()
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'purchase_doc_waivers', p_purchase_request,
    jsonb_build_object('event', 'purchase_docs_waived',
                       'reason', p_reason, 'note', v_note));
  return v_id;
end;
$$;

create or replace function public.unwaive_purchase_docs(
  p_purchase_request uuid
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role::text not in ('accounting', 'super_admin') then
    raise exception 'unwaive_purchase_docs: role not permitted' using errcode = '42501';
  end if;
  delete from public.purchase_doc_waivers where purchase_request_id = p_purchase_request;
  if not found then
    raise exception 'unwaive_purchase_docs: no waiver to remove' using errcode = 'P0001';
  end if;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), v_role, 'purchase_doc_waivers', p_purchase_request,
    jsonb_build_object('event', 'purchase_docs_unwaived'));
end;
$$;

-- New function = PUBLIC EXECUTE by default (the 372 U4a lesson): kill it, then
-- grant back the one audience. The role gate inside is the real boundary.
revoke all on function public.waive_purchase_docs(uuid, public.purchase_doc_waiver_reason, text) from public, anon;
revoke all on function public.unwaive_purchase_docs(uuid) from public, anon;
grant execute on function public.waive_purchase_docs(uuid, public.purchase_doc_waiver_reason, text) to authenticated;
grant execute on function public.unwaive_purchase_docs(uuid) to authenticated;
