# Spec 316 — Role-management UX: implementation plan

> **For agentic workers:** execute task-by-task under the `ship-unit` skill
> (lane claim → dependency gate-check → RED first → real-flow verify →
> fresh-eyes → gated ship). Each task = one PR. Checkboxes track steps.

**Goal:** guided role assignment (2-step category picker + capability preview

- user search) and a derived who-can-do-what page, all reading one registry
  that references the live `*_ROLES` constants so it cannot silently rot.

**Architecture:** one new pure SSOT module (`src/lib/roles/role-capabilities.ts`)
derives everything; two UI units consume it. No schema, no `src/lib/auth/**`
edits (import-only), no RPC/action changes — `setUserRole` is reused as-is.

**Tech stack:** existing house patterns only — Server Components + one client
island per surface, `BottomSheet`, vitest + RTL, labels in `labels.ts` when a
term appears on 2+ surfaces.

## Global constraints

- CODE-ONLY. `supabase/` untouched. `src/lib/auth/**` untouched.
- TDD: failing test first, per task, stated explicitly.
- Thai UI copy; Edit/Write tools for Thai text (PowerShell corrupts it).
- Scope discipline: exactly spec 316 §3–§5; follow-ups stay §7.
- Guard trips expected + updated deliberately: `nav-back-affordance.test.ts`
  (new page), possibly `settings-sections.test.ts` (only if a settings entry
  changes — none planned). Existing `role-admin.test.ts` will need updating
  (the flat `<select>` assertions die with the flat select).

---

### Task 1 (U1) — capability registry + guards

**Files:**

- Create: `src/lib/roles/role-capabilities.ts`
- Test: `tests/unit/role-capabilities.test.ts`

**Interfaces produced (later tasks rely on these exact names):**

```ts
export type RoleCategory = "office" | "field" | "external";
export type CapabilityDomain = "purchasing" | "money" | "team" | "site" | "documents" | "admin";
export interface CapabilityEntry {
  key: string;
  roles: readonly UserRole[];
  labelTh: string;
  domain: CapabilityDomain;
  hidden?: boolean; // classification sets (EXTERNAL_ROLES, STAFF_ONBOARDABLE_ROLES) — never rendered
}
export const ROLE_CATEGORY: Record<UserRole, RoleCategory>;
export const ROLE_CATEGORY_LABEL: Record<RoleCategory, string>; // สำนักงาน · หน้างาน · บุคคลภายนอก
export const ROLE_SUMMARY: Record<UserRole, string>;
export const HOME_LABEL: Record<string, string>; // roleHome() route → Thai screen name
export const CAPABILITY_DOMAIN_LABEL: Record<CapabilityDomain, string>;
export const CAPABILITY_REGISTRY: readonly CapabilityEntry[];
export function capabilitiesForRole(role: UserRole): CapabilityEntry[]; // visible only, domain-ordered
export function rolesForCapability(key: string): readonly UserRole[];
export function isUnbuiltRole(role: UserRole): boolean; // roleHome(role) === "/coming-soon"
```

**Registry entries (29 — every `*_ROLES` export in role-home.ts + billing):**
`roles` is ALWAYS the imported constant, never a re-typed array.

