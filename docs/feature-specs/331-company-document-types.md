# Spec 331 — Company document type registry (มาตรฐานเอกสารบริษัท)

- **Status:** DESIGN APPROVED (operator, in-chat 2026-07-19) — build pending spec review
- **Date:** 2026-07-19
- **Extends:** spec 329 (company documents library — table, bucket, `/settings/company-docs`)
- **Related:** ADR 0004/0009/0015 (append-only + supersede + tombstone), work/equipment/project
  category registries (the curated-registry house pattern this mirrors)

## 0. Problem

Spec 329 shipped with a **free-text title**. Two accounting admins can each upload
"ภ.พ.20", "ภพ20", "ใบทะเบียนภาษีมูลค่าเพิ่ม" — three cards, one document. Nothing
tells anyone which company papers are _missing_, because nothing declares what the
company is supposed to hold.

**Operator directive (2026-07-19):** standardize the documents; list and categorize
what a company must have; **only super_admin may create document types and
categories** — users pick from the list, never mint their own.

## 1. Scope decisions (operator, in-chat)

- **Identity documents only.** High-churn periodic filings (ภ.พ.30, สปส.1-10,
  ภ.ง.ด.1/3/53) stay out — 12 rows a year each would bury the certificates.
  งบการเงิน and ภ.ง.ด.50 DO belong: they are singletons whose "new version" is
  simply the new fiscal year.
- **Uniqueness is per type, DB-enforced.** A blanket one-per-type rule is wrong —
  a firm legitimately holds several bank guarantees and several insurance policies
  at once. So each type carries `is_singleton`, and the DB refuses a second live
  document only for singleton types.

## 2. The standard list — 7 categories, 31 types

Seeded by the migration. ⭐ = required (counts toward the missing-documents
checklist, §6). S = singleton (one live doc). M = multi (many live, each labelled).
E = expiry required at upload.

### REG — จดทะเบียนบริษัท

| code               | name_th                         | flags  |
| ------------------ | ------------------------------- | ------ |
| `REG_CERT`         | หนังสือรับรองบริษัท             | ⭐ S E |
| `REG_INCORP`       | ใบสำคัญแสดงการจดทะเบียน (บอจ.3) | ⭐ S   |
| `REG_MOA`          | หนังสือบริคณห์สนธิ (บอจ.2)      | ⭐ S   |
| `REG_SHAREHOLDERS` | บัญชีรายชื่อผู้ถือหุ้น (บอจ.5)  | ⭐ S   |
| `REG_ARTICLES`     | ข้อบังคับบริษัท                 | S      |
| `REG_SEAL`         | ตัวอย่างตราประทับบริษัท         | S      |
| `REG_MAP`          | แผนที่ตั้งสำนักงาน              | S      |

### TAX — ภาษี

| code        | name_th                         | flags |
| ----------- | ------------------------------- | ----- |
| `TAX_PP20`  | ภ.พ.20 (ทะเบียนภาษีมูลค่าเพิ่ม) | ⭐ S  |
| `TAX_PP01`  | ภ.พ.01 (คำขอจดทะเบียน VAT)      | S     |
| `TAX_TAXID` | บัตรประจำตัวผู้เสียภาษี         | S     |
| `TAX_PND50` | ภ.ง.ด.50 (ปีล่าสุด)             | ⭐ S  |
| `TAX_PND51` | ภ.ง.ด.51 (ครึ่งปีล่าสุด)        | S     |

### SSO — ประกันสังคม & แรงงาน

| code            | name_th                                      | flags |
| --------------- | -------------------------------------------- | ----- |
| `SSO_EMPLOYER`  | สปส.1-01 (ขึ้นทะเบียนนายจ้าง)                | ⭐ S  |
| `SSO_WCF`       | กองทุนเงินทดแทน                              | S     |
| `SSO_WORKRULES` | ข้อบังคับเกี่ยวกับการทำงาน (≥10 คน)          | S     |
| `SSO_SAFETY`    | แบบแจ้ง คปอ. (คณะกรรมการความปลอดภัย, ≥50 คน) | S     |

