-- Spec 270 U6 (amended) — grouping-mandatory forward guard, per adopted project.
-- The spec's original CHECK+VALIDATE is impossible while legacy projects
-- (PRC-2026-003/005) still hold parentless leaves: even a NOT VALID CHECK fires
-- on their daily status UPDATEs. Equivalent forward guarantee instead: once a
-- project has งาน rows (adopted the two-level model — e.g. PRC-2026-004 after
-- today's import), inserting a parentless งานย่อย is rejected. Legacy projects
-- keep working and adopt the rule the moment their own import creates งาน rows.
-- CREATE OR REPLACE of wp_hierarchy_guard(), body sourced from 072200 + one arm.

create or replace function public.wp_hierarchy_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  par record;
begin
  if tg_op = 'UPDATE' and new.is_group is distinct from old.is_group then
    raise exception 'is_group is immutable (WP %)', new.id using errcode = '23514';
  end if;

  if new.is_group and new.parent_id is not null then
    raise exception 'a group (งาน) cannot have a parent — depth is capped at 2 (WP %)', new.id
      using errcode = '23514';
  end if;

  if new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select id, is_group, project_id into par
      from public.work_packages where id = new.parent_id;
    if found then
      if not par.is_group then
        raise exception 'parent % is a งานย่อย — a parent must be a group (งาน)', new.parent_id
          using errcode = '23514';
      end if;
      if par.project_id <> new.project_id then
        raise exception 'parent % belongs to another project', new.parent_id
          using errcode = '23514';
      end if;
    end if; -- unknown id falls through to the FK error
  end if;

  -- U6 (spec 270 §5, amended): grouping is mandatory FORWARD, per adopted project.
  -- A global VALIDATEd CHECK is impossible while legacy projects still hold
  -- parentless leaves (PRC-2026-003/005 at ship time) — a NOT VALID CHECK would
  -- still fire on their daily status UPDATEs. So: a NEW งานย่อย in a project
  -- that already has งาน rows must arrive with a parent; legacy projects are
  -- untouched until their own grouping import runs.
  if tg_op = 'INSERT' and not new.is_group and new.parent_id is null
     and exists (select 1 from public.work_packages g
                   where g.project_id = new.project_id and g.is_group) then
    raise exception 'a new งานย่อย needs a งาน (parent) in this project — grouping is mandatory'
      using errcode = '23514';
  end if;

  if new.is_group then
    if tg_op = 'INSERT' and new.status <> 'not_started' then
      raise exception 'a group (งาน) must start not_started — its status is derived'
        using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status
       and pg_trigger_depth() < 2 then
      raise exception 'group (งาน) status is derived from its งานย่อย — not hand-editable (WP %)', new.id
        using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.priority is distinct from old.priority then
      raise exception 'group (งาน) priority is not editable (WP %)', new.id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
