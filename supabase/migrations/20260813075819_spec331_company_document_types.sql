-- Spec 331 U1 — company document type registry (มาตรฐานเอกสารบริษัท).
--
-- Retires spec 329's free-text title as the document's IDENTITY: every content row
-- now points at a curated `company_document_types` row. Only super_admin may mint
-- types/categories (the operator's anti-redundancy directive — three spellings of
-- "ภ.พ.20" became three cards), so the write path is DEFINER RPCs, never a policy.
--
-- Shape mirrors the work_categories house registry verbatim (20260813032000):
-- surrogate uuid PK + stable unique `code` + bilingual names + sort_order +
-- is_active + created_by + the SHARED public.set_updated_at() trigger; reads are
-- grant-select to authenticated (a list of document-type names is firm vocabulary,
-- not sensitive); no DELETE anywhere — deactivate via is_active.
--
-- ADDITIVE ONLY. Nothing is dropped: `company_documents.title` stays NOT NULL on
-- content rows (its live `well_formed` CHECK demands it) and is repurposed as a
-- display SNAPSHOT the caller derives from the type; identity lives in type_id.

-- 1. Registry tables ────────────────────────────────────────────────────────────
create table public.company_document_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name_th     text not null,
  name_en     text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint company_document_categories_name_th_not_blank check (length(btrim(name_th)) > 0)
);

create table public.company_document_types (
  id              uuid primary key default gen_random_uuid(),
  category_id     uuid not null references public.company_document_categories (id),
  code            text not null unique,
  name_th         text not null,
  name_en         text,
  hint            text,
  is_singleton    boolean not null default true,
  is_required     boolean not null default false,
  requires_expiry boolean not null default false,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint company_document_types_name_th_not_blank check (length(btrim(name_th)) > 0)
);

create index company_document_types_category_idx
  on public.company_document_types (category_id);

-- updated_at via the EXISTING shared trigger function (do not redefine).
create trigger company_document_categories_set_updated_at
  before update on public.company_document_categories
  for each row execute function public.set_updated_at();
create trigger company_document_types_set_updated_at
  before update on public.company_document_types
  for each row execute function public.set_updated_at();

alter table public.company_document_categories enable row level security;
alter table public.company_document_types enable row level security;
revoke all on public.company_document_categories from anon, authenticated;
revoke all on public.company_document_types from anon, authenticated;
grant select on public.company_document_categories to authenticated;
grant select on public.company_document_types to authenticated;

create policy "company_document_categories readable by authenticated"
  on public.company_document_categories for select to authenticated
  using (true);
create policy "company_document_types readable by authenticated"
  on public.company_document_types for select to authenticated
  using (true);

comment on table public.company_document_categories is
  'Spec 331 — the 7 categories of the company document library (REG/TAX/SSO/FIN/LIC/INS/PRF). Read to authenticated; written only via the super_admin DEFINER RPCs. Deactivate-not-delete.';
comment on table public.company_document_types is
  'Spec 331 — the curated document types accounting picks from (never mints). is_singleton = one live document allowed (trigger-enforced); is_required = counts toward the ยังขาด checklist; requires_expiry = expires_at mandatory at upload.';

-- 2. company_documents gains its identity + instance label ──────────────────────
alter table public.company_documents
  add column type_id uuid references public.company_document_types (id),
  add column label   text;

comment on column public.company_documents.type_id is
  'Spec 331 — the document identity (drives dedup, the checklist, display). NULL only on tombstones and the three grandfathered pre-331 rows.';
comment on column public.company_documents.label is
  'Spec 331 — distinguishes instances of a MULTI type (e.g. "กรุงไทย – โครงการ A"). Required for multi types, forbidden on singletons.';
comment on column public.company_documents.title is
  'Spec 329 free-text title, REPURPOSED by spec 331 as a display snapshot derived from the type (+ label) at upload. Identity is type_id; reads render the type join. Kept NOT NULL on content rows by company_documents_well_formed.';

-- NOT VALID: three pre-331 CC-VERIFY test rows (all already retired) predate the
-- column and cannot be backfilled — the table is append-only. New rows are fully
-- enforced; the legacy three are grandfathered. NOT VALID skips the scan and fires
-- no row triggers (the only triggers here are UPDATE/DELETE/TRUNCATE freezes).
alter table public.company_documents
  add constraint company_documents_type_required check (
    storage_path is null or type_id is not null
  ) not valid;