### FIN — การเงิน & ธนาคาร

| code                 | name_th                         | flags  |
| -------------------- | ------------------------------- | ------ |
| `FIN_STATEMENTS`     | งบการเงินฉบับตรวจสอบ (ปีล่าสุด) | ⭐ S   |
| `FIN_AUDITOR`        | รายงานผู้สอบบัญชี               | S      |
| `FIN_BANK_CONFIRM`   | หนังสือรับรองยอดเงินฝากธนาคาร   | ⭐ S E |
| `FIN_BANK_GUARANTEE` | หนังสือค้ำประกันธนาคาร          | M E    |
| `FIN_CREDIT_LINE`    | วงเงินสินเชื่อ                  | M E    |

### LIC — ใบอนุญาต & วิชาชีพ

| code                 | name_th                                       | flags |
| -------------------- | --------------------------------------------- | ----- |
| `LIC_CONTRACTOR_REG` | ทะเบียนผู้ประกอบการงานก่อสร้าง (กรมบัญชีกลาง) | S E   |
| `LIC_ENGINEER_CORP`  | ใบอนุญาตนิติบุคคล สภาวิศวกร                   | S E   |
| `LIC_ARCHITECT_CORP` | ใบอนุญาตนิติบุคคล สภาสถาปนิก                  | S E   |
| `LIC_ISO`            | ใบรับรองมาตรฐาน (ISO / มอก.)                  | M E   |
| `LIC_OTHER`          | ใบอนุญาตเฉพาะงานอื่น                          | M E   |

### INS — ประกันภัย

| code                 | name_th                          | flags |
| -------------------- | -------------------------------- | ----- |
| `INS_CAR`            | กรมธรรม์ CAR (ประกันงานก่อสร้าง) | M E   |
| `INS_LIABILITY`      | ประกันความรับผิดต่อบุคคลภายนอก   | M E   |
| `INS_GROUP_ACCIDENT` | ประกันอุบัติเหตุกลุ่มพนักงาน     | M E   |
| `INS_VEHICLE`        | ประกันภัยรถ / เครื่องจักร        | M E   |

### PRF — โปรไฟล์บริษัท

| code                 | name_th                     | flags |
| -------------------- | --------------------------- | ----- |
| `PRF_PROFILE`        | Company profile             | ⭐ S  |
| `PRF_TRACK_RECORD`   | ผลงานที่ผ่านมา              | S     |
| `PRF_ORG_CHART`      | โครงสร้างองค์กร             | S     |
| `PRF_EQUIPMENT_LIST` | รายการเครื่องจักรและอุปกรณ์ | S     |
| `PRF_VENDOR_FORM`    | แบบขึ้นทะเบียนผู้ขาย (AVL)  | M     |

Each seeded row also carries a `name_en` (house bilingual parity — work_categories
C3) and, where useful, a `hint` naming the issuing authority (DBD, สรรพากร,
สปส., สภาวิศวกร…) so the picker teaches as it lists.

The seed is data, not doctrine — super_admin edits the list in-app afterwards
(§5). ⭐/S/M/E are all per-type toggles, not code branches.

## 3. Schema

Two registry tables, mirroring the **work_categories** house pattern verbatim
(`20260813032000_spec226_work_categories.sql`): stable unique `code`, bilingual
name, `sort_order`, `is_active`, `created_by`, shared `set_updated_at()` trigger,
**no DELETE** — deactivate.

`company_document_categories`: `id` · `code` text not null unique
(REG/TAX/SSO/FIN/LIC/INS/PRF) · `name_th` · `name_en` · `sort_order` int not null
default 0 · `is_active` bool not null default true · `created_by` uuid references
`auth.users(id)` · `created_at`/`updated_at` (+ `company_document_categories_set_updated_at`
trigger on the shared `public.set_updated_at()` — do not redefine it).

