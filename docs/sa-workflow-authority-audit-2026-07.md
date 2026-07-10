# Site Admin (SA) workflow & authority audit — 2026-07

**Status:** reference (audit snapshot). **Date:** 2026-07-10.
**Source of truth:** every gate below was **verified against the live production
database** in Session 1 (RPC bodies, RLS policies, and grants read from the
running Postgres, not from migration files). Code paths read at branch HEAD off
`origin/main` — **S1 base: main HEAD `f82a3f8` / origin `b7005fd`**. Session 2
added the three code confirmations noted inline (marked *S2-confirmed*) and wrote
this document.

This is a neutral reference: it records what the `site_admin` (SA) role can and
cannot do, and how that authority is enforced. It does not re-derive or soften
the verified facts. Findings that may warrant a fix are recorded factually in
§5; the ranked fix decision lives in the S2 session report, not here.

Related docs: [`site-map.md`](site-map.md) (routes + gates),
[`app-workflows-and-roles.md`](app-workflows-and-roles.md) (all roles),
[`inventory-store/`](inventory-store) (store model), the store/GL ADRs
(0057 GL, 0064 divert), and spec 197 (store as a per-project surface).

---

## 1. SA identity & access

| Facet | Value | Source |
| ----- | ----- | ------ |
| Role enum | `site_admin` — the on-site storekeeper / field lead | `user_role` enum |
| Home | `/sa` (the daily home, spec 192 U4) | `roleHome()` — `src/lib/auth/role-home.ts:433` |
| Bottom nav (4 tabs) | หน้าหลัก `/sa` · โครงการ `/projects` · จัดซื้อ `/requests` · ตั้งค่า `/settings` | `SA_TABS` — `src/components/features/chrome/bottom-tab-bar.tsx:99` |
| Also reachable (off the bar) | `/dashboard` (money-free overview) · `/equipment` · per-project sub-surfaces from `/projects`: `/projects/[id]/store` (คลัง), `/projects/[id]/schedule`, WP detail | `DASHBOARD_VIEW_ROLES`, equipment role sets, in-page links |

**Role-set SSOT — `src/lib/auth/role-home.ts`.** SA is a member of
`SITE_STAFF_ROLES` (`:84`) and therefore of `WP_DETAIL_ROLES` (`:101`, which is
`SITE_STAFF_ROLES` + procurement tier). This is why SA reaches the WP detail
screens and the per-project store. SA is **deliberately excluded** from
`SUPPLY_PLAN_ROLES` (a field role, not a supply-plan curator) and from the
supplier-curator / back-office sets. `DASHBOARD_VIEW_ROLES` = `SITE_STAFF_ROLES`
+ accounting, so SA can open the money-free `/dashboard`.

The store surface is the headline access fact: spec 197 U1 made `/projects/[id]/store`
a per-project route gated to `WP_DETAIL_ROLES` — which **admits SA** — and the
SA home surfaces it directly (the "คลัง & ของเข้า" tile,
`src/components/features/sa/sa-tools.tsx:36`). *S2-confirmed: the store is
one tap from the SA home.*

---

## 2. Workflow inventory by surface

Every SA **write** workflow, its entry surface, its **live** authorization gate,
its target table(s), and whether it is GL-consequential. `can_see_project` /
`can_see_wp` are the membership helpers; "DEFINER" = the gate lives inside a
`SECURITY DEFINER` RPC body; "RLS INSERT" = the gate is the table's INSERT
policy. All 14 are within SA authority (SA **CAN**), with the scope noted.

