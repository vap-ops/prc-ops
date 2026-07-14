-- Spec 317 U7 — bank_name_usage(): the aggregate behind the shared ชื่อธนาคาร
-- picker's usage-frequency order (operator 2026-07-14: bank name = selection
-- sorted by usage frequency, with icons).
--
-- Counts stored bank names across the three bank homes: workers.bank_name
-- (zero-grant money col) + contact_bank.bank_name (zero-grant) +
-- staff_registration_bank.bank_name (zero-grant). DEFINER exposes ONLY
-- (bank_name, uses) aggregates — no account numbers, no holders, no row
-- linkage. The caller supplies the name list (the client's THAI_BANKS SSOT),
-- so the function NEVER returns a stored string verbatim beyond what the
-- caller already named — a mistyped legacy free-text bank_name (which could
-- hold anything) can never surface firm-wide (fresh-eyes 2026-07-14).
-- STABLE: read-only.

create function public.bank_name_usage(p_names text[])
returns table (bank_name text, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.bank_name, count(*)::bigint as uses
  from (
    select w.bank_name from public.workers w where w.bank_name = any(p_names)
    union all
    select cb.bank_name from public.contact_bank cb where cb.bank_name = any(p_names)
    union all
    select srb.bank_name from public.staff_registration_bank srb where srb.bank_name = any(p_names)
  ) t
  group by t.bank_name
$$;
revoke all on function public.bank_name_usage(text[]) from public, anon;
grant execute on function public.bank_name_usage(text[]) to authenticated;
