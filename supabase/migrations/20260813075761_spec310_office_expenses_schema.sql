-- Spec 310 — non-WP office expenses. New tables + payment_source enum + DEFINER RPCs.
-- Writes go through the RPCs only; authenticated gets SELECT (RLS-scoped), never DML.

create type public.payment_source as enum ('company_card', 'own_money', 'company_direct');

-- ---------- company_cards (superadmin registry; NO card number stored) ----------
create table public.company_cards (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  holder_user_id uuid not null references public.users(id),
  last4          text,
  is_active      boolean not null default true,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint company_cards_label_shape check (length(btrim(label)) between 1 and 60),
  constraint company_cards_last4_shape check (last4 is null or last4 ~ '^[0-9]{4}$')
);

-- ---------- office_expense_categories (managed list; carries Phase-2 GL mapping) ----------
create table public.office_expense_categories (
  id              uuid primary key default gen_random_uuid(),
  label_th        text not null,
  label_en        text,
  gl_account_code text,            -- Phase-2: accountant fills; soft ref to gl_accounts.code
  sort            integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- office_expenses ----------
create table public.office_expenses (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references public.projects(id),
  category_id          uuid not null references public.office_expense_categories(id),
  description          text not null,
  amount               numeric not null,
  expense_date         date not null,
  payment_source       public.payment_source not null,
  company_card_id      uuid references public.company_cards(id),
  reimburse_to_user_id uuid references public.users(id),
  reimbursed_at        timestamptz,
  reimbursed_by        uuid references public.users(id),
  submitted_by         uuid not null references public.users(id),
  created_at           timestamptz not null default now(),
  constraint office_expenses_amount_positive check (amount > 0),
  constraint office_expenses_desc_shape check (length(btrim(description)) between 1 and 500),
  -- company_card iff a card is attached
  constraint office_expenses_card_consistency check (
    (payment_source = 'company_card' and company_card_id is not null)
    or (payment_source <> 'company_card' and company_card_id is null)
  )
);
create index office_expenses_submitted_by_idx on public.office_expenses (submitted_by);
create index office_expenses_reimburse_idx on public.office_expenses (reimburse_to_user_id) where reimbursed_at is null;
create index office_expenses_project_idx on public.office_expenses (project_id);

-- ---------- office_expense_attachments (append-only receipt metadata) ----------
create table public.office_expense_attachments (
  id                uuid primary key,          -- client-supplied uuid = storage object name
  office_expense_id uuid not null references public.office_expenses(id) on delete cascade,
  storage_path      text not null,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  unique (storage_path)
);
create index office_expense_attachments_expense_idx on public.office_expense_attachments (office_expense_id);

-- ================= RLS =================
alter table public.company_cards enable row level security;
alter table public.office_expense_categories enable row level security;
alter table public.office_expenses enable row level security;
alter table public.office_expense_attachments enable row level security;

revoke all on public.company_cards, public.office_expense_categories,
              public.office_expenses, public.office_expense_attachments
  from anon, authenticated;
grant select on public.company_cards, public.office_expense_categories,
                public.office_expenses, public.office_expense_attachments
  to authenticated;
grant select, insert, update, delete on public.company_cards, public.office_expense_categories,
                public.office_expenses, public.office_expense_attachments
  to service_role;

-- cards + categories readable by any authenticated user (form pickers need them)
create policy "company cards readable" on public.company_cards
  for select to authenticated using (true);
create policy "expense categories readable" on public.office_expense_categories
  for select to authenticated using (true);

-- office_expenses: submitter sees own; finance (accounting/super_admin) see all.
-- Fail-closed: current_user_role() NULL -> both branches false.
-- auth.uid() / current_user_role() wrapped in a scalar subselect so the planner
-- evaluates them once per query, not per row (pinned by 40-rls-eval-once.test.sql).
create policy "office expenses visible to submitter or finance" on public.office_expenses
  for select to authenticated using (
    submitted_by = (select auth.uid())
    or coalesce((select public.current_user_role()) in ('super_admin','accounting'), false)
  );

-- attachments follow their parent expense's visibility
create policy "expense attachments follow parent" on public.office_expense_attachments
  for select to authenticated using (
    exists (select 1 from public.office_expenses e
              where e.id = office_expense_id
                and (e.submitted_by = (select auth.uid())
                     or coalesce((select public.current_user_role()) in ('super_admin','accounting'), false)))
  );

-- ================= seed categories =================
insert into public.office_expense_categories (label_th, sort) values
  ('น้ำมัน/ค่าเดินทาง', 10),
  ('ทางด่วน/ที่จอดรถ', 20),
  ('อุปกรณ์สำนักงาน', 30),
  ('ซอฟต์แวร์/บริการ', 40),
  ('ค่ารับรอง/อาหาร', 50),
  ('ค่าสาธารณูปโภค', 60),
  ('ค่าธรรมเนียม/ราชการ', 70),
  ('อื่นๆ', 999);

-- ================= RPCs =================
-- record_office_expense: gate to office roles, validate, resolve reimburse target, insert.
create function public.record_office_expense(
  p_category_id uuid,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_payment_source public.payment_source,
  p_project_id uuid default null,
  p_company_card_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_reimburse uuid;
  v_id uuid;
begin
  if v_role is null
     or v_role not in ('super_admin','procurement','procurement_manager','accounting') then
    raise exception 'record_office_expense: role not permitted' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_description)), 0) = 0 then
    raise exception 'record_office_expense: description required' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_office_expense: amount must be positive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.office_expense_categories where id = p_category_id and is_active) then
    raise exception 'record_office_expense: unknown category' using errcode = 'P0001';
  end if;

  if p_payment_source = 'company_card' then
    if p_company_card_id is null then
      raise exception 'record_office_expense: card required for company_card source' using errcode = 'P0001';
    end if;
    select holder_user_id into v_reimburse
      from public.company_cards where id = p_company_card_id and is_active;
    if v_reimburse is null then
      raise exception 'record_office_expense: unknown or inactive card' using errcode = 'P0001';
    end if;
  elsif p_payment_source = 'own_money' then
    v_reimburse := auth.uid();
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  else  -- company_direct
    v_reimburse := null;
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  end if;

  insert into public.office_expenses
    (project_id, category_id, description, amount, expense_date, payment_source,
     company_card_id, reimburse_to_user_id, submitted_by)
  values
    (p_project_id, p_category_id, btrim(p_description), p_amount, p_expense_date, p_payment_source,
     case when p_payment_source = 'company_card' then p_company_card_id else null end,
     v_reimburse, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_record', auth.uid(), v_role, 'office_expenses', v_id,
          jsonb_build_object('amount', p_amount, 'payment_source', p_payment_source,
                             'reimburse_to', v_reimburse, 'project_id', p_project_id));
  return v_id;
