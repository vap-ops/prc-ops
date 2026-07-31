-- Spec 385 U1 — ทะเบียนเครื่องมือ/เครื่องจักร as a SKU catalog.
--
-- Operator 2026-07-31 (verbatim): "เครื่องตบดิน is supposed to be only 1 in
-- ทะเบียน, as in SKU. then user can pick from ทะเบียน when they want to add new
-- equipments." Keyword `catalog` is the operator's, for consistency with
-- catalog_items (materials) and the planned rental_catalog_items (spec 361).
--
-- Model: equipment_catalog_items = one row per SKU (ทะเบียน); equipment_items
-- stays the INSTANCE table (physical units, QR, photos, movements, borrow) and
-- gains a nullable FK to the SKU it instantiates. Instances are born from picks
-- once the U2 flow ships; the registry is at 0 instance rows today by operator
-- direction ("do not seed the equipment items, only SKUs").
--
-- §0 also folds the same-day ad-hoc category ops into the artifact of record
-- (change-management §1) — idempotent on prod, effective on fresh replays.

-- ============================================================================
-- §0 categories: the function-first principle set (idempotent reconciliation)
-- ============================================================================
update public.equipment_categories set name = 'เครื่องมือเจาะและสกัด' where name = 'เครื่องมือเจาะ';
update public.equipment_categories set name = 'อุปกรณ์เซฟตี้'        where name = 'Safety';

-- Every category §5 references, insert-if-missing (renamed forms for the legacy
-- seven), so the SKU seed can never 23503 on a replay that has the dev-preview
-- user but not the legacy category rows.
insert into public.equipment_categories (id, name, created_by)
select v.id::uuid, v.name, '2c741de8-1e38-4806-a13d-1d9c541072de'
from (values
  ('c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', 'เครื่องมือตัดและเจียร'),
  ('c2b8f3e5-6c40-4d9b-8f32-5a1b7c8d9e02', 'เครื่องมือเชื่อมและยึด'),
  ('c3c9a4f6-7d51-4eac-af43-6b2c8d9eaf03', 'เครื่องมืองานปูน'),
  ('c4dab5a7-8e62-4fbd-b054-7c3d9eafb004', 'เครื่องมือลม'),
  ('52f533c0-c7b5-46a3-bd76-97bca2eb6e8d', 'เครื่องมือเจาะและสกัด'),
  ('715f0665-4651-479d-9c61-ea4df62a085c', 'เครื่องวัด'),
  ('ac49d5cf-06f7-4e43-963d-58d36763f429', 'เครื่องจักรก่อสร้าง'),
  ('cf353c1e-222a-4097-a55f-ecbe0c7f5127', 'เครื่องสูบน้ำและอุปกรณ์ระบายน้ำ'),
  ('8d24183e-8d05-4452-91c5-2f953d9ecf70', 'เครื่องมือช่างทั่วไป'),
  ('43f75f1a-a475-4791-a800-b0c0bc73152a', 'อุปกรณ์เซฟตี้'),
  ('8c80bc8f-7407-4912-ab23-1898b98580a4', 'เครื่องเทส')
) v(id, name)
where exists (select 1 from public.users u where u.id = '2c741de8-1e38-4806-a13d-1d9c541072de')
  and not exists (select 1 from public.equipment_categories c where c.id = v.id::uuid);

-- ============================================================================
-- §1 the SKU table
-- ============================================================================
create table public.equipment_catalog_items (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  category_id        uuid not null references public.equipment_categories(id),
  brand              text,
  model              text,
  default_tracking   public.equipment_tracking not null default 'unit',
  default_daily_rate numeric(12,2),
  description        text,
  is_active          boolean not null default true,
  created_by         uuid not null references public.users(id),
  created_at         timestamptz not null default now(),
  constraint equipment_catalog_items_name_nonblank check (length(trim(name)) > 0),
  constraint equipment_catalog_items_name_cap      check (length(name) <= 120),
  constraint equipment_catalog_items_rate_nonneg
    check (default_daily_rate is null or default_daily_rate >= 0)
);

comment on table public.equipment_catalog_items is
  'Spec 385: ทะเบียนเครื่องมือ/เครื่องจักร — one row per SKU/type. Physical units live in equipment_items and are created by picking from this catalog.';

-- duplicate-name protection at birth (the spec-344 disease, prevented):
-- unique among ACTIVE SKUs on the normalized name.
create unique index equipment_catalog_items_active_name_key
  on public.equipment_catalog_items (lower(trim(name))) where is_active;

-- ============================================================================
-- §2 the instance table gains its SKU pointer
-- ============================================================================
alter table public.equipment_items
  add column equipment_catalog_item_id uuid references public.equipment_catalog_items(id);

