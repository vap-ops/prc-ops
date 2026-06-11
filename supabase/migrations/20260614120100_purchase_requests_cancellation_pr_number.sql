-- Spec 27 / ADR 0031 — cancellation facts + audit, and the PR running
-- number. One migration: the CHECK, trigger, and backfill must land
-- atomically with the columns they describe.

-- 1. Cancellation fact columns.
alter table public.purchase_requests
  add column cancelled_at timestamptz null,
  add column cancelled_by uuid null references public.users(id),
  add column cancellation_reason text null;

-- A cancelled row must carry its timestamp (the reverse is allowed —
-- the columns are simply unused on live rows).
alter table public.purchase_requests
  add constraint pr_cancel_shape
  check (status <> 'cancelled' or cancelled_at is not null);

-- 2. PR running number. Backfill existing rows in requested_at order so
--    history reads chronologically, then pin NOT NULL + UNIQUE and let
--    the sequence default feed every future INSERT (the column-scoped
--    INSERT grants don't name pr_number, so app inserts can't override).
create sequence public.purchase_requests_pr_number_seq;

alter table public.purchase_requests add column pr_number bigint;

with numbered as (
  select id, row_number() over (order by requested_at, id) as rn
  from public.purchase_requests
)
update public.purchase_requests pr
   set pr_number = numbered.rn
  from numbered
 where numbered.id = pr.id;

select setval(
  'public.purchase_requests_pr_number_seq',
  coalesce((select max(pr_number) from public.purchase_requests), 0) + 1,
  false
);

alter table public.purchase_requests
  alter column pr_number set not null,
  alter column pr_number set default nextval('public.purchase_requests_pr_number_seq'),
  add constraint purchase_requests_pr_number_uniq unique (pr_number);

alter sequence public.purchase_requests_pr_number_seq
  owned by public.purchase_requests.pr_number;

-- 3. Cancellation audit (ADR 0031 — action 'update', no new audit_action
--    value; third use of the ADR 0027/0030 stance). Disjoint WHEN vs the
--    decision trigger (old.status = 'requested') and the AppSheet
--    correction arm (which additionally requires a granted-column diff).
create function public.purchase_requests_audit_cancellation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (auth.uid(),
     public.current_user_role(),
     'update',
     'purchase_requests',
     new.id,
     jsonb_build_object(
       'principal',           session_user,
       'transition',          jsonb_build_array('approved', 'cancelled'),
       'cancelled_by',        new.cancelled_by,
       'cancellation_reason', new.cancellation_reason
     ));
  return new;
end;
$$;

create trigger purchase_requests_audit_cancellation
  after update on public.purchase_requests
  for each row
  when (old.status = 'approved' and new.status = 'cancelled')
  execute function public.purchase_requests_audit_cancellation();
