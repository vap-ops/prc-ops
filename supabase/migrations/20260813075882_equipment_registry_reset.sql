-- ============================================================================
-- BREAK-GLASS PROCEDURE B — destructive, irreversible. `docs/break-glass.md`.
--
-- Operator instruction, verbatim, 2026-07-30: "wipe out all data, they are all
-- wrong" (the /equipment อุปกรณ์ registry), scope confirmed in-session the same
-- day: **the 64 `equipment_items` and their 64 `equipment_movements` ONLY.**
-- Explicitly OUT of scope and untouched: the 9 `equipment_categories`, every
-- `equipment_owners` row, and the 29 `equipment_rental_batches` (those AUTO-POST
-- to the GL — deleting one is a four-layer operation, see the
-- equipment-rental-gl-delete lesson).
--
-- Why this is a migration and not a button: the app has NO delete path for
-- equipment at all — `equipment_items` has no DELETE policy and `authenticated`
-- holds no DELETE grant (verified live). And `equipment_movements` is
-- APPEND-ONLY, enforced by `equipment_movements_no_update_delete` /
-- `_no_truncate` (function `equipment_movements_block_mutation`), which raises
-- P0001 even for the owner — so the FK from movements to items makes the item
-- delete impossible until the trigger is briefly, transactionally disabled.
-- That bypass is what makes this Procedure B rather than an ordinary data fix.
--
-- What is actually lost: location history. Verified live immediately before
-- writing this — `equipment_usage_logs` 0 rows, `equipment_usage_photos` 0 rows,
-- `equipment_items` with a non-null `image_path` 0 rows, and nothing in the GL
-- references an item (only `journal_lines.equipment_owner_id`, which points at
-- an OWNER and survives). All 64 movements are the single `deployed` backfill
-- from spec 368 U1, not field-recorded moves. `audit_log` keeps the 64
-- `equipment_rate_change` rows and every other trail — it is append-only and is
-- not touched here.
--
-- Floors (break-glass.md §Procedure B): Floor 1 `pg_dump` is OPERATOR-RUN and
-- owed before this is applied — it needs the DB password, which must never
-- appear in a Claude Code prompt. Floor 2 rehearsal is a rollback-wrapped dry
-- run against prod (a with-data preview clone fails on this project; see the
-- supabase-preview-branch-testing note) and its output belongs in the PR.
-- Floor 3 is this file: one migration, reviewed PR, operator merge, then push.
-- ============================================================================

do $$
declare
  v_items int;
  v_movements int;
  v_usage int;
begin
  select count(*) into v_items from public.equipment_items;
  select count(*) into v_movements from public.equipment_movements;
  select count(*) into v_usage from public.equipment_usage_logs;

  -- A borrow recorded between authoring and apply is REAL field history and was
  -- never in scope. The FK would refuse the delete anyway (23503); this turns
  -- that into a message that names the reason instead of a constraint name. The
  -- scan door is live and an SA can create one of these at any moment, so this
  -- is a live race, not a theoretical one.
  if v_usage > 0 then
    raise exception
      'equipment_usage_logs has % row(s) — borrow history exists that the 2026-07-30 reset was not authorised to delete. Re-confirm the scope with the operator before re-running.',
      v_usage;
  end if;

  -- The audit row goes in BEFORE the deletes, so the counts it records are the
  -- ones that were actually there. audit_log is append-only and survives.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    null, null, 'other', 'equipment_items', null,
    jsonb_build_object(
      'event', 'equipment_registry_reset',
      'procedure', 'break-glass B',
      'authorised_by', 'operator, in-session instruction 2026-07-30',
      'migration', '20260813075882_equipment_registry_reset',
      'items_deleted', v_items,
      'movements_deleted', v_movements,
      'scope_excluded', jsonb_build_array(
        'equipment_categories', 'equipment_owners', 'equipment_rental_batches'
      )
    )
  );

  -- The append-only bypass, as narrow as it goes: one trigger, one statement,
  -- re-enabled in the same transaction. If anything below raises, the whole
  -- migration rolls back and the trigger comes back with it.
  alter table public.equipment_movements disable trigger equipment_movements_no_update_delete;
  delete from public.equipment_movements;
  alter table public.equipment_movements enable trigger equipment_movements_no_update_delete;

  delete from public.equipment_items;

  raise notice 'equipment registry reset: % items, % movements deleted', v_items, v_movements;
end
$$;

-- Belt-and-braces: prove the trigger is armed again before this file is allowed
-- to commit. A disabled append-only guard left behind would be a far worse
-- outcome than the delete itself.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.equipment_movements'::regclass
       and tgname = 'equipment_movements_no_update_delete'
       and tgenabled <> 'D'
  ) then
    raise exception 'equipment_movements_no_update_delete is still disabled — refusing to commit';
  end if;
end
$$;
