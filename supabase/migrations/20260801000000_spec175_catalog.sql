-- Spec 175 U1 — item catalog (on-site storage / inventory foundation).
--
-- catalog_items is the shared ITEM MASTER: one identity per item, so that
-- everything downstream (Supply Plan, Stock-In, เบิก/Issue, stock-on-hand,
-- PM-accuracy measurement) can match plan -> order -> stock -> consumption.
-- Today the only "catalog" is a per-site spreadsheet where the same item is
-- spelled differently every time. See docs/inventory-store/README.md.
--
-- Reference data: read-only to authenticated, seeded by migration / service-role
-- (same posture as wp_templates, spec 142 U5). Create/edit of items is a later
-- unit. No prices here — price is not item identity (real cost comes from
-- receipts later); location/usage is NOT part of base_item (it belongs to the
-- WP allocation in the Supply Plan).
--
-- unit is stored as the displayed Thai unit text, reusing the COMMON_UNITS
-- vocabulary (src/lib/purchasing/units.ts, spec 16 — units are intentionally
-- client-side text, not a DB table). stockable=false marks made-to-order /
-- direct-to-WP items (cut-to-length roofing, fire doors, stainless fab,
-- engineered tanks) that are never inventoried.

create type public.item_category as enum (
  'steel_fixing',
  'plumbing_sanitary',
  'site_safety',
  'roofing',
  'ceiling_tile',
  'electrical',
  'door_fire',
  'paint',
  'masonry_tools',
  'paving',
  'tank_septic',
  'custom_fabrication'
);

create table public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  category    public.item_category not null,
  base_item   text not null,
  spec_attrs  text,
  unit        text not null,
  stockable   boolean not null default true,
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One identity per item: same base_item + spec_attrs cannot be entered twice
-- (the anti-drift guard the spreadsheet lacked). spec_attrs NULL collapses to ''
-- so a NULL variant is still unique against itself.
create unique index catalog_items_identity_uniq
  on public.catalog_items (base_item, coalesce(spec_attrs, ''));

alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon, authenticated;
grant select on public.catalog_items to authenticated;

-- Reference data — readable by any authenticated user. No write policy: items
-- are seeded by migration / service-role; the create/edit RPC is a later unit.
create policy "catalog_items readable by authenticated"
  on public.catalog_items for select to authenticated
  using (true);

comment on table public.catalog_items is
  'Spec 175 — item master for the on-site store (reference data; seeded by migration, read-only to authenticated). base_item is identity without location/usage; stockable=false = made-to-order/direct-to-WP.';