comment on column public.equipment_items.equipment_catalog_item_id is
  'Spec 385: the SKU this unit instantiates. Nullable during transition; the pick-from-catalog add flow (U2) sets it.';

-- the catalog→instances lookup U2/U3 live on (sibling FKs all carry one)
create index equipment_items_catalog_item_idx
  on public.equipment_items (equipment_catalog_item_id);

-- ============================================================================
-- §3 RLS — write side DELEGATES to is_back_office (the storage-RLS lesson:
-- never restate a role list a helper already owns); read side = the helper's
-- audience plus site_admin, mirroring "equipment_items readable by staff".
-- ============================================================================
alter table public.equipment_catalog_items enable row level security;

create policy "equipment_catalog_items readable by staff"
  on public.equipment_catalog_items for select
  to authenticated
  using (
    public.is_back_office((select public.current_user_role()))
    or (select public.current_user_role()) = 'site_admin'::public.user_role
  );

create policy "equipment_catalog_items insert by back office"
  on public.equipment_catalog_items for insert
  to authenticated
  with check (
    public.is_back_office((select public.current_user_role()))
    and created_by = (select auth.uid())
  );

create policy "equipment_catalog_items update by back office"
  on public.equipment_catalog_items for update
  to authenticated
  using (public.is_back_office((select public.current_user_role())))
  with check (public.is_back_office((select public.current_user_role())));

-- ============================================================================
-- §4 grants — money wall = COLUMN ABSENCE (default_daily_rate granted to no
-- API role, mirroring equipment_items.daily_rate / ADR 0055 decision 6).
-- ============================================================================
revoke all on table public.equipment_catalog_items from public, anon, authenticated;

grant select (id, name, category_id, brand, model, default_tracking, description, is_active, created_by, created_at)
  on public.equipment_catalog_items to authenticated;
grant insert (id, name, category_id, brand, model, default_tracking, description, is_active, created_by)
  on public.equipment_catalog_items to authenticated;
grant update (name, category_id, brand, model, default_tracking, description, is_active)
  on public.equipment_catalog_items to authenticated;

-- the new instance column is invisible until granted (equipment_items is
-- column-granted — the worker_level_rates precedent):
grant select (equipment_catalog_item_id) on public.equipment_items to authenticated;
grant insert (equipment_catalog_item_id) on public.equipment_items to authenticated;
grant update (equipment_catalog_item_id) on public.equipment_items to authenticated;

-- ============================================================================
-- §5 seed — 39 SKUs from the operator's 2-branch tool sheet (2026-07-31).
-- Includes มี-0 types (ปลั๊กพ่วง): a SKU is what CAN be owned/picked, not what
-- is currently held. Rates = the operator-approved estimate scale (2026-07-28);
-- guarded on the dev-preview user so schema-only replays (preview branches,
-- empty users table) skip the seed instead of failing the FK.
-- ============================================================================
insert into public.equipment_catalog_items
  (name, category_id, brand, model, default_tracking, default_daily_rate, created_by)
select v.name, v.category_id::uuid, v.brand, v.model,
       v.default_tracking::public.equipment_tracking, v.rate,
       '2c741de8-1e38-4806-a13d-1d9c541072de'