alter table public.company_documents
  add constraint company_documents_label_bounds check (
    label is null or length(btrim(label)) between 1 and 200
  );

-- 3. The enforcement trigger ────────────────────────────────────────────────────
-- The rules span two tables, so no CHECK or unique index can express them.
-- Tombstones (all payload NULL) skip everything — they carry no document.
create function public.company_documents_enforce_type()
returns trigger
language plpgsql
as $$
declare
  v_type       public.company_document_types%rowtype;
  v_prev_type  uuid;
  v_live_count int;
begin
  if new.storage_path is null then
    return new;                                  -- tombstone: nothing to police
  end if;

  select * into v_type
    from public.company_document_types
   where id = new.type_id;
  if not found then
    raise exception 'company_documents: unknown document type'
      using errcode = 'P0001';
  end if;

  -- a version must keep its chain's type (no ภ.พ.20 → insurance morphing)
  if new.superseded_by is not null then
    select type_id into v_prev_type
      from public.company_documents where id = new.superseded_by;
    if v_prev_type is not null and v_prev_type is distinct from new.type_id then
      raise exception 'company_documents: a new version cannot change the document type'
        using errcode = 'P0001';
    end if;
  end if;

  -- singleton guard — a version is exempt, it REPLACES the live document
  if v_type.is_singleton and new.superseded_by is null then
    select count(*) into v_live_count
      from public.company_documents d
     where d.type_id = new.type_id
       and d.storage_path is not null
       and not exists (
         select 1 from public.company_documents newer
          where newer.superseded_by = d.id
       );
    if v_live_count > 0 then
      raise exception 'มีเอกสารประเภทนี้อยู่แล้ว ใช้ปุ่มเวอร์ชันใหม่แทน'
        using errcode = 'P0001';
    end if;
  end if;

  -- label discipline: multi types need one, singletons must not carry one
  if v_type.is_singleton then
    if new.label is not null then
      raise exception 'company_documents: a singleton type takes no label'
        using errcode = 'P0001';
    end if;
  elsif new.label is null or length(btrim(new.label)) = 0 then
    raise exception 'company_documents: this document type needs a label'
      using errcode = 'P0001';
  end if;

  -- expiry discipline
  if v_type.requires_expiry and new.expires_at is null then
    raise exception 'company_documents: this document type needs an expiry date'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger company_documents_enforce_type
  before insert on public.company_documents
  for each row execute function public.company_documents_enforce_type();

comment on function public.company_documents_enforce_type() is
  'Spec 331 — INSERT-time rules for company documents: known type · versions keep their type · one live document per singleton type (P0001 "ใช้ปุ่มเวอร์ชันใหม่แทน") · multi types need a label, singletons refuse one · requires_expiry types need expires_at. Tombstones skip all of it.';

-- 4. Seed — 7 categories, 31 types (spec 331 §2) ────────────────────────────────
insert into public.company_document_categories (code, name_th, name_en, sort_order) values
  ('REG', 'จดทะเบียนบริษัท',     'Corporate registration',   10),
  ('TAX', 'ภาษี',                 'Tax',                      20),
  ('SSO', 'ประกันสังคม & แรงงาน', 'Social security & labour', 30),
  ('FIN', 'การเงิน & ธนาคาร',     'Financial & banking',      40),
  ('LIC', 'ใบอนุญาต & วิชาชีพ',   'Licences & professional',  50),
  ('INS', 'ประกันภัย',            'Insurance',                60),
  ('PRF', 'โปรไฟล์บริษัท',        'Company profile',          70);

insert into public.company_document_types
  (category_id, code, name_th, name_en, hint, is_singleton, is_required, requires_expiry, sort_order)
select c.id, v.code, v.name_th, v.name_en, v.hint,
       v.is_singleton, v.is_required, v.requires_expiry, v.sort_order