| key                    | const                                                    | domain     | labelTh (draft — operator corrects in review) |
| ---------------------- | -------------------------------------------------------- | ---------- | --------------------------------------------- |
| manager-tier           | PM_ROLES                                                 | admin      | ระดับผู้จัดการโครงการ (กลุ่มสิทธิ์หลัก)       |
| procurement-void       | PROCUREMENT_MANAGER_ROLES                                | purchasing | ยกเลิกใบสั่งซื้อ/คำขอซื้อที่อนุมัติแล้ว       |
| pr-decide              | PR_DECIDER_ROLES                                         | purchasing | อนุมัติ/ปฏิเสธคำขอซื้อ                        |
| client-issue           | CLIENT_ISSUER_ROLES                                      | admin      | ออก/ยกเลิกลิงก์เข้าระบบของลูกค้า              |
| site-capture           | SITE_STAFF_ROLES                                         | site       | บันทึกงานหน้างาน (รูปถ่าย/งาน/แรงงาน)         |
| wp-detail              | WP_DETAIL_ROLES                                          | site       | เปิดดูรายละเอียดชุดงาน (WP)                   |
| receive                | RECEIVE_ROLES                                            | purchasing | รับของตามใบสั่งซื้อ                           |
| back-office            | BACK_OFFICE_ROLES                                        | purchasing | งานหลังบ้าน — จัดการผู้ขาย/เอกสารจัดซื้อ      |
| schedule               | SCHEDULE_VIEW_ROLES                                      | site       | ดูตารางงานโครงการ                             |
| worker-roster          | WORKER_ROSTER_ROLES                                      | team       | จัดการรายชื่อช่าง + เพิ่มช่างใหม่             |
| supply-plan            | SUPPLY_PLAN_ROLES                                        | purchasing | วางแผนจัดซื้อวัสดุ                            |
| payroll                | PAYROLL_ROLES                                            | money      | ดูและจ่ายค่าแรง                               |
| payroll-view           | PAYROLL_VIEW_ROLES                                       | money      | ดูค่าแรง (อ่านอย่างเดียว)                     |
| dashboard              | DASHBOARD_VIEW_ROLES                                     | money      | ดูภาพรวมโครงการ (แดชบอร์ด)                    |
| money-view             | MONEY_VIEW_ROLES                                         | money      | ดูตัวเลขการเงินโครงการ                        |
| requests               | PURCHASING_ROLES                                         | purchasing | ใช้งานหน้าคำขอซื้อ                            |
| equipment              | EQUIPMENT_MOVE_ROLES                                     | site       | บันทึกการเคลื่อนย้ายเครื่องมือ                |
| projects               | PROJECT_VIEW_ROLES                                       | site       | เปิดดูโครงการ                                 |
| accounting             | ACCOUNTING_ROLES                                         | money      | ใช้งานหน้าบัญชี (งบทดลอง/กระทบยอด)            |
| office-expense         | OFFICE_EXPENSE_ROLES                                     | money      | บันทึกค่าใช้จ่ายสำนักงาน                      |
| office-expense-finance | OFFICE_EXPENSE_FINANCE_ROLES                             | money      | เห็นค่าใช้จ่ายสำนักงานทั้งหมด + ทำเบิกคืน     |
| legal                  | LEGAL_ROLES                                              | documents  | ใช้งานระบบสัญญา (ฝ่ายกฎหมาย)                  |
| doc-approval           | DOC_APPROVAL_ROLES                                       | documents  | อนุมัติเอกสาร/สัญญา                           |
| po-detail              | PO_DETAIL_VIEW_ROLES                                     | purchasing | เปิดดูรายละเอียดใบสั่งซื้อ                    |
| purchase-report        | PURCHASE_REPORT_ROLES                                    | purchasing | ดูรายงานจัดซื้อ + ส่งออก CSV                  |
| staff-approve          | STAFF_APPROVAL_ROLES                                     | team       | อนุมัติผู้สมัคร + กำหนดสิทธิ์เริ่มต้น         |
| staff-onboardable      | STAFF_ONBOARDABLE_ROLES                                  | team       | (hidden: true — classification)               |
| external               | EXTERNAL_ROLES                                           | admin      | (hidden: true — classification)               |
| billing                | BILLING_WRITE_ROLES (`@/lib/accounting/billing-actions`) | money      | ออก/แก้ไขใบแจ้งหนี้ลูกค้า                     |

**ROLE_CATEGORY (operator-confirmed):** office = super_admin,
project_director, project_manager, project_coordinator, procurement,
procurement_manager, accounting, legal, hr, auditor, subcon_manager ·
field = site_admin, technician, site_owner · external = client, contractor,
visitor.

**HOME_LABEL:** `/sa` งานวันนี้ (หน้างาน) · `/dashboard` ภาพรวม ·
`/requests` คำขอซื้อ · `/projects` โครงการ · `/portal` พอร์ทัลผู้รับเหมา ·
`/accounting` บัญชี · `/legal` กฎหมาย · `/client` พอร์ทัลลูกค้า ·
`/technician` หน้าช่าง · `/coming-soon` ยังไม่มีหน้าจอ.

**ROLE_SUMMARY (draft one-liners, authored here, corrected in review):**
super_admin เห็นและทำได้ทุกอย่าง (เจ้าของระบบ) · project_director ระดับ
ผู้จัดการ เห็นทุกโครงการ · project_manager บริหารโครงการ อนุมัติงาน/คำขอซื้อ ·
project_coordinator ผู้ประสานงาน ดูทุกโครงการ (อ่าน) · site_admin ทีม
หน้างาน ถ่ายรูป/บันทึกงาน/ขอซื้อ · procurement ฝ่ายจัดซื้อ ทำคำขอซื้อ→PO

- ดูแลช่าง · procurement_manager หัวหน้าจัดซื้อ อนุมัติ/ยกเลิกได้ ·
  technician ช่าง เห็นบัตรและงานของตัวเอง · accounting ฝ่ายบัญชี เห็นเงิน
  ทั้งหมด (อ่าน) · legal ฝ่ายกฎหมาย ระบบสัญญา · hr ยังไม่เปิดใช้ ·
  subcon_manager ยังไม่เปิดใช้ · site_owner ยังไม่เปิดใช้ (หัวหน้าหน้างาน
  ในอนาคต) · auditor ยังไม่เปิดใช้ (ผู้ตรวจสอบ) · visitor ยังไม่ได้รับสิทธิ์
  (ค่าเริ่มต้นหลังสมัคร) · contractor ผู้รับเหมาภายนอก (พอร์ทัล DC) · client
  ลูกค้า ดูความคืบหน้า (อ่าน).

