-- Spec 377 U1 — WP brief (ข้อมูลงาน): draft head + criteria/slots + immutable
-- versions + typed tombstone attachments + the attachment-type registry (ADR 0086).
--
-- Shape decisions (all in ADR 0086 / spec 377 §4.1):
--   * The brief is a DERIVED view — drawings govern; sheet_code/sheet_rev are
--     plain citation pins now, a drawings-register FK is a U4 seam.
--   * Published versions are IMMUTABLE and the version row IS the publish event
--     (append-only + published_by NOT NULL) — deliberately NOT an `approvals`
--     row (ADR 0086 §4: decision enum, notify trigger, latest-decision readers).
--   * Attachment types are a spec-331-style REGISTRY, not an enum — deactivate
--     is the per-type operator dial (3D types are EXPERIMENTAL; the off-ladder
--     is dial-off, nothing to rip out).
--   * Briefs bind to LEAF WPs only (wp_reject_group_binding, ADR 0074).
--   * Read model mirrors `work_packages readable by privileged roles` VERBATIM:
--     procurement tiers unconditional OR can_see_wp — bare can_see_wp would
--     hide briefs from plain procurement, who can open WP detail (spec 377 §4.1).
--   * wp_briefs.display_config = the PD display-selection seam (operator ruling
--     2026-07-30: PD selects which information types render on the WP page).
--   * Writes are RPC-only everywhere; U2 ships the authoring RPCs. This unit
--     ships only the registry dial RPC so U4's toggle needs no migration.
--
-- ADDITIVE ONLY — no existing object is touched.

-- 1. Attachment-type registry ───────────────────────────────────────────────────
create table public.wp_brief_attachment_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_th     text not null,
  name_en     text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wp_brief_attachment_types_name_th_not_blank check (length(btrim(name_th)) > 0),
  constraint wp_brief_attachment_types_text_bounds check (
    length(code) <= 40
    and length(name_th) <= 200
    and (name_en is null or length(name_en) <= 200)
  )
);

create trigger wp_brief_attachment_types_set_updated_at
  before update on public.wp_brief_attachment_types
  for each row execute function public.set_updated_at();

alter table public.wp_brief_attachment_types enable row level security;
revoke all on public.wp_brief_attachment_types from anon, authenticated;
grant select on public.wp_brief_attachment_types to authenticated;
create policy "wp_brief_attachment_types readable by authenticated"
  on public.wp_brief_attachment_types for select to authenticated
  using (true);

comment on table public.wp_brief_attachment_types is
  'Spec 377 / ADR 0086 — typed registry for WP-brief reference attachments. is_active = the per-type operator dial (a deactivated type leaves the attach picker; existing attachments keep rendering). iso_render/model_3d are EXPERIMENTAL (kill condition in spec 377 §2 item 11).';

insert into public.wp_brief_attachment_types (code, name_th, name_en, sort_order) values
  ('sheet_crop',   'ภาพตัดจากแบบ',                    'Sheet crop',           1),
  ('iso_render',   'ภาพ 3D ไอโซเมตริก (อ้างอิงเท่านั้น)', '3D ISO render',        2),
  ('model_3d',     'ไฟล์โมเดล 3D (GLB)',              '3D model file',        3),
  ('bar_schedule', 'ใบดัดเหล็ก',                       'Bar-bending schedule', 4),
  ('other',        'อื่น ๆ',                           'Other',                5);