end;
$$;
revoke all     on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) from public;
revoke execute on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) from anon;
grant  execute on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) to authenticated;

-- mark_expense_reimbursed: finance only; idempotent-guarded.
create function public.mark_expense_reimbursed(p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_target uuid;
  v_already timestamptz;
begin
  if v_role is null or v_role not in ('super_admin','accounting') then
    raise exception 'mark_expense_reimbursed: role not permitted' using errcode = '42501';
  end if;
  select reimburse_to_user_id, reimbursed_at into v_target, v_already
    from public.office_expenses where id = p_expense_id;
  if not found then
    raise exception 'mark_expense_reimbursed: expense not found' using errcode = 'P0001';
  end if;
  if v_target is null then
    raise exception 'mark_expense_reimbursed: expense has no reimburse target' using errcode = 'P0001';
  end if;
  if v_already is not null then
    raise exception 'mark_expense_reimbursed: already reimbursed' using errcode = 'P0001';
  end if;
  -- The conditional UPDATE is the atomic guard against a concurrent double-mark:
  -- the SELECT above does not lock, so two racing calls both read a null
  -- reimbursed_at; the loser's UPDATE then re-reads it as non-null (READ
  -- COMMITTED) and matches 0 rows -> not found -> raise, so audit_log gets ONE row.
  update public.office_expenses
     set reimbursed_at = now(), reimbursed_by = auth.uid()
   where id = p_expense_id and reimbursed_at is null;
  if not found then
    raise exception 'mark_expense_reimbursed: already reimbursed' using errcode = 'P0001';
  end if;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_reimburse', auth.uid(), v_role, 'office_expenses', p_expense_id,
          jsonb_build_object('reimburse_to', v_target));
end;
$$;
revoke all     on function public.mark_expense_reimbursed(uuid) from public;
revoke execute on function public.mark_expense_reimbursed(uuid) from anon;
grant  execute on function public.mark_expense_reimbursed(uuid) to authenticated;

-- upsert_company_card: super_admin only. NULL p_id = insert; else update.
create function public.upsert_company_card(
  p_id uuid, p_label text, p_holder_user_id uuid, p_last4 text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'upsert_company_card: super_admin only' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_label)), 0) = 0 then
    raise exception 'upsert_company_card: label required' using errcode = 'P0001';
  end if;
  if p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then
    raise exception 'upsert_company_card: last4 must be 4 digits' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users where id = p_holder_user_id) then
    raise exception 'upsert_company_card: unknown holder' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.company_cards (label, holder_user_id, last4, created_by)
    values (btrim(p_label), p_holder_user_id, p_last4, auth.uid())
    returning id into v_id;
  else
    update public.company_cards
       set label = btrim(p_label), holder_user_id = p_holder_user_id,
           last4 = p_last4, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_company_card: card not found' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all     on function public.upsert_company_card(uuid, text, uuid, text) from public;
revoke execute on function public.upsert_company_card(uuid, text, uuid, text) from anon;
grant  execute on function public.upsert_company_card(uuid, text, uuid, text) to authenticated;

-- deactivate_company_card: super_admin only (soft-delete).
create function public.deactivate_company_card(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'deactivate_company_card: super_admin only' using errcode = '42501';
  end if;
  update public.company_cards set is_active = false, updated_at = now() where id = p_id;
end;
$$;
revoke all     on function public.deactivate_company_card(uuid) from public;
revoke execute on function public.deactivate_company_card(uuid) from anon;
grant  execute on function public.deactivate_company_card(uuid) to authenticated;
