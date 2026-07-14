-- Spec 317 U2 — parameter DEFAULTs on submit_identity_change. The U3 signature
-- had no defaults, so the generated client types require every argument and a
-- partial proposal (e.g. name-only) could not be typed: p_dob needs a real SQL
-- NULL (an empty string fails the date cast). Adding DEFAULT NULL via CREATE OR
-- REPLACE keeps the identity arguments unchanged (defaults are not part of the
-- function identity), so the existing ACL is preserved — no drop, no window.
-- Body VERBATIM from 20260813075790.

create or replace function public.submit_identity_change(
  p_full_name   text default null,
  p_national_id text default null,
  p_dob         date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_nid  text := nullif(regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g'), '');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'submit_identity_change: not authenticated' using errcode = '42501';
  end if;
  if v_name is null and v_nid is null and p_dob is null then
    raise exception 'submit_identity_change: nothing proposed' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 120 then
    raise exception 'submit_identity_change: name too long' using errcode = 'P0001';
  end if;
  if v_nid is not null and not public.is_valid_thai_national_id(v_nid) then
    raise exception 'submit_identity_change: invalid national id' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.identity_change_requests
    where user_id = v_uid and status = 'pending'
  ) then
    raise exception 'submit_identity_change: a pending request already exists'
      using errcode = 'P0001';
  end if;

  insert into public.identity_change_requests
    (user_id, proposed_full_name, proposed_national_id, proposed_dob)
  values (v_uid, v_name, v_nid, p_dob)
  returning id into v_id;
  return v_id;
end;
$$;