### 2.1 WP detail (the WP-centric surfaces)

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 1 | **Progress photos** | `photo_logs` INSERT **RLS**: role ∈ (site_admin, pm, super, director) AND `can_see_wp` AND `uploaded_by = auth.uid()`. Storage `'photos'` INSERT is **role-only** (private bucket). | `photo_logs` + `storage.objects` | — |
| 2 | **Submit WP** (ส่งงานเข้าตรวจ) | No RPC. Action `requireActionRole(SITE_STAFF)` + membership + photo-evidence gate; the status write is `createAdminClient().update({status:'pending_approval'})` guarded `.in('status', TRANSITIONABLE_FROM)`. | `work_packages` (**service role**) | — |
| 3 | **Defect reopen** | `reopen_work_package_for_defect` **DEFINER**: role ∈ (site_admin, pm, super, director, auditor) AND `can_see_wp`. `p_source='client'` blocks SA (PM-tier only). | `work_packages` → rework + `audit_log` | — |
| 4 | **Log labor day** | `log_labor_day` **DEFINER**: role ∈ (site_admin, pm, super, director) + WP not complete + worker active. | `labor_logs` | — (labor GL is a later freeze, not this write) |
| 7 | **Return to store** (คืนเข้าคลัง) | `return_stock_to_store` **DEFINER**: role ∈ (site_admin, pm, super, director) AND `can_see_project`. | `stock_returns` (+ on-hand) | **GL** (return leg) |
| 9 | **Create PR** (คำขอซื้อ) | `purchase_requests` INSERT **RLS**: `requested_by = auth.uid()` AND `source='app'` AND ((role ∈ (site_admin, pm, super, director) AND (`can_see_wp` OR `can_see_project`)) OR role ∈ procurement*). **SA has no UPDATE/cancel.** | `purchase_requests` | — (create only) |
| 10a | **Site-buy → use now** (ใช้ที่งานนี้เลย) | `site_purchase_use_now` **DEFINER**: role ∈ (site_admin, pm, super, director) AND `can_see_project`. | `stock_receipts` + `stock_issues` | **GL** Dr 1400 / Cr 2100 at cost |
| 10b | **Site-buy → expense** (ค่าใช้จ่ายหน้างาน) | `record_site_purchase` **DEFINER**: **role-only** (site_admin, pm, super, director) + WP-exists. **No `can_see_project`.** *(See §5 F2.)* | `purchase_requests` (status `site_purchased`, amount) | Input VAT 1300 split if VAT |

*S2-confirmed: workflow 10b is mounted on WP detail as the "ค่าใช้จ่ายหน้างาน"
expense tab — `SelfPurchaseSection` → `SelfPurchaseForm`
(`src/components/features/purchasing/self-purchase-form.tsx:14`, `-section.tsx:38`),
carrying `projectId` + `workPackageId` from the route. The happy-path UI is
member-scoped; the RPC itself is not (F2).*

### 2.2 Project store — `/projects/[id]/store` (คลัง)

Page gated to `WP_DETAIL_ROLES` (admits SA). Within the page each action keeps
its own gate. The SA is the on-site storekeeper (SA-custody / store-first
doctrine), so these are all GL-consequential by design (§3).

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 5 | **Issue stock** (เบิก) | `issue_stock` / `issue_stock_bulk` **DEFINER**: role ∈ (site_admin, pm, super, director) AND `can_see_project`. | `stock_issues` (+ on-hand) | **GL** Dr 1400 WIP / Cr 1500 Inventory |
| 6 | **Stock count** (ตรวจนับ) | `record_stock_count` **DEFINER**: same set AND `can_see_project`. | `stock_counts` (+ reconcile) | **GL** (shrinkage, B6b) |
| — | **Stock-in** (รับเข้า) | `record_stock_in` / `record_stock_in_bulk` **DEFINER**: role ∈ (site_admin, pm, super, procurement, director) AND (`can_see_project` OR role=procurement). | `stock_receipts` (+ on-hand) | **GL** Dr 1500 Inventory / Cr 2100 AP at cost |

*S2-confirmed (F1): `record_stock_in` **admits `site_admin`** (spec 197 U1,
mig `20260813000700`). It is project-scoped. It is **SA-reachable**: the SA-home
"คลัง & ของเข้า / รับเข้า · เบิก" tile deep-links to this page, and the รับเข้า
grid renders for the page's viewers (SA is `SITE_STAFF`, so `canIssue` is also
true). The TS action `src/app/store/actions.ts` comment still says "BACK_OFFICE"
— that comment is **stale**; the TS layer holds no gate (it relays the RPC and
maps error 42501). Authority is the live RPC, which admits SA.*

*S2-confirmed (c): stock-in GL posting is asynchronous (AFTER-INSERT enqueue →
outbox → `post_stock_receipt_to_gl`, drained by `drain_gl_posting`). Accounts:
**Dr 1500 `วัสดุคงคลัง (สโตร์หน้างาน)` / Cr 2100 `เจ้าหนี้การค้า`** at cost;
supplier may be null. Source: mig `20260809001900_spec178b6a_store_gl_posting.sql`.*

### 2.3 Purchasing worklist — `/requests`

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 8 | **Receive PO lines** | `receive_po_lines` **DEFINER**: role ∈ (site_admin, pm, super, director, procurement, procurement_manager). | `purchase_requests` (delivered) | **GL** on receipt |

### 2.4 Equipment — `/equipment`

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 11 | **Equipment movement** | `equipment_movements` INSERT **RLS**: role ∈ (site_admin, pm, procurement*, super, director) AND `created_by = auth.uid()`. **No project scope.** *(See §5 F3.)* | `equipment_movements` | — |
| 12 | **Equipment check-out/in** | `check_out_equipment` / `check_in_equipment` **DEFINER**: role ∈ (site_admin, pm, director, procurement*, super). Role-only, **no WP scope.** *(See §5 F3.)* | `equipment_usage_logs` | — |

