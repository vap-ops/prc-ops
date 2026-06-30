-- Spec 239 — ทะเบียนวัสดุ category cleanup (ADR 0066 C1). Supersedes spec 232.
--
-- ADDITIVE + SAFE, NOT break-glass: verified live that 0 of 256 catalog items
-- carry any product_code, so re-homing renumbers nothing (the product-code prefix
-- derives from the category code only on the WRITE path for FUTURE items). No
-- DROP, no deactivation, no destructive ALTER. Categories are REPURPOSED (renamed
-- + items redistributed) rather than deactivated — the truest "reuse codes", and
-- it leaves no dead rows. Reversible by re-UPDATE.
--
-- Operator-approved design (2026-06-30): full re-grain (split steel into
-- structural + fasteners), tools/made-to-order pulled out to facets, merge tanks
-- into plumbing, fold paint, rename safety, a real catch-all, a cladding home for
-- the made-to-order fabrications, + two new optional item columns. Equipment-as-
-- asset stays in its own subsystem (equipment_items); the catalog only flags it
-- via the kind facet. Material axis only — the work-category axis is untouched.

-- ============================================================================
-- 1. Two additive, optional item columns
-- ============================================================================
alter table public.catalog_items add column search_terms text;
alter table public.catalog_items add column lead_time_days int;
alter table public.catalog_items
  add constraint catalog_items_lead_time_nonneg check (lead_time_days is null or lead_time_days >= 0);

comment on column public.catalog_items.search_terms is
  'Spec 239 — optional search synonyms / alternate names (findability; never required).';
comment on column public.catalog_items.lead_time_days is
  'Spec 239 — optional normal days to procure (serves the ordering plan; pairs with made_to_order).';

-- ============================================================================
-- 2. New fasteners category (the steel split''s second half), code 14
-- ============================================================================
insert into public.catalog_categories (code, name, name_en, sort_order, legacy_category)
  values ('14', 'อุปกรณ์ยึด / น็อต สกรู', 'Fasteners', 14, null);

-- ============================================================================
-- 3. Renames (code unchanged) + repurpose of the 4 freed codes (rename only;
--    items redistributed in step 4). All categories stay active.
-- ============================================================================
update public.catalog_categories set name='เหล็กโครงสร้าง',            name_en='Structural steel'           where code='01';
update public.catalog_categories set name='ประปา / สุขาภิบาล',          name_en='Plumbing & sanitary'        where code='02';
update public.catalog_categories set name='วัสดุหน้างาน / ความปลอดภัย', name_en='Site consumables & safety'  where code='03';
update public.catalog_categories set name='สี / เคมีก่อสร้าง',          name_en='Paint & chemicals'          where code='08';
update public.catalog_categories set name='อิฐทางเท้า / งานก่อ',         name_en='Paving & masonry'           where code='11';
update public.catalog_categories set name='เครื่องมือ / อุปกรณ์ช่าง',    name_en='Tools & equipment'          where code='09';
update public.catalog_categories set name='คอนกรีต / ปูน / มวลรวม',     name_en='Concrete / mortar / aggregate' where code='10';
update public.catalog_categories set name='งานผนัง / ผิวอาคาร',         name_en='Cladding / facade'          where code='12';
update public.catalog_categories set name='ทั่วไป / อื่น ๆ',            name_en='General / other'            where code='13';

-- ============================================================================
-- 4. Re-home items. Every move is keyed on (current category code + explicit
--    base_item) so it is ORDER-INDEPENDENT and verifiable. Codes are stable
--    (repurpose = rename only), so referencing by code is safe throughout.
-- ============================================================================

-- 4a. STEEL SPLIT — the 12 fasteners (of cat 01's 62) → cat 14. The 50
--     structural items stay in cat 01. Pattern verified against all 62 names.
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='14')
 where category_id = (select id from public.catalog_categories where code='01')
   and (base_item like 'ตะปู%' or base_item like 'สกรู%' or base_item like 'ลวด%'
        or base_item like 'พุก%' or base_item = 'L-Bolt');

-- 4b. TANKS MERGE — cat 12''s tank items → cat 02 (do this BEFORE 12 receives cladding).
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='02')
 where category_id = (select id from public.catalog_categories where code='12');

-- 4c. CONCRETE/SAND — cat 09''s materials → cat 10.
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='10')
 where category_id = (select id from public.catalog_categories where code='09')
   and base_item in ('คอนกรีต Cylinder', 'คอนกรีตกำลังอัด(Standard)', 'ทรายหยาบ');
--     ready-mix concrete is made-to-order (not stocked); stockable derives false.
update public.catalog_items
   set fulfillment_mode = 'made_to_order', stockable = false
 where category_id = (select id from public.catalog_categories where code='10')
   and base_item in ('คอนกรีต Cylinder', 'คอนกรีตกำลังอัด(Standard)');

-- 4d. ไดวอล (uncertain identity) → cat 13 catch-all; re-home in-app when recognized.
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='13')
 where category_id = (select id from public.catalog_categories where code='09')
   and base_item = 'ไดวอล';

-- 4e. CAT 10''s tools → cat 09 (explicit names; concrete just moved into 10 stays).
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='09')
 where category_id = (select id from public.catalog_categories where code='10')
   and base_item in ('ใบตัดคอนกรีต', 'ลูกดิ่ง');

-- 4f. TOOLS in cat 09 → kind=tool (7) / kind=equipment (2 machines).
update public.catalog_items set kind = 'tool'
 where category_id = (select id from public.catalog_categories where code='09')
   and base_item in ('กะบะผสมปูน', 'เกรียงก่อ', 'เกรียงพลาสติก', 'ถังปูน',
                     'สามเหลี่ยมปาดปูน', 'ใบตัดคอนกรีต', 'ลูกดิ่ง');
update public.catalog_items set kind = 'equipment'
 where category_id = (select id from public.catalog_categories where code='09')
   and base_item in ('เครื่องฉาบปูนมอต้าร์', 'เครื่องดัดเหล็ก');

-- 4g. CAT 13''s fabrications. Stainless ridge caps → cat 04 roofing
--     (already made_to_order). The 2 made-to-order bundles → cat 12 cladding,
--     kind=assembly (already made_to_order). ไดวอล (moved in at 4d) stays in 13.
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='04')
 where category_id = (select id from public.catalog_categories where code='13')
   and base_item = 'ครอบสแตนเลส';
update public.catalog_items
   set category_id = (select id from public.catalog_categories where code='12'), kind = 'assembly'
 where category_id = (select id from public.catalog_categories where code='13')
   and base_item in ('งานอลูคอมโพสิต + ติดตั้ง', 'ราว/รางสแตนเลส + ที่ใส่ลัง');

-- ============================================================================
-- 5. Sync the catalog_item_categories is_primary row to the new canonical home
--    for every re-homed item (the invariant: exactly one is_primary per item,
--    mirroring catalog_items.category_id/subcategory_id). No secondary
--    memberships exist yet, so no unique-constraint collision is possible.
-- ============================================================================
update public.catalog_item_categories cic
   set category_id = ci.category_id, subcategory_id = ci.subcategory_id
  from public.catalog_items ci
 where cic.catalog_item_id = ci.id
   and cic.is_primary
   and (cic.category_id is distinct from ci.category_id
        or cic.subcategory_id is distinct from ci.subcategory_id);