from (values
  ('REG', 'REG_CERT',          'หนังสือรับรองบริษัท',                           'Company certificate (DBD)',          'ออกโดยกรมพัฒนาธุรกิจการค้า อายุใช้งานราชการประมาณ 6 เดือน', true,  true,  true,  10),
  ('REG', 'REG_INCORP',        'ใบสำคัญแสดงการจดทะเบียน (บอจ.3)',              'Certificate of incorporation',       'ออกโดยกรมพัฒนาธุรกิจการค้า',                                true,  true,  false, 20),
  ('REG', 'REG_MOA',           'หนังสือบริคณห์สนธิ (บอจ.2)',                    'Memorandum of association',          null,                                                        true,  true,  false, 30),
  ('REG', 'REG_SHAREHOLDERS',  'บัญชีรายชื่อผู้ถือหุ้น (บอจ.5)',                'Shareholder list',                   'ฉบับล่าสุดที่ยื่นกรมพัฒนาธุรกิจการค้า',                     true,  true,  false, 40),
  ('REG', 'REG_ARTICLES',      'ข้อบังคับบริษัท',                               'Articles of association',            null,                                                        true,  false, false, 50),
  ('REG', 'REG_SEAL',          'ตัวอย่างตราประทับบริษัท',                       'Company seal specimen',              null,                                                        true,  false, false, 60),
  ('REG', 'REG_MAP',           'แผนที่ตั้งสำนักงาน',                            'Office location map',                null,                                                        true,  false, false, 70),
  ('TAX', 'TAX_PP20',          'ภ.พ.20 (ทะเบียนภาษีมูลค่าเพิ่ม)',               'VAT registration (PP20)',            'ออกโดยกรมสรรพากร',                                          true,  true,  false, 10),
  ('TAX', 'TAX_PP01',          'ภ.พ.01 (คำขอจดทะเบียน VAT)',                    'VAT application (PP01)',             null,                                                        true,  false, false, 20),
  ('TAX', 'TAX_TAXID',         'บัตรประจำตัวผู้เสียภาษี',                       'Taxpayer ID card',                   null,                                                        true,  false, false, 30),
  ('TAX', 'TAX_PND50',         'ภ.ง.ด.50 (ปีล่าสุด)',                           'Annual CIT return (PND50)',          'ฉบับปีล่าสุดที่ยื่นแล้ว — ปีใหม่ให้อัปโหลดเป็นเวอร์ชันใหม่',  true,  true,  false, 40),
  ('TAX', 'TAX_PND51',         'ภ.ง.ด.51 (ครึ่งปีล่าสุด)',                      'Half-year CIT return (PND51)',       null,                                                        true,  false, false, 50),
  ('SSO', 'SSO_EMPLOYER',      'สปส.1-01 (ขึ้นทะเบียนนายจ้าง)',                 'Employer SSO registration',          'ออกโดยสำนักงานประกันสังคม',                                 true,  true,  false, 10),
  ('SSO', 'SSO_WCF',           'กองทุนเงินทดแทน',                               'Workmen''s compensation fund',       null,                                                        true,  false, false, 20),
  ('SSO', 'SSO_WORKRULES',     'ข้อบังคับเกี่ยวกับการทำงาน',                    'Work rules',                         'บังคับเมื่อมีลูกจ้างตั้งแต่ 10 คนขึ้นไป',                   true,  false, false, 30),
  ('SSO', 'SSO_SAFETY',        'แบบแจ้ง คปอ.',                                  'Safety committee filing',            'บังคับเมื่อมีลูกจ้างตั้งแต่ 50 คนขึ้นไป',                   true,  false, false, 40),
  ('FIN', 'FIN_STATEMENTS',    'งบการเงินฉบับตรวจสอบ (ปีล่าสุด)',               'Audited financial statements',       'ปีใหม่ให้อัปโหลดเป็นเวอร์ชันใหม่',                          true,  true,  false, 10),
  ('FIN', 'FIN_AUDITOR',       'รายงานผู้สอบบัญชี',                             'Auditor''s report',                  null,                                                        true,  false, false, 20),
  ('FIN', 'FIN_BANK_CONFIRM',  'หนังสือรับรองยอดเงินฝากธนาคาร',                 'Bank balance confirmation',          'ธนาคารออกให้ตามคำขอ มักมีอายุสั้น',                         true,  true,  true,  30),
  ('FIN', 'FIN_BANK_GUARANTEE','หนังสือค้ำประกันธนาคาร',                        'Bank guarantee',                     'ระบุธนาคารและโครงการในช่องรายละเอียด',                      false, false, true,  40),
  ('FIN', 'FIN_CREDIT_LINE',   'วงเงินสินเชื่อ',                                'Credit line letter',                 null,                                                        false, false, true,  50),
  ('LIC', 'LIC_CONTRACTOR_REG','ทะเบียนผู้ประกอบการงานก่อสร้าง (กรมบัญชีกลาง)', 'Government contractor registration', 'ใช้ยื่นงานราชการ ระบุชั้น/สาขาที่ขึ้นทะเบียน',              true,  false, true,  10),
  ('LIC', 'LIC_ENGINEER_CORP', 'ใบอนุญาตนิติบุคคล สภาวิศวกร',                   'COE corporate licence',              'ออกโดยสภาวิศวกร',                                           true,  false, true,  20),
  ('LIC', 'LIC_ARCHITECT_CORP','ใบอนุญาตนิติบุคคล สภาสถาปนิก',                  'Architect council licence',          null,                                                        true,  false, true,  30),
  ('LIC', 'LIC_ISO',           'ใบรับรองมาตรฐาน (ISO / มอก.)',                  'Standards certificate',              'ระบุมาตรฐานในช่องรายละเอียด',                               false, false, true,  40),
  ('LIC', 'LIC_OTHER',         'ใบอนุญาตเฉพาะงานอื่น',                          'Other work-specific licence',        null,                                                        false, false, true,  50),
  ('INS', 'INS_CAR',           'กรมธรรม์ CAR (ประกันงานก่อสร้าง)',              'Contractor''s all risks policy',     'ระบุผู้รับประกันและโครงการในช่องรายละเอียด',                false, false, true,  10),
  ('INS', 'INS_LIABILITY',     'ประกันความรับผิดต่อบุคคลภายนอก',                'Public liability insurance',         null,                                                        false, false, true,  20),
  ('INS', 'INS_GROUP_ACCIDENT','ประกันอุบัติเหตุกลุ่มพนักงาน',                  'Group accident insurance',           null,                                                        false, false, true,  30),
  ('INS', 'INS_VEHICLE',       'ประกันภัยรถ / เครื่องจักร',                     'Vehicle / machinery insurance',      'ระบุทะเบียนรถหรือเครื่องจักรในช่องรายละเอียด',              false, false, true,  40),
  ('PRF', 'PRF_PROFILE',       'Company profile',                               'Company profile',                    'เอกสารแนะนำบริษัทสำหรับยื่นลูกค้า',                         true,  true,  false, 10),
  ('PRF', 'PRF_TRACK_RECORD',  'ผลงานที่ผ่านมา',                                'Track record',                       null,                                                        true,  false, false, 20),
  ('PRF', 'PRF_ORG_CHART',     'โครงสร้างองค์กร',                               'Organisation chart',                 null,                                                        true,  false, false, 30),
  ('PRF', 'PRF_EQUIPMENT_LIST','รายการเครื่องจักรและอุปกรณ์',                   'Equipment list',                     null,                                                        true,  false, false, 40),
  ('PRF', 'PRF_VENDOR_FORM',   'แบบขึ้นทะเบียนผู้ขาย (AVL)',                    'Vendor registration form',           'ระบุชื่อลูกค้า/ผู้ว่าจ้างในช่องรายละเอียด',                 false, false, false, 50)
) as v(cat_code, code, name_th, name_en, hint, is_singleton, is_required, requires_expiry, sort_order)
join public.company_document_categories c on c.code = v.cat_code;