### 2.5 Daily plan — `/sa/plan` (ปิดวัน) and the project schedule

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 13 | **Plan writes** (add / remove / note / reorder / set-crew) | All route through `daily_work_plan_assert_writer(project)`: role ∈ (site_admin, pm, director, super, site_owner) AND `can_see_project`. Plan tables are **SELECT-only RLS**; writes are DEFINER-only. | `daily_work_plans` / `_items` / `_crew` | — |

### 2.6 Crew roster — `/sa/crew`

| # | Workflow | Live gate | Target table(s) | GL? |
| - | -------- | --------- | --------------- | --- |
| 14 | **Add project worker** | `sa_add_project_worker` **DEFINER**: role ∈ (site_admin, super) AND `can_see_project`. Creates a login-less worker: `day_rate = 0`, `user_id = null`, `tax_id = national_id`, **no money columns**; Thai national-ID + age-18 validated. | `workers` + `worker_project_moves` + `audit_log` | — |

### 2.7 Direct-table writes beyond the 14 (F5)

SA also holds these non-money, `created_by`-stamped write grants (add to any
"full SA write surface" list):

| Table | Ops | Note |
| ----- | --- | ---- |
| `contractors` | INSERT + UPDATE | vendor master (supplier/subcon records) |
| `purchase_order_attachments` | INSERT | attach docs to a PO |
| `purchase_request_attachments` | INSERT | attach receipt/photo to a PR (the expense-evidence path) |

---

## 3. Authority model — how SA writes are enforced

**The key truth: SA write-authority is enforced in the database, not in
TypeScript.** Every SA write lands through one of three DB-level mechanisms;
the server actions are **thin relays** that validate input shape (UUID/number),
call the mechanism, and map error codes. A server action holds no authority of
its own — so a stale TS comment (e.g. `store/actions.ts` calling the stock-in
gate "BACK_OFFICE") does not change what SA can do. The live gate is the truth.

**Three enforcement shapes:**

1. **`SECURITY DEFINER` RPC** — the gate is `role in (...)` + `can_see_project` /
   `can_see_wp` inside the function body, run as the definer with `search_path`
   pinned. Covers: `issue_stock`, `record_stock_in`, `record_stock_count`,
   `return_stock_to_store`, `receive_po_lines`, `site_purchase_use_now`,
   `record_site_purchase`, `reopen_work_package_for_defect`, `log_labor_day`,
   `check_out/in_equipment`, the daily-plan writers, `sa_add_project_worker`.

2. **RLS INSERT policy** — the gate is the table's `WITH CHECK` (role +
   `can_see_*` + `created_by`/`uploaded_by = auth.uid()`). Covers: `photo_logs`,
   `purchase_requests`, `equipment_movements`, `contractors`, the `*_attachments`.

3. **Service-role admin client** — the two **WP status flips**:
   During-photo → `in_progress`, and submit → `pending_approval`. SA is
   **excluded from `work_packages` UPDATE at the RLS layer**, so the transition
   is performed by the trusted server action via `createAdminClient()` **after**
   it gates the caller (`requireActionRole` + membership) and with a SQL
   `.eq('status', …)` / `.in('status', TRANSITIONABLE_FROM)` guard as a second
   layer. SA never gets direct UPDATE on `work_packages`.
   *S2-confirmed (a): During→`in_progress` uses the admin client —
   `src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts:207`
   (`const admin = createAdminClient()`), `.update({status:'in_progress'})
   .eq('status','not_started')` at `:208–213`; import at `:37`. FB2 removed the
   after-photo auto-flip; submit is now the explicit `submitWorkPackageForApproval`,
   which uses the admin client the same way (`:277–280`).*

**SA is GL-consequential — but only through the store.** By the store-first /
SA-custody doctrine the SA is the on-site storekeeper, so รับเข้า
(`record_stock_in`), เบิก (`issue_stock`), count, return, and
`site_purchase_use_now` **post to the statutory GL by design** (async outbox,
spec 149 / ADR 0057). Receipt = **Dr 1500 Inventory / Cr 2100 AP**; issue =
**Dr 1400 WIP / Cr 1500 Inventory**; both at cost. This is intended: the physical
custody chain *is* the accounting event. Crucially, the SA does **not** touch any
money table directly and cannot post a journal, adjust an account, or pay a wage
— the GL rows are a downstream, **service-role-drained** consequence of a physical
stock movement, never a direct SA write.

**Money sweep (S1): PASS.** No SA write path reaches any money / journal / wage /
payroll table; the reports SELECT explicitly excludes SA; the gate helpers have
no coalesce / self-check trap (cf. the RLS self-check coalesce hazard).

---

