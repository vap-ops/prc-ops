# Spec 14 — Thai-first UI + UX coherence pass (iteration 1 of the whole-app upgrade)

**Status:** Locked 2026-06-11 — from the operator's chat brief: (1) the
UX/UI is not intuitive, improve it; (2) the back office uses AppSheet for
purchases and deliveries; (3) main users are Thai — "using Thai is better
for them"; "Upgrade the system as a whole, design a better version each
time." This spec is iteration 1; the deferred-items list at the bottom
seeds iteration 2.

## Problem

Every user-facing string in the web app is English; the operator's users
are Thai construction-site staff. The UI also renders Thai data (WP and
deliverable names) in a Latin-only webfont (Geist), while the PDF already
ships Sarabun (spec 13). Status labels are duplicated in per-file maps
five times over. Two screens render dates in whatever locale the server
or browser happens to have. `notFound()` and unhandled errors fall back
to Next.js's built-in English pages.

## Scope

### A. Thai-first copy — every user-facing string

All strings in the 2026-06-11 inventory (headings, nav, buttons, pills,
empty states, error strips, form labels/placeholders, hints, aria-labels,
`window.confirm` text, metadata) become Thai. Rules:

- **Enum values, route paths, redirect targets, and locked behavioral
  patterns are untouched** (spec 10 doctrine: column values are storage
  keys; the label is presentation).
- Latin stays Latin: `PRC Ops` (brand), `LINE` (brand), project/WP/
  deliverable codes, `PDF`, file-format names (JPEG/PNG/WebP/HEIC),
  the digit `80` in the display-name length error (a unit test keys on
  it).
- DB-raised message text (SECURITY DEFINER functions, worker-written
  `report.error`) is NOT edited — only the TS mirrors/fallbacks that
  actually render.
- `Method Not Allowed` (logout GET, raw HTTP body) stays — protocol
  surface, not UI.
- Thai has no plural forms — pluralization ternaries collapse to
  `{n} รายการ`.
- aria-labels and alt fallbacks are translated too.

**Glossary (binding for all surfaces):** โครงการ (project), รายการงาน
(work package), เตรียมงาน / ระหว่างทำ / แล้วเสร็จ (photo phases
before/during/after — display labels only), สถานะ WP: ยังไม่เริ่ม /
กำลังดำเนินการ / พักชั่วคราว / เสร็จสิ้น / รออนุมัติ; สถานะโครงการ:
กำลังดำเนินการ / พักชั่วคราว / เสร็จสิ้น / เก็บถาวร; การตรวจ: อนุมัติแล้ว /
ไม่อนุมัติ / ให้แก้ไข / รอตรวจครั้งแรก; คำขอซื้อ (purchase request),
สถานะคำขอซื้อ: ส่งคำขอแล้ว / อนุมัติแล้ว / ไม่อนุมัติ / สั่งซื้อแล้ว /
ได้รับของแล้ว; รายงาน: อยู่ในคิว / กำลังสร้าง / พร้อมดาวน์โหลด / ล้มเหลว;
ชื่อที่แสดง (display name), ออกจากระบบ (log out), เข้าสู่ระบบด้วย LINE
(log in with LINE), บันทึก/กำลังบันทึก…/บันทึกแล้ว (save/saving/saved),
ลองใหม่ (retry), กลับ (back), ซ่อนงานที่เสร็จแล้ว (hide completed),
ยังไม่จัดกลุ่ม (Ungrouped), โปรไฟล์ (profile). Error-strip suffix
pattern: `กรุณาลองใหม่อีกครั้ง`. Role labels: ผู้ดูแลหน้างาน (site
admin), ผู้จัดการโครงการ (project manager), ซูเปอร์แอดมิน, ผู้เยี่ยมชม,
ผู้ประสานงานโครงการ, ฝ่ายจัดซื้อ, ช่างเทคนิค, ฝ่ายบุคคล,
ผู้จัดการผู้รับเหมาช่วง, ฝ่ายบัญชี.

### B. Centralized label module (the TDD seam)