from (values
  -- เครื่องมือตัดและเจียร (10)
  ('กรรไกรตัดท่อ PVC',                                   'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 20::numeric),
  ('กรรไกรตัดแผ่นโลหะ',                                  'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 20),
  ('กรรไกรตัดเหล็กเส้น (Bolt Cutter)',                    'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 30),
  ('เครื่องเจียรไฟฟ้า ขนาด 4 นิ้ว',                        'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 80),
  ('เครื่องเจียรไฟฟ้า ขนาด 7 นิ้ว',                        'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 100),
  ('เครื่องตัดคอนกรีต (ตัดจ๊อยท์)',                        'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 250),
  ('เครื่องตัดไฟเบอร์',                                   'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 80),
  ('เลื่อยไฟฟ้า',                                        'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 100),
  ('เลื่อยวงเดือน',                                       'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 100),
  ('ชุดตัดแก๊ส',                                         'c1a7e2d4-5b3f-4c8a-9e21-4f0a6b7c8d01', null,    null,              'unit', 150),
  -- เครื่องมือเจาะและสกัด (3)
  ('สว่านไร้สาย (แบตเตอรี่)',                              '52f533c0-c7b5-46a3-bd76-97bca2eb6e8d', null,    null,              'unit', 100),
  ('สว่านไฟฟ้า 3 ระบบ',                                  '52f533c0-c7b5-46a3-bd76-97bca2eb6e8d', null,    null,              'unit', 120),
  ('เครื่องสกัดไฟฟ้า (เครื่องสกัดคอนกรีต)',                 '52f533c0-c7b5-46a3-bd76-97bca2eb6e8d', null,    null,              'unit', 150),
  -- เครื่องมือเชื่อมและยึด (3)
  ('เครื่องเชื่อมไฟฟ้า',                                  'c2b8f3e5-6c40-4d9b-8f32-5a1b7c8d9e02', null,    null,              'unit', 150),
  ('ปืนยิงรีเวท',                                        'c2b8f3e5-6c40-4d9b-8f32-5a1b7c8d9e02', null,    null,              'unit', 40),
  ('แม่เหล็กจับฉาก',                                      'c2b8f3e5-6c40-4d9b-8f32-5a1b7c8d9e02', null,    null,              'bulk', 10),
  -- เครื่องวัด (7)
  ('ระดับน้ำ',                                           '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 15),
  ('เครื่องวัดระดับเลเซอร์',                               '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 150),
  ('ฉากวัดมุม',                                          '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 10),
  ('ชุดกล้องสำรวจระดับ (Auto Level)',                      '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 200),
  ('เทปวัดระยะ ขนาด 100 เมตร',                            '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 15),
  ('เทปวัดระยะ ขนาด 100/300 เมตร',                        '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'unit', 20),
  ('สายยางวัดระดับน้ำ',                                   '715f0665-4651-479d-9c61-ea4df62a085c', null,    null,              'bulk', 10),
  -- เครื่องมืองานปูน (4)
  ('เครื่องฉาบปูน',                                       'c3c9a4f6-7d51-4eac-af43-6b2c8d9eaf03', null,    null,              'unit', 250),
  ('เครื่องจี้ปูน',                                       'c3c9a4f6-7d51-4eac-af43-6b2c8d9eaf03', null,    null,              'unit', 120),
  ('สามเหลี่ยมปาดปูน (สั้น)',                              'c3c9a4f6-7d51-4eac-af43-6b2c8d9eaf03', null,    null,              'bulk', 10),
  ('สามเหลี่ยมปาดปูน (ยาว)',                              'c3c9a4f6-7d51-4eac-af43-6b2c8d9eaf03', null,    null,              'bulk', 10),
  -- เครื่องจักรก่อสร้าง (2)
  ('เครื่องตบดิน',                                        'ac49d5cf-06f7-4e43-963d-58d36763f429', null,    null,              'unit', 300),
  ('เครื่องดัดเหล็กเส้น ข้ออ้อย 20 มม / เหล็กกลม 25 มม',     'ac49d5cf-06f7-4e43-963d-58d36763f429', 'XYLON', 'Rebar Bender',    'unit', 300),
  -- เครื่องสูบน้ำและอุปกรณ์ระบายน้ำ (2)
  ('ปั้มแบบจุ่ม (ไดโว่)',                                 'cf353c1e-222a-4097-a55f-ecbe0c7f5127', null,    null,              'unit', 100),
  ('เครื่องฉีดน้ำแรงดันสูง 120 บาร์ 1,400 วัตต์',            'cf353c1e-222a-4097-a55f-ecbe0c7f5127', null,    null,              'unit', 120),
  -- เครื่องมือลม (2)
  ('เครื่องเป่าลม',                                       'c4dab5a7-8e62-4fbd-b054-7c3d9eafb004', null,    null,              'unit', 60),
  ('ถังลม',                                              'c4dab5a7-8e62-4fbd-b054-7c3d9eafb004', null,    null,              'unit', 50),
  -- เครื่องมือช่างทั่วไป (4)
  ('ประแจคอม้า',                                         '8d24183e-8d05-4452-91c5-2f953d9ecf70', null,    null,              'unit', 20),
  ('คีมคอม้า',                                           '8d24183e-8d05-4452-91c5-2f953d9ecf70', null,    null,              'unit', 15),
  ('คีมผูกลวด',                                          '8d24183e-8d05-4452-91c5-2f953d9ecf70', null,    null,              'unit', 10),
  ('ปลั๊กพ่วงไฟฟ้า (ทำเอง)',                              '8d24183e-8d05-4452-91c5-2f953d9ecf70', null,    null,              'bulk', 10),
  -- อุปกรณ์เซฟตี้ (1)
  ('เข็มขัดนิรภัยสำหรับงานที่สูง',                          '43f75f1a-a475-4791-a800-b0c0bc73152a', null,    null,              'unit', 30),
  -- เครื่องเทส (1)
  ('เครื่องทดสอบรอยรั่ว',                                 '8c80bc8f-7407-4912-ab23-1898b98580a4', 'ASADA', 'TEST PUMP TP50E', 'unit', 150)
) v(name, category_id, brand, model, default_tracking, rate)
where exists (select 1 from public.users u where u.id = '2c741de8-1e38-4806-a13d-1d9c541072de')
on conflict ((lower(trim(name)))) where is_active do nothing;
