-- Spec 72 — project notes (backup capture). The "notes everywhere" rollout:
-- projects get the same editable free-text note as work_packages (spec 71).
--
-- projects UPDATE stays super_admin-only (ADR 0013); update_project_settings
-- is the column-scoped pm/super escape hatch (spec 58 / ADR 0042). Rather
-- than a new RPC, extend that one with p_notes — it already owns the
-- name/status column-scoped write. The note is folded into the settings
-- form's single batched save.

alter table public.projects
  add column notes text,
  add constraint projects_notes_len
    check (notes is null or length(notes) <= 2000);

-- Replace the 3-arg RPC with a 4-arg version. CREATE OR REPLACE cannot add a
-- parameter (that's a new signature), so DROP then CREATE. p_notes defaults
-- null with COALESCE-PRESERVE semantics: a 3-arg-shaped call (p_notes null)
-- leaves notes untouched; an explicit '' clears it; text sets it. This keeps
-- any name/status-only write from silently wiping the note.
drop function public.update_project_settings(uuid, text, public.project_status);

create function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_status public.project_status,
  p_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'update_project_settings: role not permitted'
      using errcode = '42501';
  end if;

  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'update_project_settings: invalid name'
      using errcode = '22023';
  end if;

  update public.projects
     set name = v_name,
         status = p_status,
         notes = case
                   when p_notes is null then notes
                   else nullif(btrim(p_notes), '')
                 end
   where id = p_project_id;
  return found;
end;
$$;

revoke all on function
  public.update_project_settings(uuid, text, public.project_status, text)
  from public, anon;
grant execute on function
  public.update_project_settings(uuid, text, public.project_status, text)
  to authenticated;