New pure module `src/lib/i18n/labels.ts`: Thai label maps for
`work_package_status`, `project_status`, `purchase_request_status`,
`photo_phase` (display), approval decision, report status, `user_role`;
plus `formatThaiDateTime(iso)` — explicit `th-TH-u-ca-buddhist` locale
(Buddhist era, what Thai users expect) pinned to `Asia/Bangkok` so server
and client render identically (fixes the current undefined-locale drift
between the two `formatDateTime` duplicates). The five duplicated
per-file STATUS_LABEL maps and both date formatters are replaced by
imports. `src/lib/reports/predicates.ts` REPORT_STATUS_LABEL is
translated in place (its distinctness test is copy-agnostic).

### C. Sarabun webfont + document language

- `layout.tsx`: `Sarabun` via `next/font/google`, `subsets:
["thai", "latin"]`, `weight: ["400", "500", "600"]` (the only weights
  used app-wide; Sarabun is not a variable font — weight is mandatory);
  `lang="th"`; metadata: title template `%s — PRC Ops`, Thai
  description.
- `globals.css`: `--font-sans: var(--font-sarabun)`. Geist Mono stays
  for codes. Matches the PDF font (spec 13 chose Sarabun) — deviation
  from the skill's Noto Sans Thai suggestion, for brand coherence.

### D. Language-complete error surfaces

New root `src/app/not-found.tsx` (Thai 404 + link to `/`) and
`src/app/error.tsx` (Thai error boundary + reset button; `'use client'`
is required by Next.js for error boundaries — that is the justification).

### E. Truthful flow copy (AppSheet boundary)

On `/requests`: the guidance card and a one-line hint under the status
list explain the real lifecycle per ADR 0025 — request from the WP
screen → PM approves/rejects (rejection always carries a comment) →
once approved, procurement takes over in the back office; สั่งซื้อแล้ว /
ได้รับของแล้ว update automatically from the back-office record and
cannot be set in this app. Copy must not claim procurement sees
pre-approval requests, or that SAs see colleagues' requests.

### F. Pill-class consistency (UX audit item 2)

The hardcoded-zinc status pills on the SA photo screen, PM WP screen,
and `/pm/projects` switch to the existing `workPackageStatusPillClasses`
/ project pill helpers — same visual language everywhere.

### G. Per-page titles

Static Thai `metadata.title` per route (template from C): โครงการ,
รายการงาน, รูปถ่ายงาน, รายการรอตรวจ, โครงการและรายงาน, รายงาน, คำขอซื้อ,
คำขอซื้อของฉัน, โปรไฟล์, เข้าสู่ระบบ, เร็ว ๆ นี้.

## Out of scope (deferred to iteration 2+, recorded in the tracker)

Palette/theme identity remap and light outdoor theme; shared app-header
refactor; super_admin hub as a real route; photo tap-to-enlarge dialog;
toasts/themed confirm dialogs; progressive disclosure on `/pm/requests`;
requested-at/rejection-comment display; queue ordering; `loading.tsx`
skeletons; PWA manifest; i18n library/locale switcher (single-language
Thai by design); any DB/RLS/enum/migration change; PDF worker copy
(spec 04 Phase 3 territory).

## Tests

- **Failing first:** `tests/unit/i18n-labels.test.ts` — every enum value
  has a Thai label, labels are non-empty and distinct per map;
  `formatThaiDateTime` renders a pinned instant as the exact Thai
  Buddhist-era string (server/client deterministic).
- **Updated with the copy they assert** (in the same unit, per
  inventory §B): `tests/e2e/auth-unauthenticated.spec.ts` (LINE button,
  three login banners), `tests/unit/validate-display-name.test.ts`
  (/ว่าง/, digit 80 kept), `tests/unit/validate-purchase-request.test.ts`
  (Thai field-term regexes).

## Verification checklist

- [ ] New label/date test RED before the module exists, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] `pnpm build` passes (validates next/font Sarabun resolution).
- [ ] `pnpm test:e2e` passes locally (asserted strings updated).
- [ ] Grep sweep over `src/` finds no remaining user-facing English
      (brand/code/format-name exceptions above).
- [ ] No diff under `supabase/`, `worker/`, or any enum/route/redirect.
- [ ] Locked behaviors intact: pinned-form modes, back-nav targets,
      group-header semantics, progress-from-unfiltered, avatar
      precedence, getClaims render-path checks.