**Steps:**

- [ ] 1. Failing test `tests/unit/role-capabilities.test.ts` (state "Writing
     failing test first"). Assertions:

  ```ts
  import * as roleHomeModule from "@/lib/auth/role-home";
  import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";
  // + registry imports

  const roleSetExports = Object.entries(roleHomeModule).filter(
    ([name, v]) => name.endsWith("_ROLES") && Array.isArray(v),
  ) as [string, readonly UserRole[]][];

  it("registry covers every *_ROLES export (by identity)", () => {
    const refs = new Set(CAPABILITY_REGISTRY.map((e) => e.roles));
    for (const [name, value] of roleSetExports)
      expect(refs.has(value), `${name} needs a CAPABILITY_REGISTRY entry`).toBe(true);
    expect(refs.has(BILLING_WRITE_ROLES)).toBe(true);
  });
  it("keys unique + kebab-case; visible labels nonblank", …);
  it("ROLE_CATEGORY / ROLE_SUMMARY cover the whole enum", …); // count-pin via the
    // same enum-values source role-sets.test.ts already uses — reuse that pattern
  it("HOME_LABEL covers roleHome() of every role", () => {
    for (const role of ALL_ROLES) expect(HOME_LABEL[roleHome(role)]).toBeTruthy();
  });
  it("isUnbuiltRole true for site_owner/hr/subcon_manager/auditor/visitor, false for site_admin/legal/…", …);
  it("capabilitiesForRole(super_admin) includes every visible entry; hidden entries never returned", …);
  ```

- [ ] 2. Run: `pnpm test tests/unit/role-capabilities.test.ts` → FAIL (module
     missing).
- [ ] 3. Implement `role-capabilities.ts` per interface + tables above.
     Import sets from `@/lib/auth/role-home` and `BILLING_WRITE_ROLES` from
     `@/lib/accounting/billing-actions` (verify that import is client-safe — it
     is a const in a `"use server"`-adjacent module; if the actions file has
     side-effect imports, move nothing: re-exporting a const from an actions
     module into a client bundle is NOT ok — instead relocate the const to
     `role-capabilities.ts`? NO: membership must stay at its consumer. Resolution:
     import type-safely; if the bundle complains (server-only), registry entry
     for billing switches to a same-membership pinned copy + a sync test that
     asserts set-equality with the real const in the vitest (node) environment.
     Decide at implementation; the sync-test fallback keeps the no-rot property.)
- [ ] 4. Test green; `pnpm lint && pnpm typecheck`.
- [ ] 5. Commit `feat(roles): spec 316 U1 capability registry + coverage guards`.
     Ship via `scripts/ship-pr.sh` (code-only → auto-merge). Real-flow verify =
     run the new test file (no browser surface).

### Task 2 (U2) — /settings/roles: search + 2-step guided picker

**Files:**

- Create: `src/components/features/roles/role-directory.tsx` (client: search
  box + grouped sections; wraps rows)
- Create: `src/components/features/roles/role-picker-sheet.tsx` (client:
  the 2-step picker + preview card + confirm)
- Modify: `src/components/features/roles/role-admin-list.tsx` (row keeps
  layout; sheet content swaps to `RolePickerSheet`)
- Modify: `src/app/settings/roles/page.tsx` (render `RoleDirectory` instead
  of inline group sections; pass flat `RoleUserVM[]`)
- Modify: `src/lib/i18n/labels.ts` (multi-surface terms only: category labels
  via `ROLE_CATEGORY_LABEL` live in the registry module — NOT labels.ts, since
  the registry is itself an SSOT; add here ONLY if a term also appears outside
  the two roles surfaces. Expected: no labels.ts change — flag in PR if one
  becomes necessary.)
- Test: extend `tests/unit/role-admin.test.ts` + create
  `tests/unit/role-directory.test.ts`

**Interfaces consumed:** Task 1 exports; existing `setUserRole(userId, role)`
server action; `groupUsersByRole` (client-safe pure).

**Picker behavior (exact):**

1. Sheet opens at step 1: three category buttons (`ROLE_CATEGORY_LABEL`),
   current role's category marked ("สิทธิ์ปัจจุบันอยู่กลุ่มนี้").
2. Tap category → step 2: roles of that category in `ROLE_GROUP_ORDER` order,
   built roles first, unbuilt (`isUnbuiltRole`) last each with ⚠ badge
   "ยังไม่มีหน้าจอ". Each row: `USER_ROLE_LABEL[role]` + `ROLE_SUMMARY[role]`.
3. Tap role → inline preview panel under the list: "หน้าแรก: {HOME_LABEL[roleHome(role)]}"
   - capabilities from `capabilitiesForRole(role)` grouped under
     `CAPABILITY_DOMAIN_LABEL`, + confirm button "บันทึก" → existing submit path
     (unchanged optimistic/pending/error handling from role-admin-list.tsx).
4. "กลับ" returns step 2→1; sheet close resets to step 1 + clears selection.

**Search behavior (exact):** input above groups, placeholder "ค้นหาชื่อ…";
case-insensitive substring on `user.name`; groups with zero matches collapse;
all-empty → `EmptyNotice` "ไม่พบผู้ใช้"; clearing restores. Pure filter
function exported from `role-directory.tsx` for direct unit-testing.

**Steps:**

- [ ] 1. Failing tests: role-directory (filter fn: matches, no-match, clear;
     rendering: typing narrows visible names) + role-admin update (sheet now
     shows category tiles instead of a flat select; selecting
     หน้างาน → ช่าง shows summary + preview + confirm calls `setUserRole` with
     "technician" — mock the action module as the existing test already does).
- [ ] 2. Run both files → FAIL.
- [ ] 3. Implement the three components + page rewire.
- [ ] 4. Green; `pnpm lint && pnpm typecheck && pnpm test` (full suite —
     role-admin/group-users assertions elsewhere may pin the old page shape).
- [ ] 5. Browser verify (dev-preview super_admin, memory `dev-preview-login`):
     search narrows; assign a spare test user through the 2-step flow end-to-end;
     unbuilt badge visible on site_owner; zero console errors.
- [ ] 6. Commit `feat(roles): spec 316 U2 role search + guided 2-step picker`;
     ship-pr; fresh-eyes review; auto-merge.

### Task 3 (U3) — /settings/roles/capabilities page

**Files:**

- Create: `src/app/settings/roles/capabilities/page.tsx` (server shell:
  `requireRole(["super_admin"])`, `DetailHeader` back to `/settings/roles`,
  title "สิทธิ์การใช้งาน")
- Create: `src/components/features/roles/capability-explorer.tsx` (client
  island: lens toggle + search + accordions)
- Modify: `src/app/settings/roles/page.tsx` (link row/card
  "สิทธิ์การใช้งานของแต่ละบทบาท →" to the new page)
- Modify: `tests/unit/nav-back-affordance.test.ts` (classify
  `/settings/roles/capabilities` STATIC_DETAIL — mirror the /settings/org-chart
  entry)
- Test: `tests/unit/capability-explorer.test.ts`

**Interfaces consumed:** Task 1 exports only. Page is fully static content —
no DB read at all.

**Lens behavior (exact):**

- Segmented control: "ตามบทบาท" (default) · "ตามสิทธิ์".
- By-role: category headers (`ROLE_CATEGORY_LABEL`), roles in
  `ROLE_GROUP_ORDER`; expand → `ROLE_SUMMARY`, home line, unbuilt badge,
  capabilities grouped by domain. Native `<details>` accordion (house
  precedent: `/sa/help`).
- By-capability: domain headers (`CAPABILITY_DOMAIN_LABEL`), visible entries;
  expand → member roles as chips (`USER_ROLE_LABEL`), category-tinted.
- Search filters: by-role lens on role label + summary; by-capability lens on
  `labelTh`. Non-matching accordions unmount (not just collapse).

**Steps:**

- [ ] 1. Failing tests: renders all 17 roles under 3 categories (by-role);
     lens switch shows domain groups; search "ค่าแรง" leaves payroll entries
     only; nav-back guard red until classified.
- [ ] 2. Run → FAIL.
- [ ] 3. Implement page + island + link + guard classification.
- [ ] 4. Green; full `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] 5. Browser verify: both lenses, search both lenses, link from
     /settings/roles, zero console errors.
- [ ] 6. Commit `feat(roles): spec 316 U3 capability explorer page`;
     ship-pr; fresh-eyes; auto-merge. Close lane: LANES block → archive,
     worktree removed, memory topic updated.

## Self-review notes (done at write time)

- Spec §4 preview card = home + capabilities (nav tabs deferred §7) — plan
  matches.
- BILLING_WRITE_ROLES import into a client-reachable module is the one real
  risk; fallback (pinned copy + node-env sync test) preserves the no-rot
  property and is called out in Task 1 step 3.
- role-admin.test.ts rewrite is planned (old flat-select assertions), not a
  surprise trip. settings-sections untouched (no settings-hub entry added).
