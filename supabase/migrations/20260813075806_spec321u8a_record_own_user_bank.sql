-- Spec 321 U8a — record_own_user_bank: the login(user_id)-keyed bank home goes
-- INSTANT. The spec-319 flow made an admin/office login submit a
-- user_bank_change_request that the staff-approval trio had to approve — but
-- nobody drains that queue, so logins were stranded on the pending banner. The
-- operator decided (2026-07-15) that this login-keyed bank should save directly,
-- like recording your own contact info: the same single-home guard makes a
-- forged/duplicate home impossible, and the passbook photo is still required and
-- pinned to the caller's own folder, so dropping the approval hop is safe.
--
-- This RPC = submit_user_bank_change's guards/validation (verbatim) + the upsert
-- decide_user_bank_change did on approve, applied directly for auth.uid(). It is
-- ADDITIVE: submit_/decide_user_bank_change + the tables are left in place so the
-- 3 already-pending requests stay decidable until they are resolved separately.

create or replace function public.record_own_user_bank(
  p_bank_name text,
  p_bank_account_number text,
  p_bank_account_name text,
  p_book_bank_path text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_no   text := nullif(regexp_replace(coalesce(p_bank_account_number, ''), '[\s-]', '', 'g'), '');
  v_own  text := nullif(btrim(coalesce(p_bank_account_name, '')), '');
  v_path text := nullif(btrim(coalesce(p_book_bank_path, '')), '');
begin
  if v_uid is null then
    raise exception 'record_own_user_bank: not authenticated' using errcode = '42501';
  end if;
  -- Single bank home per login (worker / contractor / approved-staff own theirs;
  -- two homes would silently drift the real payout account). Same guard as the
  -- retired submit_user_bank_change.
  if public.current_user_worker_id() is not null then
    raise exception 'record_own_user_bank: bound workers use the worker bank flow'
      using errcode = '42501';
  end if;
  if public.current_user_contractor_id() is not null then
    raise exception 'record_own_user_bank: contractors use the contractor bank flow'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.staff_registrations
             where user_id = v_uid and status = 'approved') then
    raise exception 'record_own_user_bank: approved staff use the staff bank flow'
      using errcode = '42501';
  end if;
  -- All three fields required (user_bank columns are NOT NULL); account number
  -- 6-20 digits (mirrors submit_user_bank_change / record_own_staff_bank).
  if v_name is null or v_no is null or v_own is null then
    raise exception 'record_own_user_bank: bank name, account number and account name required'
      using errcode = 'P0001';
  end if;
  if v_no !~ '^[0-9]{6,20}$' then
    raise exception 'record_own_user_bank: invalid account number' using errcode = 'P0001';
  end if;
  if v_path is null then
    raise exception 'record_own_user_bank: passbook photo required' using errcode = 'P0001';
  end if;
  -- Own technician/<uid>/book_bank folder (reuses the spec 315 U2 INSERT policy;
  -- identical pin to submit_user_bank_change).
  if storage.foldername(v_path) is null
     or array_length(storage.foldername(v_path), 1) is distinct from 3
     or (storage.foldername(v_path))[1] is distinct from 'technician'
     or (storage.foldername(v_path))[2] is distinct from v_uid::text
     or (storage.foldername(v_path))[3] is distinct from 'book_bank' then
    raise exception 'record_own_user_bank: storage path does not match owner/purpose'
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'contact-docs' and o.name = v_path) then
    raise exception 'record_own_user_bank: passbook photo not uploaded'
      using errcode = 'P0001';
  end if;
  -- Late-bind recheck immediately before the write (READ COMMITTED gives each
  -- statement a fresh snapshot, so re-run the single-home guard here to catch a
  -- worker/contractor/approved-staff home committed concurrently since the guard
  -- above — else this instant write would create a second bank home that drifts
  -- the real payout account). Mirrors decide_user_bank_change's pre-upsert check.
  if public.current_user_worker_id() is not null
     or public.current_user_contractor_id() is not null
     or exists (select 1 from public.staff_registrations
                where user_id = v_uid and status = 'approved') then
    raise exception 'record_own_user_bank: another bank home now exists'
      using errcode = 'P0001';
  end if;

  insert into public.user_bank
    (user_id, bank_name, bank_account_number, bank_account_name, book_bank_path, updated_by)
  values (v_uid, v_name, v_no, v_own, v_path, v_uid)
  on conflict (user_id) do update
    set bank_name           = excluded.bank_name,
        bank_account_number = excluded.bank_account_number,
        bank_account_name   = excluded.bank_account_name,
        book_bank_path      = excluded.book_bank_path,
        updated_at          = now(),
        updated_by          = excluded.updated_by;
end;
$function$;

revoke all on function public.record_own_user_bank(text, text, text, text) from public, anon;
grant execute on function public.record_own_user_bank(text, text, text, text) to authenticated;