`company_document_types`: same spine, plus `category_id` FK → categories ·
`hint` text null (what it is / where to obtain it) · `is_singleton` bool not null ·
`is_required` bool not null default false · `requires_expiry` bool not null default
false (+ `company_document_types_set_updated_at`).

`company_documents` gains exactly two columns:

- `type_id uuid references company_document_types(id)` — the document's **identity**
  (drives dedup, the checklist, and display).
- `label text` — distinguishes instances of a MULTI type ("ค้ำประกัน กรุงไทย – โครงการ A");
  nonblank ≤200 when present.

⚠ **`title` STAYS REQUIRED on content rows.** The live
`company_documents_well_formed` CHECK reads `storage_path is not null and … and
title is not null` — leaving it NULL would `23514` every upload, and dropping that
constraint would make this a DESTRUCTIVE migration (`change-management.md` §Procedure
B, operator-gated) instead of an additive one. So `title` is **kept and repurposed as
a display snapshot**: the server action derives it from the chosen type's `name_th`
(plus ` – ${label}` for multi types) and writes it alongside `type_id`. Reads render
from the type join; the snapshot preserves what the document was called the day it was
filed, and the spec-329 pgTAP assertion "payload without title rejected" stays valid,
untouched.

RLS — **house posture, not spec 329's**: `revoke all from anon, authenticated` +
`grant select to authenticated` + a `using (true)` SELECT policy on both registry
tables (a list of document-type names is not sensitive, and every picker needs it).
Writes: no policies at all — the super-only DEFINER RPCs (§5) are the sole path.
This deliberately does NOT extend the `COMPANY_DOC_VIEW_ROLES` sync obligation.

