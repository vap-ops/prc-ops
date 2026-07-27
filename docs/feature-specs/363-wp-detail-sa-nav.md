# Spec 363 — WP detail: the site admin's navigation

**Status:** DRAFT — design agreed with the operator 2026-07-26/27, not yet planned or built.
**Origin:** operator directive, seven points, 2026-07-26.
**Sibling:** zones + per-zone photo relevance (points 6 and 7) split out as **spec 366** — greenfield, designed separately. This spec leaves the seam and ships nothing zone-shaped.

---

## 1. Why

The work-package detail page is where the site admin's day happens, and its navigation has accreted one tab per feature rather than one tab per job. A `site_admin` today sees six:

`รูปถ่าย | คำขอซื้อ | เบิกของ | ค่าใช้จ่ายหน้างาน | แรงงาน | ข้อมูล`

Measured on prod 2026-07-27, rows authored by users with `role='site_admin'`, last 30 days:

| tab               | SA writes / 30d                                                                                                                                                    | table                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| รูปถ่าย           | **2031**                                                                                                                                                           | `photo_logs`                               |
| คำขอซื้อ          | **143** — SA-authored PRs total 153, of which 149 are `source='app'` and **143 of those carry `requested_from_work_package_id`**, i.e. were created from this page | `purchase_requests`                        |
| เบิกของ           | 32 (all-time, across **5 distinct WPs**)                                                                                                                           | `stock_issues`                             |
| ค่าใช้จ่ายหน้างาน | 4 (90 d), **0 of which carry any attachment**                                                                                                                      | `purchase_requests source='site_purchase'` |
| แรงงาน            | **0 all-time**, muster-derived rows included                                                                                                                       | `labor_logs`                               |
| ข้อมูล            | read surface                                                                                                                                                       | `work_packages.notes`, `approvals`         |

One tab carries 93% of the writes and one has never been written to. The tab strip that switches them is **not sticky** — verified in [`wp-detail-tabs.tsx`](../../src/components/features/work-packages/wp-detail-tabs.tsx), which renders a plain bordered row — so it scrolls away once the SA is inside the capture zone. Above it sit a header, a walk bar, a progress bar, an attention stack, and up to four separately-rendered action rows.