## 4. Read-only and blocked

### 4.1 Read-only for SA

| Surface | Live gate | SA can |
| ------- | --------- | ------ |
| `/sa/registrations` | `can_see_staff_registration` — SA sees `status='pending'` only; **no INSERT/UPDATE**; the approve/reject RPC excludes SA. | read pending only |
| Site team board | `project_site_management(p_project)` **DEFINER pure SELECT**, gated `can_see_project`. | read |
| `/dashboard` | money-free portfolio overview (`DASHBOARD_VIEW_ROLES`). | read |
| Store P&L | `store_pnl` — super_admin / project_director only. | **no** |

### 4.2 Blocked (SA is out)

| Capability | Gate that excludes SA |
| ---------- | --------------------- |
| Wage payment | `record_wage_payment` + all GL / journal / wage / payroll / accounting tables — RLS on, **zero policies**, DEFINER-only. |
| Worker master / rates | `create_worker` / `update_worker` / `set_worker_day_rate` — `is_back_office`. |
| Registration review | `approve_staff_registration` / `reject_staff_registration` — procurement_manager, project_director, super_admin. |
| Void / cancel | `void_purchase_order` / `void_charge` / PR-cancel — procurement_manager tier. |
| Store P&L (margin) | super_admin / project_director only. |

---

## 5. Findings appendix

Recorded factually. "Real?" = whether it is a genuine gap vs. working-as-designed.
The ranked fix decision (effort, danger-path, order) is in the S2 session report.

| ID | Sev | Finding | Live truth | Real? |
| -- | --- | ------- | ---------- | ----- |
| **F1** | MED | `record_stock_in` admits `site_admin` (spec 197 U1, on-site storekeeper) → `stock_receipts` → enqueues GL posting. | Confirmed: gate admits site_admin; **project-scoped** (`can_see_project`); SA-reachable from the SA-home store tile. A prior map said "blocked" — that is **false vs live**. | **Not a bug** — intended (SA is GL-consequential via the store). Action = correct the map. |
| **F2** | MED | `record_site_purchase` is **role-only** — it lacks `can_see_project` / `can_see_wp`, while its siblings `site_purchase_use_now` and `issue_stock` both scope. | Confirmed: gate is role + WP-exists only. Any SA can file a `site_purchased` expense (with amount, and an Input-VAT 1300 split if VAT) against **any** WP in **any** project, including one they are not a member of. The UI mounts it on member WP-detail, but the RPC accepts any `workPackageId`. | **Yes — the real bug.** Cross-project write of a money-bearing expense row. |
| **F3** | LOW | Equipment `check_out/in` + `equipment_movements` are role-gated only. | Confirmed: no project / WP-membership scope on either. | Minor — equipment is a cross-project pool; low blast radius, but inconsistent with the store gates. |
| **F4** | LOW | Storage `'photos'` INSERT is role-only. | Confirmed: no path / WP scope on the bucket policy; the **scoped** truth is the `photo_logs` row (which is `can_see_wp` + `uploaded_by = uid`). | Minor — the authoritative record is scoped; the bare object is not. |
| **F5** | obs | SA direct-table write surface is broader than the 14-workflow map. | Confirmed: `contractors` (INSERT + UPDATE), `purchase_order_attachments` (INSERT), `purchase_request_attachments` (INSERT) — all non-money, `created_by`-stamped. | Not a bug — completeness note. Add to the map (§2.7). |

### Map-vs-reality gaps (from the prior code-read map)

- **Daily report (spec 212) is unbuilt for SA.** The SA daily-report surface
  named in earlier notes is not shipped; `/sa/plan` (ปิดวัน) is the current
  end-of-day surface. Working-as-designed; the report layer is backlog.
- **Store tile copy "รับเข้า · เบิก" is CORRECT.** An earlier gap flagged the SA
  store tile as over-claiming รับเข้า. Per F1, SA **can** รับเข้า — so the tile is
  accurate and the earlier gap is **void**.
- **Registration review is read-only by design.** SA sees pending registrations
  but cannot approve/reject (that is procurement_manager / project_director /
  super_admin). Working-as-designed, not a gap.

### F3 resolution (2026-07-10)

`check_out_equipment` / `check_in_equipment` are now **membership-gated** (role-narrowed `can_see_wp` for `site_admin`/`project_manager`, placed after the WP-existence check) — PR #430, migration `075590`. `equipment_movements` is left **pool-level (ungated)** by operator decision: it is the shared-pool custody log with no money column and low blast radius (F3 = LOW).

---

*Verified vs live prod DB (S1); code confirmations + authorship (S2). This is a
point-in-time snapshot: the live database and running app outrank this document —
re-verify a gate against the live RPC/RLS before acting on it.*