**Why not reuse `contact_doc_purpose`** (which already carries `company_cert` /
`vat_cert`, `database.types.ts:10956`): it is a hardcoded Postgres enum scoped to
CONTACT attachments (a counterparty's papers), and an enum cannot be edited by
super_admin in-app — the operator's core requirement. Different axis, different
lifecycle; no reuse. (Checked per the spec-325 lesson.)

## 4. Rules — enforced in the DB

A `BEFORE INSERT` trigger on `company_documents` (the rules span two tables, so a
unique index cannot express them):

1. **Type required.** A content row (`storage_path not null`) must carry `type_id`.
   Stated as a NEW CHECK `company_documents_type_required`, added **`NOT VALID`** —
   three pre-existing CC-VERIFY test rows (all already retired) predate the column
   and cannot be backfilled, because the table is append-only. `NOT VALID` skips the
   scan and fires no row triggers (verified: the only triggers are UPDATE/DELETE/
   TRUNCATE freezes), so new rows are fully enforced while the legacy three are
   grandfathered. The three existing CHECKs (`title_bounds`, `well_formed`,
   `no_self_supersede`) are left untouched — nothing is dropped, so U1 stays
   ADDITIVE and keeps the standing self-merge grant.
2. **Singleton guard.** If the type `is_singleton` and a LIVE document of that type
   already exists (current-set read: `storage_path not null` + anti-join), reject
   with `P0001` "มีเอกสารประเภทนี้อยู่แล้ว ใช้ปุ่มเวอร์ชันใหม่แทน". A version row
   (`superseded_by not null`) is exempt — it replaces the live one rather than adding.
3. **No type morphing.** A version row's `type_id` must equal the superseded row's,
   so a ภ.พ.20 chain can never become an insurance policy.
4. **Label discipline.** A MULTI type requires a nonblank `label`; a SINGLETON type
   must not carry one (its name is the type).
5. **Expiry discipline.** `requires_expiry` types reject a NULL `expires_at`.

Tombstones (retire) skip 2–5 — they carry no payload.

Accepted race: two concurrent inserts of the same singleton type could both pass the
guard (read-then-write). Two accounting users, additive-only consequence (a duplicate
card, fixable by retire) — not worth a lock. Noted, not hidden.

## 5. Registry management — super_admin only

`/settings/company-doc-types`, `requireRole(["super_admin"])` (the
`/settings/integrity` · `/settings/cards` pattern), listed in the admin settings
section. **Six** DEFINER RPCs following the work-categories RPC shape verbatim —
keyed by the stable **`code`** (never editable, never the surrogate id), separate
activate/deactivate calls, `revoke all … from public, anon` + `grant execute to
authenticated` inline, fail-closed `super_admin` gate raising `42501`, `22023` on
blank input, `23505` on duplicate code:

- `create_company_document_category(p_code, p_name_th, p_name_en, p_sort_order)`
- `update_company_document_category(p_code, p_name_th, p_name_en, p_sort_order)`
- `set_company_document_category_active(p_code, p_is_active)`
- `create_company_document_type(p_category_code, p_code, p_name_th, p_name_en, p_hint, p_is_singleton, p_is_required, p_requires_expiry, p_sort_order)`
- `update_company_document_type(p_code, p_name_th, p_name_en, p_hint, p_is_singleton, p_is_required, p_requires_expiry, p_sort_order)`
- `set_company_document_type_active(p_code, p_is_active)`

No DELETE anywhere — deactivate. A deactivated type disappears from the picker but
its existing documents keep rendering (the join reads the row regardless of
`is_active`).

⚠ Flipping `is_singleton` false→true on a type that already has several live
documents does NOT retro-reject them (the trigger runs on INSERT only); the next
upload is refused. Accepted — surfaced in the registry UI as a count.

## 6. Surfaces

**`/settings/company-docs` (spec 329 page) changes:**

- Cards render the **type name** from the join (+ `label` for multi types) instead of
  the stored snapshot; category becomes the grouping header. Legacy rows with no
  `type_id` (the three retired test rows) fall back to `title` — they are already
  invisible, but the reader must not crash on them.
- Upload sheet: file → **หมวด** → **ประเภทเอกสาร** (grouped picker; the chosen
  type's `hint` shows beneath) → label (multi types only) → issue/expiry dates
  (expiry required when `requires_expiry`) → note. Free-text title is gone.
- **ยังขาด section** — every `is_required` active type with no live document, listed
  as a to-do with an inline อัปโหลด button. This is what "standardize" buys: the
  library states what the company is missing, not just what it has.

**`/settings/company-doc-types`** — super_admin registry editor: categories with
their types, inline add/edit sheets, active toggles, the four flags.

## 7. Non-goals (v1)

- No periodic-filing support (§1) — own spec if accounting asks.
- No per-type reminder notifications (spec 329 §6 follow-up still stands).
- No renaming/merging of already-uploaded documents' types (retire + re-upload).
- No import of the seed from a spreadsheet — the migration is the seed.
- No hard DELETE of a category/type.

## 8. Units

- **U1 — schema (additive migration `20260813075818`, schema lane; pgTAP `331`,
  RED-first).** Two registry tables + RLS + seed (7 categories, 31 types) +
  `type_id`/`label` on `company_documents` + the `type_required` CHECK (`NOT VALID`)
  - the enforcement trigger + the six super RPCs + `db:types` (+ the worker's
    vendored copy — `db-types-sync` guard). Danger-path → held; **additive** (nothing
    dropped) → standing self-merge grant on green.
- **U2 — UI (code, browser-verified).** Type-driven card display + grouped pickers in
  the upload sheet + ยังขาด section + `/settings/company-doc-types` + settings entry
  - guard updates (settings matrix/hub render, nav-back STATIC_DETAIL).

Verification floor: pgTAP for every rule in §4 both directions (singleton reject vs
version-exempt, morph reject, label discipline, expiry discipline, super-only RPC
gates, view-role read of the registry) · vitest RED-first for pickers/missing-list ·
real-flow browser as dev-preview super_admin (pick type → upload → duplicate attempt
refused with the Thai message → version allowed → ยังขาด shrinks) · view-as accounting
sees the picker but NOT `/settings/company-doc-types`.

## 9. Open questions

None blocking. The seed list (§2) is the one thing worth revisiting with the
accountants once they see it in-app — changing it afterwards is an in-app data task
(super_admin), not a code change, which is the point of the registry.