⚠️ **Geometry is asserted, not measured.** "Starts below the fold at 375 px" and "three Thai labels fit without scrolling" are design judgments: this build box cannot measure rendered layout (the browser wedge reports every element 0×0 — see PR #774). The operator's eye on a real phone is the check, and both claims should be confirmed there before U4/U5 are called done.

Two further facts shape the design:

- **The เบิก path is barely born.** 32 withdrawals ever, on 5 WPs, against 143 purchase requests in 30 days. `stock_returns` is a real table with a working UI ([`wp-issue-stock.tsx`](../../src/components/features/store/wp-issue-stock.tsx)) and **zero rows ever** — offcuts are not coming back to the store.
- **Equipment is entirely untracked in the field.** `equipment_items` = 64 (63 `available`, 1 `on_site`; 55 unit-tracked, 9 bulk), `equipment_project_allocations` = 32, and `equipment_usage_logs` = **0**, because spec 202 U2 — the check-out/check-in surface — was specced 2026-06-25 and never built. The RPCs `check_out_equipment` / `check_in_equipment` are live and callable.

## 2. Decisions (operator-locked)

| #      | Decision                                                                                                                                                | Rationale                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | The SA tab set becomes three: **`รูปถ่าย` · `ของ` · `ประวัติ`**                                                                                         | Three Thai labels fit 375 px with no horizontal scroll; every remaining tab has live traffic.                                                                                 |
| **D2** | `ข้อมูล` is deleted; the header ⓘ sheet absorbs `หมายเหตุ` and renders **unconditionally**                                                              | Today the ⓘ only renders when a contractor or a description exists, so notes would otherwise become unreachable on a bare WP.                                                 |
| **D3** | `ประวัติ` is a timeline of what happened, built with a **plan lane that renders nothing**                                                               | Operator call 2026-07-27: no dates on the SA screen yet. The row model reserves a plan marker so the lane is an addition later, not a rebuild.                                |
| **D4** | `แรงงาน` leaves the SA tab set, and **stays on the planner's `จัดการ`**                                                                                 | 0 rows today, but spec 306 U5a's `derive_muster_labor` writes there once close-day adoption starts. Removing it everywhere would strip the planner's only view of that money. |
| **D5** | `ของ` is **item-first, not path-first**: one primary action `ต้องการของ` over one state-grouped list. The store's stock decides which action is primary | The SA's state is "I need ปูน". Withdraw-vs-request-vs-self-buy is the firm's ledger taxonomy, and the app already knows the shelf.                                           |
| **D6** | Equipment keeps **its own entry** at the foot of the `ของ` tab — not a chip, not a merged search                                                        | Avoids a picker spanning `catalog_items` ∪ `equipment_items`, and avoids presenting an empty surface as a co-equal destination.                                               |
| **D7** | **No `กำหนดส่ง`, no lateness** on the SA screen in this spec                                                                                            | 220 of 350 leaf WPs (63%) are already past `planned_end` with one baseline captured; the operator declined to display it until the plan is known to be trustworthy.           |
| **D8** | Zones are **spec 366**                                                                                                                                  | Independent subsystem: zone model, per-WP simplified drawing, polygon authoring, zone binding on capture.                                                                     |

### D5 in detail — how the shelf picks the path

`ต้องการของ` opens a sheet: search `catalog_items` (scoped by the WP's `หมวดงาน`, keeping the spec 229/297 soft-scope and off-category warning) → pick an item → the sheet shows on-hand and offers, in order:

| shelf state       | primary         | secondary                     |
| ----------------- | --------------- | ----------------------------- |
| `qty_on_hand` > 0 | **เบิกจากคลัง** | `ขอซื้อแทน` · `ซื้อมาเองแล้ว` |
| `qty_on_hand` = 0 | **ขอซื้อ**      | `ซื้อมาเองแล้ว`               |

`ซื้อมาเองแล้ว` is permanently secondary: it records money that has already left, so its position states the firm's order of preference without ever blocking it. This is a stronger reading of the operator's "เบิก first" answer than a default chip — store-first becomes the path of least resistance rather than a default the SA must notice.

### D5 in detail — the list

One list, grouped by state, newest group first:

- **`รออนุมัติ`** — purchase requests for this WP that have not arrived (`requested` · `approved` · `shipped`), each with its status pill. From the SA's side a requested item is already "stuff for this WP", just not here yet.
- **`อยู่ที่งานนี้`** — `stock_issues` net of `stock_returns`, plus equipment currently checked out (aging: "ยืม 9 วัน").
- **`คืนแล้ว`** — collapsed group.

Kind is a per-row icon; path is a per-row state. Neither is a level of navigation. `คืนของ` for material moves into the row's detail (0 returns ever — a rare action does not get list-level real estate); `คืน` stays inline on equipment, because a borrowed tool is an open obligation with a clock.

## 3. Units

Dependency-ordered. Each ships on its own.

| U      | Ships                                                                                                                                                                  | DB? | Notes                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **U1** | ⓘ sheet absorbs `หมายเหตุ`; the button renders unconditionally. **ADDITIVE ONLY — the `ข้อมูล` tab survives**, thinned to `ประวัติการตรวจ` alone, and is deleted by U2 | No  | Touches `work-package-info-button.tsx`, the page's tab array                                                                                                                                                 |
| **U2** | `ประวัติ` tab — one reverse-chronological timeline with day headers and filter chips (`ทั้งหมด · รูป · ตรวจ · ของ · สถานะ`)                                            | No  | See §4                                                                                                                                                                                                       |
| **U3** | `แรงงาน` off the SA tab set; unchanged for `isManagerRole`                                                                                                             | No  | `LABOR_TAB_LABEL` stays — the planner still renders it                                                                                                                                                       |
| **U4** | `ของ` tab: `ต้องการของ` sheet + the state-grouped list; `คำขอซื้อ`, `เบิกของ`, `ค่าใช้จ่ายหน้างาน` tabs deleted                                                        | No  | The three existing forms are re-composed, not rewritten — see §5                                                                                                                                             |
| **U5** | Sticky tab strip + one state-driven bottom action bar absorbing `ส่งงานเข้าตรวจ` / `ถอนงานกลับมาแก้ไข` / `ส่งตรวจอีกครั้ง` / `แจ้งข้อบกพร่อง`                          | No  | State machine shaped like `src/lib/muster/close-day-state.ts`                                                                                                                                                |
| **U6** | Self-purchase evidence: wire the `payment` purpose (slip) alongside `reference` (item photo) and `invoice` (receipt); uploaders reachable **before** save              | No  | Fixes a 0-of-4 fill rate                                                                                                                                                                                     |
| **U7** | `เครื่องมือ` section: tools currently out with aging, `ยืมเครื่องมือ`, `คืน` — activating spec 202 U2                                                                  | No  | RPCs verified live 2026-07-27: `check_out_equipment(p_item uuid, p_wp uuid, p_date date)` · `check_in_equipment(p_log uuid, p_date date)` — re-check before building, a signature is a contract not a memory |

**Order: U1 → U3 → U2 → U4 → U5 → U6 → U7.**

⚠️ **U2 must precede U4/U5, and U1 must not delete `ข้อมูล`** — corrected 2026-07-27, before any build. `ประวัติการตรวจ` renders ONLY inside the `ข้อมูล` panel (`page.tsx:747`); the attention card carries just the LATEST decision (`:945`). So the original order had U1 deleting the SA's only route to review history four units before U2 re-homed it — a half that removes a signal without adding one. U1 is now additive (the ⓘ gains notes, the tab thins), and **U2 owns the `ข้อมูล` deletion** because U2's timeline is what re-homes the history. Cheap structure first; the 93%-traffic camera path (U5) touched only once the merge is field-proven; the only genuine new build (U7) last. **U4 is additionally gated on open question 1 (PR amount visibility).**

## 4. U2 — the timeline

Sources, all existing:

| source                                           | rows                    | note                                                                                                                                                        |
| ------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_log` where `target_table='work_packages'` | 559 / 30 d              | **`action` is `'other'` on every row** — the timeline must key on `payload.event` (`wp_status_transition`, with `from_status`, `to_status`, `rework_round`) |
| `approvals`                                      | —                       | decision + `revision_reason` + comment, rendered **inline**                                                                                                 |
| `photo_logs`                                     | 2031 / 30 d SA-authored | **collapsed**: one row per phase per day with a count and a time span, expanding to thumbnails                                                              |
| `purchase_requests`                              | —                       | created · decided · delivered                                                                                                                               |
| `stock_issues` / `stock_returns`                 | 32 / 0                  |                                                                                                                                                             |
| `equipment_usage_logs`                           | 0                       | check-out / check-in, once U7 ships                                                                                                                         |

Two decisions carry the tab:

- **Photo bursts collapse.** One row per photo would bury every decision and every withdrawal on exactly the WPs that get the most work.
- **Decision comments render inline.** "รูปที่ 3–5 เป็นห้องอื่น" is the single most useful line in the tab for an SA, and today it sits inside a collapsed `<details>` in `ข้อมูล`. This is why `ประวัติ` earns a tab instead of joining the ⓘ sheet.

Row model — one shape, so the plan lane is an addition:

```ts
type WpTimelineRow = {
  at: string; // ISO
  kind: "status" | "decision" | "photos" | "request" | "issue" | "return" | "equipment";
  actor: string | null; // display name
  body: ReactNode;
};
```

A plan marker (`planned_start` / `planned_end`) is another `kind`; a variance lane is a second rail. Per **D7** neither renders in this spec. Spec 271 U2a's variance pills land here when the operator decides the baseline is trustworthy.

## 5. Why U4 is cheaper than it looks

`PurchaseRequestForm`, `SelfPurchaseSection` and `WpIssueStock` are all fed from the page's single `loadWorkPackageDetail` fetch and all three already take `catalogItems` + `categories`. Their prop sets are **not identical** — `PurchaseRequestForm` additionally takes `scopedCategoryIds` and `membershipsByItem`, `WpIssueStock` takes `membershipsByItem` and `scopedRelation`, and `SelfPurchaseSection` takes neither. Unifying the picker means giving the shared component the **superset**, which is a real (small) change to the self-purchase branch's scoping behaviour and must be decided deliberately rather than inherited by accident.

`ต้องการของ` is therefore **one picker routing into three existing write paths**, not a new one. Two behaviours must survive the re-composition:

1. The WP `หมวดงาน` soft-scope and the off-category warning (spec 229 / 297).
2. The self-purchase evidence gate (U6) — which becomes the natural end of the `ซื้อมาเองแล้ว` branch.

## 6. Money posture

- Material cost **stays visible** to the SA: `ต้นทุน ฿/หน่วย` already renders in the เบิก picker ([`wp-issue-stock.tsx`](../../src/components/features/store/wp-issue-stock.tsx)).
- Equipment `daily_rate` / `daily_rate_snapshot` **never renders** on any of these surfaces — ADR 0055 decision 6 and spec 202 bind it to the money audience, admin-client-read only. U7's surface is rate-free by construction.
- Whether a purchase request's **amount** may render to a `site_admin`: **RESOLVED 2026-07-27 — it does not**, and this is the existing posture rather than a new rule. `PurchaseRequestCard` renders no amount at all, and `/requests/[requestId]` gates every money field on `isBackOfficeRole`, whose source comment states plainly that `site_admin` is excluded. U4 inherits the rule; **U4 is not blocked on this.**

## 7. Non-goals

- Zones, drawings, polygon pickers, per-zone photo relevance — spec 366.
- Any change to the planner (`isManagerRole`) tab set beyond keeping `แรงงาน`.
- Any change to `readOnly` (procurement) rendering.
- Plan dates, lateness, or variance display on the SA screen (D7).
- New photo capture behaviour. `PhotoCaptureZone` moves as-is.
- **Coin-denominated execution budget** (operator idea, 2026-07-27). Out of scope and deliberately not foreclosed. ADR 0060 locks the Nova coin as abstract points with **no baht peg**; pricing a WP's budget in coins would create that peg, so it is an ADR revision, not a feature. It is also blocked on cost capture: `labor_logs` 0, `equipment_usage_logs` 0, `stock_returns` 0, `stock_issues` 32 — a coin budget today would display a burn figure that is mostly fiction. **U4, U6 and U7 are the units that close those gaps, so this spec moves toward the option rather than away from it**, and U2's `{at, kind, actor, body}` row model takes a `budget` kind without a rebuild. **The one guard that keeps the door cheap: U4 must render every price through `src/lib/format.ts`** (the money-format SSOT) and never inline a baht string — a later coin display is then one file, not every call site.

## 8. Open questions

1. **PR amount visibility to `site_admin`.** Left off every mockup deliberately rather than assumed. Must be settled against the live read path before U4.
2. ~~**`ประวัติ` vs `บันทึก`** as the tab term.~~ **RESOLVED 2026-07-27 → `ประวัติ`.** `บันทึก` is the app's SAVE verb in 11+ existing labels (`LABOR_RATE_SAVE_LABEL`, `SITE_EXPENSE_SUBMIT`, `RECEIPT_CORRECTION_SAVE_LABEL`, …), so a tab named with it collides with the button users press to save. Precedent for the chosen form: `ATTENDANCE_AUDIT_LABEL = "ประวัติการเช็คชื่อ"`, whose comment exists to separate the act from its history.
3. **Does the `ของ` default bet pay?** Re-query `stock_issues` and SA-authored `purchase_requests` two weeks after U4 ships. If withdrawals stay near 32/30 d, the shelf does not hold what the WPs need and the doctrine — not the nav — is what needs revisiting.
4. **Bulk vs unit equipment.** 9 of 64 items are `tracking='bulk'`; U7 must decide whether a bulk item checks out by quantity or is excluded from the field surface.
5. **`แรงงาน` removal scope — an assumption, not a directive.** The operator said "remove แรงงาน" without qualifying the audience; **D4 narrows that to the SA tab set only** because `derive_muster_labor` (spec 306 U5a) will write `labor_logs` once close-day adoption starts, and the planner's `จัดการ` tab is the only place those rows surface. **RESOLVED 2026-07-27 — SA-only, D4 stands as written.**

## 9. Guard-trip checklist

Per the `prc-ops-guard-trip-map` memory: this spec touches `labels.ts` (term SSOT — serialize against live lanes), the WP detail `page.tsx` (page-guard), the component-folder guard for anything new under `src/components/features/**`, and the settings/section guards if the ⓘ sheet gains a section. `SITE_EXPENSE_TAB_LABEL` loses its only consumer in U4 and must be removed or re-pointed rather than left orphaned.

## 10. Evidence appendix

All figures measured on prod 2026-07-27 via `pnpm exec supabase db query --linked`.

```sql
-- SA-authored writes by surface, 30 d
with sa as (select id from public.users where role='site_admin')
select 'photo_logs', count(*) from public.photo_logs
  where uploaded_by in (select id from sa) and created_at > now()-interval '30 days'
union all select 'purchase_requests', count(*) from public.purchase_requests
  where requested_by in (select id from sa) and created_at > now()-interval '30 days'
union all select 'stock_issues', count(*) from public.stock_issues
  where issued_by in (select id from sa) and created_at > now()-interval '30 days'
union all select 'labor_logs', count(*) from public.labor_logs
  where entered_by in (select id from sa) and created_at > now()-interval '30 days';

-- where SA purchase requests are created from
select source, count(*), count(requested_from_work_package_id) from public.purchase_requests
 where requested_by in (select id from public.users where role='site_admin')
   and created_at > now()-interval '30 days' group by 1;

-- self-purchase evidence fill (returned NONE for all four rows)
select pr.pr_number, string_agg(a.purpose::text,'+') from public.purchase_requests pr
  left join public.purchase_request_attachments a on a.purchase_request_id = pr.id
 where pr.source='site_purchase' group by pr.id, pr.pr_number;

-- plan fill and variance (D7 context)
select count(*) filter (where planned_end is not null),
       count(*) filter (where planned_end < current_date and status <> 'complete')
  from public.work_packages where is_group = false;
```

Results as of that date: photos 2031 · PRs 153 (149 `app` of which 143 from the WP page, 4 `site_purchase`) · issues 32 · labor 0 · self-purchase evidence 0/4 · leaf WPs 350, with `planned_start` and `planned_end` 331, past due and open 220 · `plan_baselines` 1 / `plan_baseline_items` 331 · `equipment_usage_logs` 0.
