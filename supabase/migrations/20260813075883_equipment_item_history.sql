-- Spec 381 U1 — per-item equipment history.
--
-- Operator, 2026-07-30: "Each item needs a log history." Three of the four
-- sources already exist (movements, borrow logs, rate changes); the fourth —
-- ordinary edits to name / category / owner / status / tracking / asset tag /
-- image — left NO trace at all. This migration adds the writer for that gap and
-- one reader that can serve the whole story to the people who own the equipment.
--
-- Timing is the point: the registry was wiped and is being re-typed by hand right
-- now (mig …_075882_), so a trail installed today is complete from birth.
--
-- ── The two live findings this design is built on ───────────────────────────
--
-- 1. WHY THE WRITER IS `SECURITY DEFINER`: `authenticated` holds SELECT-ONLY on
--    `audit_log` — no INSERT grant, and no INSERT policy. A trigger function runs
--    as the invoking user, so an ordinary trigger inserting there would raise
--    42501 and ABORT THE USER'S EDIT: editing any item would simply stop working.
--    `set_equipment_daily_rate` already writes its audit rows the same way.
--
-- 2. WHY THE READER IS ALSO `SECURITY DEFINER`: `audit_log`'s SELECT policies
--    admit `super_admin`/`project_director`/`accounting`/`project_manager`, plus a
--    two-event arm (`wp_reopened_for_defect`, `wp_evidence_resubmitted`) for
--    site_admin/procurement/procurement_manager. So `procurement` — who curates
--    this registry — cannot read a single equipment audit row directly, and the
--    history would render empty for exactly its audience.
--
-- MONEY: `equipment_rate_change` payloads carry `old_rate`/`new_rate`, and
-- `daily_rate` has no `authenticated` grant at all (ADR 0055 decision 6). The
-- reader OMITS those rows for a non-back-office caller rather than redacting
-- them — a visible "the rate changed" line still discloses that the asset is
-- priced.

-- ---------------------------------------------------------------------------
-- The new event. Deliberately its own label rather than `other` + payload.event:
-- equipment already owns four audit_action values, and a dedicated label keeps
-- every future audit query honest. Trips the exact-list enum_has_labels pin in
-- 03-audit-log-shape.test.sql, which is updated alongside — never weakened.
-- ---------------------------------------------------------------------------
alter type public.audit_action add value if not exists 'equipment_item_updated';

-- ---------------------------------------------------------------------------
-- Writer: record WHAT CHANGED, never the whole row.
--
-- A whole-row snapshot would drag `daily_rate` and `acquisition_cost` (money,
-- ungranted) into a payload this spec deliberately shows to a non-money
-- audience. So the diff is built from a fixed, money-free field list; anything
-- outside it is invisible here by construction, not by filtering later.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_item_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_field text;
  v_old text;
  v_new text;
begin
  foreach v_field in array array[
    'name', 'category_id', 'owner_id', 'status', 'tracking',
    'asset_tag', 'quantity', 'brand', 'model', 'serial_no',
    'condition', 'description', 'image_path'
  ]
  loop
    v_old := to_jsonb(old) ->> v_field;
    v_new := to_jsonb(new) ->> v_field;
    -- `is distinct from` so a NULL on either side counts as a change; plain <>
    -- would silently swallow "was unset, now set", which is most of a fresh
    -- registry's history.
    if v_old is distinct from v_new then
      v_changes := v_changes || jsonb_build_object(
        v_field, jsonb_build_object('from', v_old, 'to', v_new)
      );
    end if;
  end loop;

  -- A no-op UPDATE must not manufacture history. The importer re-writes all
  -- columns on every row it touches, so without this a 64-row import would add
  -- 64 rows saying nothing changed.
  if v_changes = '{}'::jsonb then
    return null;
  end if;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    auth.uid(),
    (select public.current_user_role()),
    'equipment_item_updated',
    'equipment_items',
    new.id,
    jsonb_build_object('changes', v_changes)
  );

  return null; -- AFTER trigger; return value is ignored
end;
$$;

revoke all on function public.equipment_item_audit() from public, anon;

create trigger equipment_items_audit_update
  after update on public.equipment_items
  for each row
  execute function public.equipment_item_audit();

-- ---------------------------------------------------------------------------
-- Reader: one item's whole story, newest first.
--
-- Gated to the /equipment page audience (site_admin + back office) — the
-- site_admin moving the tool is the person most likely to ask where it went.
-- The money arm is narrower still.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_item_history(p_item_id uuid)
returns table (
  occurred_at timestamptz,
  kind text,
  actor_id uuid,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce((select public.current_user_role())::text, '');
  v_money boolean;
begin
  -- coalesce-to-empty above: an unbound caller must fall to the DENY arm, not
  -- slip through a NULL comparison (the rls-self-check-coalesce trap).
  if v_role not in ('site_admin','project_manager','procurement',
                    'procurement_manager','super_admin','project_director') then
    raise exception 'not authorised to read equipment history' using errcode = '42501';
  end if;

  v_money := v_role in ('project_manager','procurement','procurement_manager',
                        'super_admin','project_director');

  return query
  -- Location moves (append-only).
  select m.occurred_at,
         'movement_' || m.kind::text,
         m.created_by,
         jsonb_strip_nulls(jsonb_build_object(
           'project_id', m.project_id,
           'quantity', m.quantity,
           'note', m.note
         ))
    from public.equipment_movements m
   where m.item_id = p_item_id

  union all
  -- Borrow / return (spec 370's scan door). daily_rate_snapshot is money and is
  -- deliberately NOT selected — not even for the money audience, because this
  -- surface is about custody, not billing.
  select u.created_at,
         case when u.checked_in_on is null then 'loan_out' else 'loan_returned' end,
         u.entered_by,
         jsonb_strip_nulls(jsonb_build_object(
           'work_package_id', u.work_package_id,
           'checked_out_on', u.checked_out_on,
           'checked_in_on', u.checked_in_on,
           'borrower_worker_id', u.borrower_worker_id,
           'via', u.via
         ))
    from public.equipment_usage_logs u
   where u.item_id = p_item_id
     and u.superseded_by is null

  union all
  -- Field edits (this migration's new trail).
  select a.created_at,
         'item_updated',
         a.actor_id,
         a.payload
    from public.audit_log a
   where a.target_table = 'equipment_items'
     and a.target_id = p_item_id
     and a.action = 'equipment_item_updated'

  union all
  -- Rate changes — MONEY. Omitted entirely for a non-money caller.
  select a.created_at,
         'rate_change',
         a.actor_id,
         a.payload
    from public.audit_log a
   where v_money
     and a.target_table = 'equipment_items'
     and a.target_id = p_item_id
     and a.action = 'equipment_rate_change'

  order by 1 desc;
end;
$$;

-- A new signature is a NEW function, so it arrives with the default PUBLIC
-- EXECUTE grant — revoke from BOTH public and anon (anon-only is the documented
-- half-fix that leaves the hole open).
revoke all on function public.equipment_item_history(uuid) from public, anon;
grant execute on function public.equipment_item_history(uuid) to authenticated, service_role;

comment on function public.equipment_item_history(uuid) is
  'Spec 381 — one equipment item''s history (moves, loans, field edits, and rate changes for the money audience only). SECURITY DEFINER because audit_log SELECT excludes procurement/site_admin.';
