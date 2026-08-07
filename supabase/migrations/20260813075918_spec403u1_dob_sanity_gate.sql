-- Spec 403 U1 — the DOB sanity gate. Operator ruling 2026-08-07: hard block
-- under 15, and keep the 120-year ceiling ("dob is often wrong year" is
-- symmetric — a 1889 typo is the same defect as a 2569 one).
--
-- Two wrong-year classes were measured live and neither was rejected anywhere:
--   * a Buddhist-era year typed into a CE field — `วีระชัย เส็งนา` carried
--     2513-03-11 in BOTH workers and staff_registrations, a date 487 years in
--     the future;
--   * the date picker's own submit date — a pending identity_change_requests
--     row carried 2026-07-15, its own created_at, i.e. age 0.
-- submit_identity_change runs a mod-11 checksum on the national ID and NOTHING
-- on the DOB, and no other writer checks either.
--
-- WHY A TRIGGER RATHER THAN A CHECK IN EACH RPC. Six live functions can write a
-- DOB (submit_identity_change, decide_identity_change, sa_add_project_worker,
-- sa_add_project_worker_with_bank, crew_lead_add_member,
-- update_own_staff_registration) and a seventh can be added by anyone. A
-- per-RPC `perform` would have to be reproduced in six function bodies and
-- would silently not cover writer number seven; the trigger covers every path
-- into the column that a NON-OWNER role can take. A CHECK constraint cannot do
-- it — the rule depends on the current date, which is not immutable.
--
-- The claim stops at the table owner on purpose: `alter table … disable trigger`
-- and `session_replication_role` remain available to a migration, the CLI or the
-- dashboard. That is the existing break-glass surface, not a user-reachable
-- hole, and the triggers stay `O` (origin) rather than `always` so a restore
-- behaves normally.
--
-- dob_rejection_reason is the pure SSOT and returns the REASON rather than a
-- boolean, so every caller can name the actual cause. That matters most for the
-- Buddhist-era arm: 2513-03-11 is ALSO a future date, so the BE test runs
-- FIRST — "the future" would be true, useless, and would never tell the user to
-- subtract 543.
--
-- NOT RETROACTIVE, deliberately. An UPDATE that does not CHANGE the DOB is not
-- validated, so the one legacy bad row stays editable for every other reason.
-- Repairing it is spec 403 U4, an operator-run data op, not this migration.

-- The app's civil date. Everything about an age floor is a statement about the
-- day it is WHERE THE PEOPLE ARE, not where the server is.
create or replace function public.dob_today()
returns date
language sql
stable
set search_path = public
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
revoke all on function public.dob_today() from public, anon;

create or replace function public.dob_rejection_reason(p_dob date)
returns text
language sql
stable
set search_path = public
as $$
  -- Asia/Bangkok, NOT current_date: the server runs in UTC, so between 00:00 and
  -- 07:00 Bangkok current_date is YESTERDAY and someone submitting on their
  -- actual 15th birthday would be refused as under-age. The three RPCs that
  -- already floor at 18 use exactly this expression; diverging from them would
  -- have made two floors disagree for seven hours a day.
  select case
    -- Every BE year a living person can hold is >= 2440 and no legitimate CE
    -- birth year exceeds 2400, so this is an exact discriminator. It runs
    -- before the future test on purpose (see header).
    when p_dob is null                  then null
    when not isfinite(p_dob)            then 'dob is not a real date'
    when extract(year from p_dob) > 2400 then 'dob looks like a buddhist era year'
    when p_dob > public.dob_today()      then 'dob in the future'
    when p_dob > (public.dob_today() - interval '15 years')::date  then 'dob under minimum age'
    when p_dob < (public.dob_today() - interval '120 years')::date then 'dob implausibly old'
    else null
  end;
$$;
revoke all on function public.dob_rejection_reason(date) from public, anon;

