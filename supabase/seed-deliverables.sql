-- Deliverables backfill — spec 04 Phase 2. Generated 2026-06-11 from the
-- operator's AppSheet master sheet (Google Sheet 18Q8mr1eCpDcYMjIF0a8ygen…),
-- tab 1 (deliverables master, D01–D30) and tab 2 (WP master, WP01–WP81 →
-- DeliverableID). The sheet's later tabs hold a DIFFERENT plan revision
-- (D00 + ~124 WPs) that does NOT match the seeded DB and is excluded —
-- the live WP names were verified against tab 2 before generation
-- (WP01 'งานปักฝัง' … WP81 'งานส่งมอบ', both pilots, 2026-06-11).
--
-- Both pilots receive the same 30 deliverables (the projects were seeded
-- from the same 81-WP template). Idempotent: deliverables upsert on
-- (project_id, code) — DO UPDATE (not DO NOTHING, deliberately: a re-run
-- after a sheet correction converges name/sort_order on this file); the
-- WP link UPDATE converges deliverable_id on the mapping below.
--
-- Application note (same channel as supabase/seed.sql): 'supabase db push'
-- does NOT apply seeds. Run against the linked remote with:
--
--   pnpm exec supabase db query --linked --file supabase/seed-deliverables.sql
--
-- Runs as postgres and bypasses RLS — required: deliverables INSERT/UPDATE
-- policies admit pm/super JWTs, and there is no JWT in this context.
-- The final SELECT is the verification: expect 60 / 162 / 0.

begin;

insert into public.deliverables (project_id, code, name, sort_order)
select p.id, d.code, d.name, d.sort_order
  from (values
    ('D01', 'งานเตรียมพื้นที่', 1),
    ('D02', 'งานเตรียมวัสดุโครงสร้างอาคาร', 2),
    ('D03', 'งานฐานรากอาคารและเสา Tower', 3),
    ('D04', 'งานระบบใต้ดินภายในอาคาร', 4),
    ('D05', 'งานระบบใต้ดินภายนอกอาคาร', 5),
    ('D06', 'งานเทพื้นภายในอาคาร', 6),
    ('D07', 'งานระบบบำบัดน้ำใต้ดิน', 7),
    ('D08', 'งานเตรียมวัสดุโครงถัก (TRUSS)', 8),
    ('D09', 'งานโครงสร้างเหล็กถัก (TRUSS)', 9),
    ('D10', 'งานโครงสร้างเหล็กอาคารและหลังคา', 10),
    ('D11', 'งานหลังคาและไซดิ้งรอบอาคาร', 11),
    ('D12', 'งานรางน้ำและฝ้าเมทัลชีท', 12),
    ('D13', 'งานผนัง Isowall', 13),
    ('D14', 'งานผนังอลูมิเนียมคอมโพสิต', 14),
    ('D15', 'งานผนังอลูมิเนียมกระจกพร้อมหน้าต่างและประตู', 15),
    ('D16', 'งานระบบไฟฟ้า Main', 16),
    ('D17', 'งานสถาปัตย์ภายใน', 17),
    ('D18', 'งานระบบไฟฟ้าส่องสว่าง ตู้ MDB และไฟฟ้าใช้งาน', 18),
    ('D19', 'งานสุขภัณฑ์', 19),
    ('D20', 'งานพื้นภายนอกอาคารด้านหลัง', 20),
    ('D21', 'งานพื้นภายนอกอาคารด้านข้าง', 21),
    ('D22', 'งานพื้นภายนอกอาคารด้านหน้า', 22),
    ('D23', 'งานป้ายและจราจร', 23),
    ('D24', 'งานถนนทางเชื่อม', 24),
    ('D25', 'งานรั้วไวร์แมนและประตูลานโหลด', 25),
    ('D26', 'งานรั้วเมทัลชีท', 26),
    ('D27', 'งานโยธา', 27),
    ('D28', 'งานตรวจสอบ MEP Final', 28),
    ('D29', 'งานก่อนส่งมอบ', 29),
    ('D30', 'งานส่งมอบ', 30)
  ) as d(code, name, sort_order)
 cross join public.projects p
 where p.code in ('PRC-2026-001', 'PRC-2026-002')
on conflict (project_id, code) do update
  set name = excluded.name, sort_order = excluded.sort_order;

with m(wp_code, d_code) as (values
  ('WP01', 'D01'),
  ('WP02', 'D01'),
  ('WP03', 'D01'),
  ('WP04', 'D01'),
  ('WP05', 'D01'),
  ('WP06', 'D02'),
  ('WP07', 'D03'),
  ('WP08', 'D03'),
  ('WP09', 'D03'),
  ('WP10', 'D03'),
  ('WP11', 'D04'),
  ('WP12', 'D04'),
  ('WP13', 'D05'),
  ('WP14', 'D05'),
  ('WP15', 'D06'),
  ('WP16', 'D06'),
  ('WP17', 'D07'),
  ('WP18', 'D07'),
  ('WP19', 'D08'),
  ('WP20', 'D09'),
  ('WP21', 'D10'),
  ('WP22', 'D10'),
  ('WP23', 'D10'),
  ('WP24', 'D10'),
  ('WP25', 'D11'),
  ('WP26', 'D12'),
  ('WP27', 'D12'),
  ('WP28', 'D13'),
  ('WP29', 'D13'),
  ('WP30', 'D13'),
  ('WP31', 'D13'),
  ('WP32', 'D13'),
  ('WP33', 'D13'),
  ('WP34', 'D13'),
  ('WP35', 'D13'),
  ('WP36', 'D14'),
  ('WP37', 'D15'),
  ('WP38', 'D15'),
  ('WP39', 'D16'),
  ('WP40', 'D16'),
  ('WP41', 'D16'),
  ('WP42', 'D17'),
  ('WP43', 'D17'),
  ('WP44', 'D17'),
  ('WP45', 'D18'),
  ('WP46', 'D18'),
  ('WP47', 'D18'),
  ('WP48', 'D18'),
  ('WP49', 'D18'),
  ('WP50', 'D19'),
  ('WP51', 'D20'),
  ('WP52', 'D21'),
  ('WP53', 'D22'),
  ('WP54', 'D23'),
  ('WP55', 'D23'),
  ('WP56', 'D23'),
  ('WP57', 'D23'),
  ('WP58', 'D23'),
  ('WP59', 'D23'),
  ('WP60', 'D23'),
  ('WP61', 'D24'),
  ('WP62', 'D24'),
  ('WP63', 'D24'),
  ('WP64', 'D24'),
  ('WP65', 'D24'),
  ('WP66', 'D25'),
  ('WP67', 'D25'),
  ('WP68', 'D25'),
  ('WP69', 'D25'),
  ('WP70', 'D26'),
  ('WP71', 'D26'),
  ('WP72', 'D27'),
  ('WP73', 'D28'),
  ('WP74', 'D28'),
  ('WP75', 'D28'),
  ('WP76', 'D29'),
  ('WP77', 'D29'),
  ('WP78', 'D29'),
  ('WP79', 'D30'),
  ('WP80', 'D30'),
  ('WP81', 'D30')
)
update public.work_packages wp
   set deliverable_id = d.id
  from m
  join public.deliverables d on d.code = m.d_code
 where wp.code = m.wp_code
   and wp.project_id = d.project_id;

commit;

select 'deliverables rows (expect 60)' as check_item, count(*)::text as value
  from public.deliverables
union all
select 'work_packages linked (expect 162)', count(*)::text
  from public.work_packages where deliverable_id is not null
union all
select 'work_packages unlinked (expect 0)', count(*)::text
  from public.work_packages where deliverable_id is null;
