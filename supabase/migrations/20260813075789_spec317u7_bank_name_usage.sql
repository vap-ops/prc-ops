-- Spec 317 U7 — bank_name_usage(): the aggregate behind the shared ชื่อธนาคาร
-- picker's usage-frequency order (operator 2026-07-14: bank name = selection
-- sorted by usage frequency, with icons).
--
-- Counts every stored bank name across the three bank homes: workers.bank_name
-- (zero-grant money col) + contact_bank.bank_name (zero-grant) +
-- staff_registration_bank.bank_name (zero-grant). DEFINER exposes ONLY
-- (bank_name, uses) aggregates — no account numbers, no holders, no row
-- linkage — so an authenticated grant is safe while every underlying wall
-- stays intact. STABLE: read-only.

create function public.bank_name_usage()
returns table (bank_name text, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.bank_name, count(*)::bigint as uses
  from (
    select w.bank_name from public.workers w where w.bank_name is not null
    union all
    select cb.bank_name from public.contact_bank cb where cb.bank_name is not null
    union all
    select srb.bank_name from public.staff_registration_bank srb where srb.bank_name is not null
  ) t
  group by t.bank_name
$$;
revoke all on function public.bank_name_usage() from public, anon;
grant execute on function public.bank_name_usage() to authenticated;
