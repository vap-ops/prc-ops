-- Spec 208 Q3 (reverses spec 134 U8 / migration 20260717000000) — admit
-- procurement to receive_po_lines.
--
-- Trigger: feedback 6fbcc039 — "จัดซื้อไม่สามารถรับของเข้าคลังได้" (procurement
-- can't receive goods into the store). While site_admin is short-staffed, the
-- off-site purchase team must be able to confirm arrival on the site's behalf.
-- The operator approved this role-doctrine change (2026-06-26).
--
-- Why this is the SAFE fix (vs a seeded manual store-in): receive_po_lines is the
-- ONE receive action. Marking a WP-less catalogued PR delivered fires the single
-- idempotent auto-receipt (Dr 1500 Inventory / Cr AP, one receipt per PR via the
-- stock_receipts_pr_uniq index); a WP-bound PR posts WP-WIP via post_purchase_to_gl.
-- Both are existing, tested postings — no double-count. A parallel manual store-in
-- (purchase_request_id NULL) WOULD double-count, which is why it is not used.
--
-- This only widens the role gate; the body, signature, grants, and in-transit /
-- all-or-nothing guards are unchanged.

create or replace function public.receive_po_lines(
  p_request_ids uuid[],
  p_received_by text default null,
  p_delivery_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id    uuid;
  v_count integer := 0;
  v_batch uuid := gen_random_uuid();
begin
  -- Receiving is a site action (site_admin / project_manager / super_admin /
  -- project_director) PLUS procurement (spec 208 Q3 — the off-site team helps
  -- receive when site staff are short).
  if public.current_user_role()
       not in ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'receive_po_lines: role not permitted' using errcode = '42501';
  end if;

  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    raise exception 'receive_po_lines: no lines' using errcode = 'P0001';
  end if;

  foreach v_id in array p_request_ids loop
    update public.purchase_requests
       set delivered_at      = now(),
           received_by       = p_received_by,
           delivery_note     = p_delivery_note,
           delivery_batch_id = v_batch
     where id = v_id
       and status in ('purchased', 'on_route');
    if not found then
      raise exception 'receive_po_lines: line % is not an in-transit member', v_id
        using errcode = 'P0001';
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