-- 5. Registry RPCs — super_admin only (work_categories RPC shape) ───────────────
create function public.create_company_document_category(
  p_code       text,
  p_name_th    text,
  p_name_en    text default null,
  p_sort_order int  default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_code text := btrim(coalesce(p_code, ''));
  v_th   text := btrim(coalesce(p_name_th, ''));
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'create_company_document_category: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_company_document_category: code required (<=40)' using errcode = '22023';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'create_company_document_category: name_th required (<=200)' using errcode = '22023';
  end if;

  insert into public.company_document_categories (code, name_th, name_en, sort_order, created_by)
    values (v_code, v_th, nullif(btrim(coalesce(p_name_en, '')), ''),
            coalesce(p_sort_order, 0), auth.uid());
end;
$$;
revoke all on function public.create_company_document_category(text, text, text, int) from public, anon;
grant execute on function public.create_company_document_category(text, text, text, int) to authenticated;
comment on function public.create_company_document_category(text, text, text, int) is
  'Spec 331 — add a document category (super_admin only). Duplicate code → 23505; blank/oversize code or name_th → 22023; other role → 42501.';

create function public.update_company_document_category(
  p_code       text,
  p_name_th    text,
  p_name_en    text default null,
  p_sort_order int  default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_th   text := btrim(coalesce(p_name_th, ''));
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'update_company_document_category: role not permitted' using errcode = '42501';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'update_company_document_category: name_th required (<=200)' using errcode = '22023';
  end if;

  update public.company_document_categories
     set name_th = v_th,
         name_en = nullif(btrim(coalesce(p_name_en, '')), ''),
         sort_order = coalesce(p_sort_order, 0)
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'update_company_document_category: unknown code' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.update_company_document_category(text, text, text, int) from public, anon;
grant execute on function public.update_company_document_category(text, text, text, int) to authenticated;

create function public.set_company_document_category_active(
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
    raise exception 'set_company_document_category_active: role not permitted' using errcode = '42501';
  end if;
  update public.company_document_categories
     set is_active = coalesce(p_is_active, true)
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'set_company_document_category_active: unknown code' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_company_document_category_active(text, boolean) from public, anon;
grant execute on function public.set_company_document_category_active(text, boolean) to authenticated;

create function public.create_company_document_type(
  p_category_code   text,
  p_code            text,
  p_name_th         text,
  p_name_en         text    default null,
  p_hint            text    default null,
  p_is_singleton    boolean default true,
  p_is_required     boolean default false,
  p_requires_expiry boolean default false,
  p_sort_order      int     default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_cat  uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_th   text := btrim(coalesce(p_name_th, ''));
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'create_company_document_type: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_company_document_type: code required (<=40)' using errcode = '22023';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'create_company_document_type: name_th required (<=200)' using errcode = '22023';
  end if;

  select id into v_cat from public.company_document_categories
   where code = btrim(coalesce(p_category_code, ''));
  if v_cat is null then
    raise exception 'create_company_document_type: unknown category code' using errcode = '22023';
  end if;

  insert into public.company_document_types
      (category_id, code, name_th, name_en, hint, is_singleton, is_required,
       requires_expiry, sort_order, created_by)
    values (v_cat, v_code, v_th,
            nullif(btrim(coalesce(p_name_en, '')), ''),
            nullif(btrim(coalesce(p_hint, '')), ''),
            coalesce(p_is_singleton, true), coalesce(p_is_required, false),
            coalesce(p_requires_expiry, false), coalesce(p_sort_order, 0), auth.uid());
end;
$$;
revoke all on function public.create_company_document_type(text, text, text, text, text, boolean, boolean, boolean, int) from public, anon;
grant execute on function public.create_company_document_type(text, text, text, text, text, boolean, boolean, boolean, int) to authenticated;
comment on function public.create_company_document_type(text, text, text, text, text, boolean, boolean, boolean, int) is
  'Spec 331 — add a document type under a category (super_admin only). Users PICK types, never mint them — this RPC is the only creation path.';

create function public.update_company_document_type(
  p_code            text,
  p_name_th         text,
  p_name_en         text    default null,
  p_hint            text    default null,
  p_is_singleton    boolean default true,
  p_is_required     boolean default false,
  p_requires_expiry boolean default false,
  p_sort_order      int     default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_th   text := btrim(coalesce(p_name_th, ''));
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'update_company_document_type: role not permitted' using errcode = '42501';
  end if;
  if v_th = '' or length(v_th) > 200 then
    raise exception 'update_company_document_type: name_th required (<=200)' using errcode = '22023';
  end if;

  update public.company_document_types
     set name_th = v_th,
         name_en = nullif(btrim(coalesce(p_name_en, '')), ''),
         hint = nullif(btrim(coalesce(p_hint, '')), ''),
         is_singleton = coalesce(p_is_singleton, true),
         is_required = coalesce(p_is_required, false),
         requires_expiry = coalesce(p_requires_expiry, false),
         sort_order = coalesce(p_sort_order, 0)
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'update_company_document_type: unknown code' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.update_company_document_type(text, text, text, text, boolean, boolean, boolean, int) from public, anon;
grant execute on function public.update_company_document_type(text, text, text, text, boolean, boolean, boolean, int) to authenticated;

create function public.set_company_document_type_active(
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
    raise exception 'set_company_document_type_active: role not permitted' using errcode = '42501';
  end if;
  update public.company_document_types
     set is_active = coalesce(p_is_active, true)
   where code = btrim(coalesce(p_code, ''));
  if not found then
    raise exception 'set_company_document_type_active: unknown code' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.set_company_document_type_active(text, boolean) from public, anon;
grant execute on function public.set_company_document_type_active(text, boolean) to authenticated;
