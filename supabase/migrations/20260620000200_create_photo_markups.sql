-- Spec 51 — photo_markups: drawing + comments overlaid on WP photos.
--
-- Markup is OVERLAY DATA (normalized stroke polylines + a comment),
-- never a modified photo — the Storage object stays untouched
-- (CLAUDE.md photo-immutability doctrine; render-at-view like the
-- watermark posture in ADR 0003).
--
-- Append-only with tombstone removal per ADR 0004/0009/0015, shaped on
-- purchase_request_attachments (20260614100000):
--   • content row = at least one payload (strokes/comment), supersedes
--     nothing; tombstone = no payload + superseded_by set. No atomic
--     replacement — editing is remove + redraw.
--   • triple enforcement: revoke-all-first + column-scoped INSERT,
--     zero UPDATE/DELETE policies, BEFORE trigger raising P0001.
--   • same-parent tombstoning is a DB invariant (composite FK), one
--     tombstone per target (partial unique index = the ADR 0009
--     anti-join index).
--   • outer-row references in the self-referential INSERT policy
--     subquery are table-qualified (name-capture hazard).

create table public.photo_markups (
  id            uuid primary key default gen_random_uuid(),
  photo_log_id  uuid not null references public.photo_logs(id) on delete cascade,
  strokes       jsonb,  -- content rows: array of {points:[[x,y],…]}, coords normalized 0..1
  comment       text,   -- content rows: reviewer note
  superseded_by uuid,   -- tombstone rows only; composite FK below
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  -- ADR 0015 well-formedness: content row (>=1 payload, supersedes
  -- nothing) XOR tombstone (no payload, supersedes something).
  constraint photo_markups_tombstone_shape
    check ((strokes is null and comment is null) = (superseded_by is not null)),
  constraint photo_markups_comment_len
    check (comment is null or length(comment) <= 1000),
  constraint photo_markups_strokes_is_array
    check (strokes is null or jsonb_typeof(strokes) = 'array'),
  constraint photo_markups_identity_uniq unique (id, photo_log_id),
  constraint photo_markups_supersede_fk foreign key (superseded_by, photo_log_id)
    references public.photo_markups (id, photo_log_id)
);

create index photo_markups_photo_idx on public.photo_markups (photo_log_id);
-- One tombstone per target; also the ADR 0009 anti-join index.
create unique index photo_markups_supersede_uniq
  on public.photo_markups (superseded_by)
  where superseded_by is not null;

-- Append-only layer 3: trigger raises on every UPDATE/DELETE/TRUNCATE
-- (catches the service-role path that bypasses privileges and RLS).
create function public.photo_markups_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'photo_markups is append-only: % is not allowed (supersede via INSERT instead)',
    tg_op
    using errcode = 'P0001';
end;
$$;

create trigger photo_markups_block_update_delete
  before update or delete on public.photo_markups
  for each row execute function public.photo_markups_block_write();

create trigger photo_markups_block_truncate
  before truncate on public.photo_markups
  for each statement execute function public.photo_markups_block_write();

-- RLS + grants — revoke-all-first (platform default privileges).
alter table public.photo_markups enable row level security;
revoke all on public.photo_markups from anon, authenticated;

grant select on public.photo_markups to authenticated;
grant insert (id, photo_log_id, strokes, comment, superseded_by, created_by)
  on public.photo_markups to authenticated;
-- No UPDATE/DELETE grants anywhere (layer 1).

-- Visibility mirrors photo_logs (role-level per ADR 0013, via the ADR
-- 0011 helper — never self-joining public.users).
create policy "photo_markups readable by privileged roles"
  on public.photo_markups for select
  to authenticated
  using (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
  );

-- INSERT: content rows by any photo-reading role on a readable parent
-- photo; tombstones target the caller's OWN content rows of the SAME
-- parent (composite FK completes the same-parent half; creator-pin is
-- policy). Outer references table-qualified.
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and exists (select 1 from public.photo_logs pl
                where pl.id = photo_log_id)
    and (superseded_by is null
         or exists (select 1 from public.photo_markups target
                    where target.id = photo_markups.superseded_by
                      and target.photo_log_id = photo_markups.photo_log_id
                      and target.superseded_by is null
                      and target.created_by = auth.uid()))
  );

-- Current-state view (ADR 0009/0015: content rows + anti-join;
-- security_invoker so base RLS applies to the querying role).
create view public.photo_markups_current
  with (security_invoker = true) as
  select m.id, m.photo_log_id, m.strokes, m.comment, m.created_by, m.created_at
  from public.photo_markups m
  where m.superseded_by is null
    and not exists (select 1 from public.photo_markups t
                    where t.superseded_by = m.id);

revoke all on public.photo_markups_current from anon, authenticated;
grant select on public.photo_markups_current to authenticated;