-- ----------------------------------------------------------------------------
-- Seed: 71 deduped items from docs/inventory-store/seed-catalog.csv (derived
-- from the operator's previous-site purchase sheet). Units normalised to
-- COMMON_UNITS canonical where matched (กก.->กิโลกรัม, ม.->เมตร). Non-stock
-- lines (freight/service/tax/deposit) are NOT items and are excluded.
-- ----------------------------------------------------------------------------
insert into public.catalog_items (category, base_item, spec_attrs, unit, stockable) values
  -- steel_fixing
  ('steel_fixing', 'เหล็กข้ออ้อย', '12 มิล', 'ท่อน', true),
  ('steel_fixing', 'ลวดดำ', null, 'มัด', true),
  ('steel_fixing', 'ตะปู', '1 นิ้ว', 'ถุง', true),
  ('steel_fixing', 'ตะปู', '2x3', 'กิโลกรัม', true),
  ('steel_fixing', 'ตะปูตีสังกะสี', '(ญ)', 'กิโลกรัม', true),
  ('steel_fixing', 'สกรูแปเหล็ก อลูซิงค์', '85 มิล', 'ตัว', true),
  ('steel_fixing', 'สกรูแปเหล็ก อลูซิงค์', '48 มิล', 'ตัว', true),
  ('steel_fixing', 'สกรูแปเหล็ก อลูซิงค์', '16 มิล', 'ตัว', true),
  ('steel_fixing', 'สกรูแปเหล็ก สีขาว', '16 มิล', 'ตัว', true),
  ('steel_fixing', 'สกรูยิงอลูซิงค์ (ยิงไม้)', null, 'กล่อง', true),
  -- plumbing_sanitary
  ('plumbing_sanitary', 'วงส้วม', null, 'วง', true),
  ('plumbing_sanitary', 'ฝาทึบ', null, 'ฝา', true),
  ('plumbing_sanitary', 'ฝาเกลียว', null, 'ฝา', true),
  ('plumbing_sanitary', 'โถส้วมนั่งยอง', 'ขาว', 'ตัว', true),
  ('plumbing_sanitary', 'ก๊อกบอลสนาม SANWA', 'CKT15 1/2 นิ้ว สีแดง', 'ชิ้น', true),
  ('plumbing_sanitary', 'ก๊อกบอลสนามกุญแจ SANWA', 'CKT15L 1/2 นิ้ว', 'ชิ้น', true),
  ('plumbing_sanitary', 'ปั๊มน้ำอัตโนมัติ MITSUBISHI', 'EP-255R2 250W', 'ชุด', true),
  ('plumbing_sanitary', 'ตะแกรงดักเศษไม้', '3 นิ้ว', 'ชิ้น', true),
  -- site_safety
  ('site_safety', 'สแลน (สแลมป์) เขียว', '50 ม.', 'ม้วน', true),
  ('site_safety', 'สแลน (สแลมป์) เขียว', '100 ม.', 'ม้วน', true),
  ('site_safety', 'เอ็นเขียว', 'NO80', 'ม้วน', true),
  -- roofing (made-to-length -> direct to WP, not stocked)
  ('roofing', 'แผ่นหลังคาลอนตรง CC (3สันลอน)', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'แผ่นหลังคาลอนตรง CC/760', 'สีขาว / ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'ครอบหลังคา CC/457', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'ครอบหลังคา CC/304', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'ครอบหลังคา CC/608', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'ครอบหลังคา CC/914', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'ครอบหลังคา CC/228', 'ตัดตามแบบ', 'แผ่น', false),
  ('roofing', 'แผ่นอลูซิงค์', 'สีซิงค์ ยาว 4 ม.', 'เมตร', true),
  -- ceiling_tile
  ('ceiling_tile', 'กระเบื้อง 12x12 วรรณนที', 'ขาว A', 'กล่อง', true),
  ('ceiling_tile', 'กระเบื้อง 12x12 เคมบริดจ์', 'เทาอ่อน A', 'กล่อง', true),
  ('ceiling_tile', 'กระเบื้อง 24x24 มาสเตอร์', 'เกรย์ EXC R/T A', 'กล่อง', true),
  ('ceiling_tile', 'โครงทีซอย ตราช้าง', '120 ซม. โปรคลิก สีอบขาว', 'เส้น', true),
  ('ceiling_tile', 'ไม้ฝา', '6x3 สีธรรมชาติ', 'มัด', true),
  ('ceiling_tile', 'ซีลาย', 'ธรรมดา', 'มัด', true),
  -- electrical
  ('electrical', 'สายไฟ VCT 450/750V', '2x2.5 sqmm Yazaki 100m', 'ม้วน', true),
  ('electrical', 'สายไฟ NYY 450/750V', '3x6 sqmm Yazaki 100m', 'ม้วน', true),
  ('electrical', 'สายไฟ NYY 450/750V', '2x4 sqmm Yazaki 100m', 'ม้วน', true),
  ('electrical', 'สายไฟ NYY 450/750V', '3x2.5 sqmm Yazaki 100m', 'ม้วน', true),
  ('electrical', 'สายไฟ THW 450/750V', '1x70 sqmm สีดำ Yazaki 100m', 'ม้วน', true),
  ('electrical', 'รางวายเวย์ BE', '4x4x8 นิ้ว', 'ชิ้น', true),
  ('electrical', 'มิเตอร์ไฟ CT ELECTRIC', 'EM3-86 15/45A', 'ตัว', true),
  ('electrical', 'เต้ารับกราวด์คู่ CT ELECTRIC', 'SPS-116 16A ขาว', 'ชุด', true),
  ('electrical', 'เบรกเกอร์ PANASONIC', 'BS1113YT 30A 2P', 'ตัว', true),
  ('electrical', 'ตู้พลาสติกกันน้ำกันฝุ่น RACER', 'RC-OD-RCR03 เบอร์3 เทา', 'ตู้', true),
  ('electrical', 'ไซเรน', 'สีแดง 220V', 'ชุด', true),
  ('electrical', 'ไฟฉุกเฉิน Dyno', 'LFG-12PAT', 'ชิ้น', true),
  ('electrical', 'ป้ายหนีไฟ Dyno', 'X2H-S1ON-1B', 'ชิ้น', true),
  -- door_fire
  ('door_fire', 'บานประตูเหล็กทนไฟ', '100/200/40 พ่นอบสี', 'ชุด', false),
  ('door_fire', 'ช่องกระจกเสริมลวด', '20/60', 'ชุด', false),
  ('door_fire', 'ธรณีสแตนเลสรวมยาง', null, 'ชุด', false),
  ('door_fire', 'คานผลักหนีไฟ IYARA', null, 'ชุด', true),
  ('door_fire', 'โช๊คอัพประตู', '64 ไม่ค้าง', 'ชุด', true),
  ('door_fire', 'กุญแจสแตนเลส SOLEX', '5900SS', 'ชุด', true),
  -- paint
  ('paint', 'สีเคลือบกึ่งเงา TOA กริปตั้น', 'สีขาว', 'แกลลอน', true),
  -- masonry_tools
  ('masonry_tools', 'ถังปูน', null, 'ใบ', true),
  ('masonry_tools', 'กะบะผสมปูน', 'เหลี่ยม', 'อัน', true),
  ('masonry_tools', 'สามเหลี่ยมปาดปูน', null, 'อัน', true),
  ('masonry_tools', 'เกรียงพลาสติก', null, 'อัน', true),
  ('masonry_tools', 'เกรียงก่อ', null, 'อัน', true),
  ('masonry_tools', 'ไดวอล', '1 นิ้ว', 'กิโลกรัม', true),
  -- paving
  ('paving', 'อิฐแบบเรียบ', '15x120', 'ชิ้น', true),
  ('paving', 'อิฐตัวหนอน', null, 'ชิ้น', true),
  -- tank_septic
  ('tank_septic', 'ถังบำบัด Aqua Compact Aeration', 'AC-1.5-TFG', 'ชุด', false),
  ('tank_septic', 'ถังบำบัดไร้อากาศ Aqua Pac', 'MAXA-1000', 'ชุด', false),
  ('tank_septic', 'ถังเก็บน้ำ Aqua', 'Breeze 1500 Gray Granite', 'ชุด', false),
  ('tank_septic', 'ฝาบ่อ Manhole Cover Fiberglass', 'AQC-500 2.25ton', 'ชิ้น', true),
  -- custom_fabrication (made-to-order -> direct to WP, not stocked)
  ('custom_fabrication', 'ราว/รางสแตนเลส + ที่ใส่ลัง', 'สั่งทำ', 'ชุด', false),
  ('custom_fabrication', 'ครอบสแตนเลส', '16 นิ้ว 0.8mm 48x48', 'ชุด', false),
  ('custom_fabrication', 'ครอบสแตนเลส', '10 นิ้ว 0.8mm 38x38', 'ชุด', false),
  ('custom_fabrication', 'งานอลูคอมโพสิต + ติดตั้ง', null, 'งาน', false);