-- The trigger body. The guarded column is passed as TG_ARGV[0] so one function
-- serves all five tables; to_jsonb keeps it column-name-driven without dynamic
-- SQL. TG_ARGV[1] is optional and names the status value that means "this
-- proposal is being APPLIED" — see the applying arm below.
create or replace function public.assert_valid_dob_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_col    text := tg_argv[0];
  v_new    date := nullif(to_jsonb(new) ->> v_col, '')::date;
  v_old    date := case
                     when tg_op = 'UPDATE' then nullif(to_jsonb(old) ->> v_col, '')::date
                     else null
                   end;
  -- The APPLYING arm. Found by Gate 4, not by reasoning: decide_identity_change
  -- writes workers / staff_registrations / contractors only WHERE a matching row
  -- exists, and live, three of the four pending requests have none of the three.
  -- So approving a bad proposal updated nothing, fired no trigger, raised
  -- nothing, and marked the request approved. A proposal has to be validated
  -- where it is APPLIED, not only where it lands.
  v_applying boolean := tg_op = 'UPDATE'
                        and tg_nargs > 1
                        and (to_jsonb(new) ->> 'status') = tg_argv[1]
                        and (to_jsonb(old) ->> 'status') is distinct from tg_argv[1];
  v_reason text;
begin
  -- A mistyped column name would otherwise make this trigger a silent no-op:
  -- `->>` returns NULL for an absent key and a NULL DOB is acceptable, so the
  -- gate would read as installed and guard nothing. Fail loudly instead.
  if not (to_jsonb(new) ? v_col) then
    raise exception '%: assert_valid_dob_trigger is guarding column %, which does not exist',
      tg_table_name, v_col using errcode = 'P0001';
  end if;

  -- An UPDATE that leaves the DOB alone is never validated: a row that predates
  -- this gate must stay editable for other reasons. Applying it is the one
  -- exception — that is the moment the stored value becomes real.
  if tg_op = 'UPDATE' and v_new is not distinct from v_old and not v_applying then
    return new;
  end if;

  v_reason := public.dob_rejection_reason(v_new);
  if v_reason is not null then
    raise exception '%.%: %', tg_table_name, v_col, v_reason using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.assert_valid_dob_trigger() from public, anon;

-- `drop … if exists` first so this file is replayable end-to-end. It had to be
-- replayed once: the applying arm above was added after the first apply, and a
-- hand-patched object would leave the committed file untested by pgTAP, which
-- asserts against the LIVE schema.
drop trigger if exists workers_dob_valid on public.workers;
create trigger workers_dob_valid
  before insert or update on public.workers
  for each row execute function public.assert_valid_dob_trigger('date_of_birth');

drop trigger if exists staff_registrations_dob_valid on public.staff_registrations;
create trigger staff_registrations_dob_valid
  before insert or update on public.staff_registrations
  for each row execute function public.assert_valid_dob_trigger('date_of_birth');

drop trigger if exists crew_registrations_dob_valid on public.crew_registrations;
create trigger crew_registrations_dob_valid
  before insert or update on public.crew_registrations
  for each row execute function public.assert_valid_dob_trigger('date_of_birth');

drop trigger if exists contractors_dob_valid on public.contractors;
create trigger contractors_dob_valid
  before insert or update on public.contractors
  for each row execute function public.assert_valid_dob_trigger('date_of_birth');

-- The pre-approval store. The second argument arms the applying arm: blocking on
-- INSERT stops the age-0 class at the source, and blocking on the transition to
-- 'approved' stops an ALREADY-pending bad request — including for the three live
-- requesters who have no worker row, no approved registration and no contractor
-- link, and whose approve would otherwise have written nowhere and refused
-- nothing.
drop trigger if exists identity_change_requests_dob_valid on public.identity_change_requests;
create trigger identity_change_requests_dob_valid
  before insert or update on public.identity_change_requests
  for each row execute function public.assert_valid_dob_trigger('proposed_dob', 'approved');
