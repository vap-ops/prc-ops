-- Operator ask 2026-07-30 (with the registry reset in …_075882_):
-- "owner defaults to PRI (Preston International Co., Ltd.) as selection".
--
-- Three things happen here, and the third is the one that would have bitten:
--
--   1. `equipment_owners.is_default` — the default owner is DATA. Spec 367 §3 is
--      a sale of the whole fleet to PRI followed by renting it back, so the
--      owning company is precisely the value that changes; a name compiled into
--      the bundle would be wrong by design. A PARTIAL UNIQUE INDEX keeps at most
--      one row flagged so the form's default cannot depend on row order.
--
--   2. PRI is inserted as that default, and the existing owner's name typo is
--      corrected in place: `Prestion Construction Co., Ltd.` →
--      `Preston Construction Co., Ltd.`. Id-stable on purpose — 29
--      `equipment_rental_batches` and `journal_lines.equipment_owner_id` point at
--      that row, so a rename is safe where a replace would rewrite GL history.
--
--   3. PRI is ID-MIRRORED INTO `suppliers`. `createEquipment` writes
--      `supplier_id = owner_id` (spec 275 — the GL-party edge, ADR 0074), and
--      that column FKs to `public.suppliers`. Verified live before writing this:
--      the one existing owner has a `suppliers` row with the SAME id and the same
--      name. Without the mirror, the operator's very first hand-added item under
--      PRI fails with 23503 behind the generic "บันทึกอุปกรณ์ไม่สำเร็จ" string.
--      ⚠️ `createEquipmentOwner` (the app's + เจ้าของ button) does NOT do this —
--      it inserts the owner row alone. Any owner added through the UI is
--      therefore unusable for item creation. Logged as a follow-up, not widened
--      here.
--
-- Column-grant note: `equipment_owners` is COLUMN-GRANTED (SELECT names five
-- columns), so the new column needs an explicit SELECT grant or PostgREST
-- refuses the whole read. UPDATE is deliberately NOT granted — nothing in the UI
-- switches the default this unit, and an ungranted column cannot be flipped by a
-- crafted request. Pinned in both directions in
-- `supabase/tests/database/367b-equipment-owner-default.test.sql`.

alter table public.equipment_owners
  add column if not exists is_default boolean not null default false;

comment on column public.equipment_owners.is_default is
  'The owner preselected on the equipment add form (operator ask 2026-07-30). At most one row, enforced by equipment_owners_one_default_idx.';

create unique index if not exists equipment_owners_one_default_idx
  on public.equipment_owners (is_default)
  where is_default;

grant select (is_default) on public.equipment_owners to authenticated;

-- ---------------------------------------------------------------------------
-- Data: fix the existing owner's spelling, then seed PRI as the default.
-- ---------------------------------------------------------------------------

-- Guarded by the exact misspelling so a re-run (or a hand-fix that lands first)
-- is a no-op rather than a clobber. `suppliers` carries the same name by the
-- spec-275 mirror, so it is corrected in the same breath — otherwise the two
-- sides of one identity disagree on every GL-facing document.
update public.equipment_owners
   set name = 'Preston Construction Co., Ltd.'
 where name = 'Prestion Construction Co., Ltd.';

update public.suppliers
   set name = 'Preston Construction Co., Ltd.'
 where name = 'Prestion Construction Co., Ltd.'
   and id in (select id from public.equipment_owners);

do $$
declare
  v_id uuid;
  v_creator uuid;
begin
  -- created_by is NOT NULL and FKs to public.users, and a migration has no auth
  -- context — inherit the existing registry curator rather than invent an id.
  -- Read unconditionally: the suppliers mirror below needs it on BOTH paths.
  select created_by into v_creator from public.equipment_owners
   order by created_at limit 1;
  if v_creator is null then
    raise exception 'no existing equipment_owners row to inherit created_by from';
  end if;

  -- Idempotent by name: this migration must be safe to replay on a fresh
  -- full-history apply, where PRI may already exist from a prior run.
  select id into v_id from public.equipment_owners
   where name = 'Preston International Co., Ltd.';

  if v_id is null then
    v_id := gen_random_uuid();
    -- Inserted UNFLAGGED on purpose: the partial unique index refuses a second
    -- true, so the flag is moved only after the incumbent is cleared below.
    insert into public.equipment_owners (id, name, created_by, is_default)
    values (v_id, 'Preston International Co., Ltd.', v_creator, false);
  end if;

  update public.equipment_owners set is_default = false
   where is_default and id <> v_id;

  update public.equipment_owners set is_default = true
   where id = v_id and not is_default;

  -- The spec-275 supplier mirror (see header note 3).
  insert into public.suppliers (id, name, created_by)
  select v_id, 'Preston International Co., Ltd.', v_creator
   where not exists (select 1 from public.suppliers where id = v_id);
end
$$;
