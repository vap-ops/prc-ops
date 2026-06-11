-- Spec 23 / ADR 0028 — purchase_request_attachments: the spec-16 §4
-- locked architecture (append-only + tombstone removal per ADR
-- 0004/0009/0015, token side table for the future AppSheet bridge,
-- security_invoker current-state view) extended with the `purpose`
-- discriminator and the delivery-confirmation INSERT branch.
--
-- Implementation hazards honored from the spec-16 adversarial passes:
--   • Outer-row references inside self-referential policy subqueries are
--     table-qualified (SQL name capture silently rewrites unqualified
--     ones against the subquery alias).
--   • Supabase default privileges grant ALL on new tables/views to
--     anon/authenticated — every object below opens revoke-all-first.
--   • Append-only is triple-enforced (revoked privileges, no
--     UPDATE/DELETE policies, BEFORE trigger raising P0001 incl.
--     TRUNCATE — audit_log precedent).

-- 1. Enums.
create type public.purchase_request_attachment_kind as enum ('image', 'link');
create type public.purchase_request_attachment_purpose as enum
  ('reference', 'delivery_confirmation');

-- 2. The attachments table (spec 16 §4 shape + purpose).
create table public.purchase_request_attachments (
  id                  uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  kind                public.purchase_request_attachment_kind not null,
  purpose             public.purchase_request_attachment_purpose not null default 'reference',
  storage_path        text,   -- image content rows only; canonical, server-built
  url                 text,   -- link content rows only
  superseded_by       uuid,   -- tombstone rows only (ADR 0015); composite FK below
  created_by          uuid not null references public.users(id),
  created_at          timestamptz not null default now(),
  -- Tombstones carry no payload; content rows carry exactly one payload per kind.
  constraint pra_tombstone_shape check (superseded_by is null or (storage_path is null and url is null)),
  constraint pra_image_shape check (kind <> 'image' or superseded_by is not null or (storage_path is not null and length(trim(storage_path)) > 0 and url is null)),
  constraint pra_link_shape  check (kind <> 'link'  or superseded_by is not null or (url is not null and storage_path is null)),
  constraint pra_url_shape   check (url is null or (url ~* '^https?://' and length(url) <= 2048)),
  -- ADR 0028: receipt evidence is always an image.
  constraint pra_purpose_kind check (purpose <> 'delivery_confirmation' or kind = 'image'),
  -- Same-parent + same-kind tombstoning is a DB invariant, not app courtesy:
  constraint pra_identity_uniq unique (id, purchase_request_id, kind),
  constraint pra_supersede_fk foreign key (superseded_by, purchase_request_id, kind)
    references public.purchase_request_attachments (id, purchase_request_id, kind)
);

create index purchase_request_attachments_pr_idx
  on public.purchase_request_attachments (purchase_request_id);
-- One tombstone per target; also the ADR 0009 anti-join index.
create unique index purchase_request_attachments_supersede_uniq
  on public.purchase_request_attachments (superseded_by)
  where superseded_by is not null;

-- 3. Capability-token side table (mutable by service role only — token
--    rotation must never violate append-only; spec 16 §4).
create table public.purchase_request_attachment_tokens (
  attachment_id uuid primary key references public.purchase_request_attachments(id) on delete cascade,
  access_token  uuid not null default gen_random_uuid(),
  rotated_at    timestamptz
);

-- Token rows are created for image CONTENT rows only (links need no
-- token; tombstones never get one). Purpose-blind by design (ADR 0028).
create function public.purchase_request_attachments_create_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'image' and new.superseded_by is null then
    insert into public.purchase_request_attachment_tokens (attachment_id)
    values (new.id);
  end if;
  return new;
end;
$$;

create trigger purchase_request_attachments_create_token
  after insert on public.purchase_request_attachments
  for each row
  execute function public.purchase_request_attachments_create_token();

-- 4. Append-only block-write trigger (layer 3 of 3).
create function public.purchase_request_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'purchase_request_attachments is append-only: % is not allowed (supersede via INSERT instead)',
    tg_op
    using errcode = 'P0001';
end;
$$;

create trigger purchase_request_attachments_block_update_delete
  before update or delete on public.purchase_request_attachments
  for each row execute function public.purchase_request_attachments_block_write();

create trigger purchase_request_attachments_block_truncate
  before truncate on public.purchase_request_attachments
  for each statement execute function public.purchase_request_attachments_block_write();

-- 5. RLS + grants — revoke-all-first (platform default privileges).
alter table public.purchase_request_attachments enable row level security;
alter table public.purchase_request_attachment_tokens enable row level security;

revoke all on public.purchase_request_attachments from anon, authenticated;
revoke all on public.purchase_request_attachment_tokens from anon, authenticated;

grant select on public.purchase_request_attachments to authenticated;
grant insert (id, purchase_request_id, kind, purpose, storage_path, url, superseded_by, created_by)
  on public.purchase_request_attachments to authenticated;
-- No UPDATE/DELETE grants anywhere (layer 1 of 3). Tokens: NOTHING for
-- browser principals — they can never read a capability token.

-- 6. Policies.
-- Visibility mirrors purchase_requests exactly (RLS of the parent
-- decides; site-wide for sa/pm/super since ADR 0026).
create policy "select via parent"
  on public.purchase_request_attachments
  for select
  to authenticated
  using (exists (select 1 from public.purchase_requests pr
                 where pr.id = purchase_request_id));

-- INSERT: two branches (ADR 0028).
--   Branch 1 (spec 16 locked): requester's reference attachments while
--   the parent is still pending; tombstones target content rows of the
--   SAME parent (composite FK + partial unique index complete the
--   enforcement). Outer references inside the self-referential subquery
--   are table-qualified — name-capture hazard.
--   Branch 2 (ADR 0028): delivery-confirmation images by any
--   requester-capable staff member on a delivered parent; tombstone
--   removal creator-only via the same shape.
create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and (
      (
        purpose = 'reference'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.requested_by = auth.uid()
                      and pr.status = 'requested')
      )
      or
      (
        purpose = 'delivery_confirmation'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.status = 'delivered')
      )
    )
    and (superseded_by is null
         or exists (select 1 from public.purchase_request_attachments target
                    where target.id = purchase_request_attachments.superseded_by
                      and target.purchase_request_id = purchase_request_attachments.purchase_request_id
                      and target.superseded_by is null
                      and (target.purpose <> 'delivery_confirmation'
                           or target.created_by = auth.uid())))
  );

-- 7. Current-state view (ADR 0009/0015: content rows + anti-join;
--    security_invoker so base RLS applies to the querying role).
create view public.purchase_request_attachments_current
  with (security_invoker = true) as
  select a.id, a.purchase_request_id, a.kind, a.purpose, a.storage_path, a.url,
         a.created_by, a.created_at
  from public.purchase_request_attachments a
  where a.superseded_by is null
    and not exists (select 1 from public.purchase_request_attachments t
                    where t.superseded_by = a.id);

revoke all on public.purchase_request_attachments_current from anon, authenticated;
grant select on public.purchase_request_attachments_current to authenticated;