-- The dial RPC (spec-331 shape verbatim; the U4 toggle UI calls this).
create function public.set_wp_brief_attachment_type_active(
  p_code      text,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'set_wp_brief_attachment_type_active: role not permitted' using errcode = '42501';
  end if;
  update public.wp_brief_attachment_types
     set is_active = coalesce(p_is_active, true)
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'set_wp_brief_attachment_type_active: unknown code' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_wp_brief_attachment_type_active(text, boolean) from public, anon;
grant execute on function public.set_wp_brief_attachment_type_active(text, boolean) to authenticated;

-- 2. Draft head — one mutable working copy per leaf WP ──────────────────────────
create table public.wp_briefs (
  id              uuid primary key default gen_random_uuid(),
  work_package_id uuid not null unique references public.work_packages (id),
  scope_included  text,
  scope_excluded  text,
  quantity        text,
  location        text,
  sheet_code      text,
  sheet_rev       text,
  display_config  jsonb,
  updated_by      uuid references public.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wp_briefs_text_bounds check (
    (scope_included is null or length(scope_included) <= 2000)
    and (scope_excluded is null or length(scope_excluded) <= 2000)
    and (quantity is null or length(quantity) <= 300)
    and (location is null or length(location) <= 300)
    and (sheet_code is null or length(sheet_code) <= 60)
    and (sheet_rev is null or length(sheet_rev) <= 30)
  )
);

create trigger wp_briefs_set_updated_at
  before update on public.wp_briefs
  for each row execute function public.set_updated_at();

-- Leaf-only (ADR 0074): the shared guard raises 23514 on a group WP.
create trigger wp_briefs_reject_group_wp
  before insert or update on public.wp_briefs
  for each row execute function public.wp_reject_group_binding('work_package_id');

alter table public.wp_briefs enable row level security;
revoke all on public.wp_briefs from anon, authenticated;
grant select on public.wp_briefs to authenticated;
create policy "wp_briefs readable by wp readers"
  on public.wp_briefs for select to authenticated
  using (
    (select public.current_user_role())
      = any (array['procurement'::user_role, 'procurement_manager'::user_role])
    or (select public.can_see_wp(work_package_id))
  );

comment on table public.wp_briefs is
  'Spec 377 — the mutable DRAFT head of a WP brief (ข้อมูลงาน), one per leaf WP. The SA never reads this; they read the latest wp_brief_versions row. Writes RPC-only (U2). display_config = PD''s per-brief selection of which information types render on the WP page (operator ruling 2026-07-30); carried into the version snapshot at publish.';
comment on column public.wp_briefs.sheet_code is
  'Spec 377 — citation pin: the drawing sheet this brief''s numbers derive from. Plain text now; FKs into the U4 drawings register later. Drawings govern — the brief is a derived view (ADR 0086 §1).';

-- 3. Criteria + evidence slots (draft children) ────────────────────────────────
create table public.wp_brief_criteria (
  id         uuid primary key default gen_random_uuid(),
  brief_id   uuid not null references public.wp_briefs (id) on delete cascade,
  body       text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint wp_brief_criteria_body_bounds check (length(btrim(body)) between 1 and 500)
);
create index wp_brief_criteria_brief_idx on public.wp_brief_criteria (brief_id);

create table public.wp_brief_evidence_slots (
  id           uuid primary key default gen_random_uuid(),
  brief_id     uuid not null references public.wp_briefs (id) on delete cascade,
  label        text not null,
  criterion_id uuid references public.wp_brief_criteria (id) on delete set null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  constraint wp_brief_evidence_slots_label_bounds check (length(btrim(label)) between 1 and 200)
);
create index wp_brief_evidence_slots_brief_idx on public.wp_brief_evidence_slots (brief_id);

-- A slot may only map a criterion of its OWN brief.
create function public.wp_brief_slot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.criterion_id is not null
     and not exists (
       select 1 from public.wp_brief_criteria c
        where c.id = new.criterion_id and c.brief_id = new.brief_id
     ) then
    raise exception 'wp_brief_evidence_slots: criterion belongs to another brief'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger wp_brief_evidence_slots_guard
  before insert or update on public.wp_brief_evidence_slots
  for each row execute function public.wp_brief_slot_guard();

alter table public.wp_brief_criteria enable row level security;
alter table public.wp_brief_evidence_slots enable row level security;
revoke all on public.wp_brief_criteria from anon, authenticated;
revoke all on public.wp_brief_evidence_slots from anon, authenticated;
grant select on public.wp_brief_criteria to authenticated;
grant select on public.wp_brief_evidence_slots to authenticated;
create policy "wp_brief_criteria readable by wp readers"
  on public.wp_brief_criteria for select to authenticated
  using (
    exists (
      select 1 from public.wp_briefs b
       where b.id = brief_id
         and (
           (select public.current_user_role())
             = any (array['procurement'::user_role, 'procurement_manager'::user_role])
           or public.can_see_wp(b.work_package_id)
         )
    )
  );
create policy "wp_brief_evidence_slots readable by wp readers"
  on public.wp_brief_evidence_slots for select to authenticated
  using (
    exists (
      select 1 from public.wp_briefs b
       where b.id = brief_id
         and (
           (select public.current_user_role())
             = any (array['procurement'::user_role, 'procurement_manager'::user_role])
           or public.can_see_wp(b.work_package_id)
         )
    )
  );

comment on table public.wp_brief_criteria is
  'Spec 377 — binary acceptance criteria of the DRAFT brief. Snapshotted into wp_brief_versions.content at publish; the published copy never drifts.';
comment on table public.wp_brief_evidence_slots is
  'Spec 377 — required photo slots of the DRAFT brief, each optionally proving one criterion. Slot-level mapping only in v1 (per-photo binding is out — spec 377 §7).';

-- 4. Immutable published versions — the publish event ──────────────────────────
create table public.wp_brief_versions (
  id              uuid primary key default gen_random_uuid(),
  work_package_id uuid not null references public.work_packages (id),
  version         int not null check (version > 0),
  content         jsonb not null,
  published_by    uuid not null references public.users (id),
  published_at    timestamptz not null default now(),
  constraint wp_brief_versions_wp_version_uniq unique (work_package_id, version)
);
create index wp_brief_versions_wp_idx on public.wp_brief_versions (work_package_id, version desc);

create function public.wp_brief_versions_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wp_brief_versions is append-only'
    using errcode = 'P0001';
end;
$$;
create trigger wp_brief_versions_block_update
  before update on public.wp_brief_versions
  for each row execute function public.wp_brief_versions_block_write();
create trigger wp_brief_versions_block_delete
  before delete on public.wp_brief_versions
  for each row execute function public.wp_brief_versions_block_write();
create trigger wp_brief_versions_block_truncate
  before truncate on public.wp_brief_versions
  for each statement execute function public.wp_brief_versions_block_write();

create trigger wp_brief_versions_reject_group_wp
  before insert or update on public.wp_brief_versions
  for each row execute function public.wp_reject_group_binding('work_package_id');

alter table public.wp_brief_versions enable row level security;
revoke all on public.wp_brief_versions from anon, authenticated;
grant select on public.wp_brief_versions to authenticated;
create policy "wp_brief_versions readable by wp readers"
  on public.wp_brief_versions for select to authenticated
  using (
    (select public.current_user_role())
      = any (array['procurement'::user_role, 'procurement_manager'::user_role])
    or (select public.can_see_wp(work_package_id))
  );

comment on table public.wp_brief_versions is
  'Spec 377 / ADR 0086 §4 — IMMUTABLE published brief snapshots. The version row IS the attributable append-only publish event (published_by/published_at; the publish RPC runs under the user session, spec-337 U1 attribution lesson). Deliberately NOT an approvals row. content = the full jsonb snapshot (scope/quantity/location/citations/criteria/slots/display_config/attachment ids) — pgTAP-provably frozen because the whole table is append-only.';

-- 5. Typed reference attachments — ADR 0015 tombstone shape ────────────────────
create table public.wp_brief_attachments (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid not null references public.wp_briefs (id),
  type_id       uuid not null references public.wp_brief_attachment_types (id),
  caption       text,
  sheet_code    text,
  sheet_rev     text,
  storage_path  text,
  superseded_by uuid references public.wp_brief_attachments (id),
  created_by    uuid not null references public.users (id),
  created_at    timestamptz not null default now(),
  constraint wp_brief_attachments_well_formed check (
    (storage_path is null) = (superseded_by is not null)
  ),
  constraint wp_brief_attachments_text_bounds check (
    (caption is null or length(caption) <= 300)
    and (sheet_code is null or length(sheet_code) <= 60)
    and (sheet_rev is null or length(sheet_rev) <= 30)
    and (storage_path is null or length(btrim(storage_path)) between 1 and 400)
  )
);
create index wp_brief_attachments_brief_idx on public.wp_brief_attachments (brief_id);
create index wp_brief_attachments_superseded_by_idx
  on public.wp_brief_attachments (superseded_by)
  where superseded_by is not null;

create function public.wp_brief_attachments_block_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wp_brief_attachments is append-only'
    using errcode = 'P0001';
end;
$$;
create trigger wp_brief_attachments_block_update
  before update on public.wp_brief_attachments
  for each row execute function public.wp_brief_attachments_block_write();
create trigger wp_brief_attachments_block_delete
  before delete on public.wp_brief_attachments
  for each row execute function public.wp_brief_attachments_block_write();
create trigger wp_brief_attachments_block_truncate
  before truncate on public.wp_brief_attachments
  for each statement execute function public.wp_brief_attachments_block_write();

alter table public.wp_brief_attachments enable row level security;
revoke all on public.wp_brief_attachments from anon, authenticated;
grant select on public.wp_brief_attachments to authenticated;
create policy "wp_brief_attachments readable by wp readers"
  on public.wp_brief_attachments for select to authenticated
  using (
    exists (
      select 1 from public.wp_briefs b
       where b.id = brief_id
         and (
           (select public.current_user_role())
             = any (array['procurement'::user_role, 'procurement_manager'::user_role])
           or public.can_see_wp(b.work_package_id)
         )
    )
  );

comment on table public.wp_brief_attachments is
  'Spec 377 / ADR 0086 — typed reference attachments of a brief (append-only, ADR-0015 tombstone supersede: content row = storage_path set; tombstone = path NULL + superseded_by). type_id → the registry; sheet_code/sheet_rev pin a sheet_crop''s source. Canonical formats: images PNG/JPEG/PDF, 3D = GLB + ISO PNG set (files are the engine port — no generation API, ADR 0086 §3). Bucket + upload path land in U4.';
