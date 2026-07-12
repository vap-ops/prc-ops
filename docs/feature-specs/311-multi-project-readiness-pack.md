# Spec 311 — Multi-project readiness pack

**Status:** approved (operator "go" 2026-07-12 on the multi-project readiness audit fix-pack)
**Source:** multi-project readiness audit 2026-07-12 (27-agent adversarially-verified sweep + live DB probes; findings in memory `multi-project-readiness-audit-2026-07`). Prod runs 1 active project today; 2–3 concurrent actives are imminent. Every unit here closes a confirmed finding that breaks, leaks, or confuses at ≥2 actives.

## Why

The app's foundation is multi-project by design (per-project stores, WP→project scoping, portfolio dashboard, spec-292 SA switcher). The audit confirmed a small set of residual single-project assumptions. This pack closes the pre-project-#2 punch list. Out of scope (own follow-ups): the shared-worker model decision, wage_payments full project dimension, muster U3 cross-project scan rule — all operator-gated.

## Units

### U1 — /requests site-branch project context (code-only)

**Finding:** the non-procurement /requests branch (site_admin, project_manager, project_director, super_admin) merges purchase requests AND the กำลังจัดส่ง incoming band across every visible project with no project label and no filter. `loadProjectNames` early-returns an empty map for site roles (`load-requests-data.ts` #7, spec 110/301f), so `PurchaseRequestCard`'s existing `projectName` line never renders; the `?project=` axis is parsed but only applied in the procurement branch.

**Change (exactly this):**

1. `src/lib/purchasing/load-requests-data.ts` — `loadProjectNames` loads for **every role** (drop the `isProcurement` early return). Same single `.in()` read on the user client; RLS scopes which names resolve.
2. `src/app/requests/page.tsx`:
   - `projectOptions` computed for all roles (was procurement-only).
   - Site branch: apply `filter.projectId` (the existing `?project=` param) by narrowing the rows fed to `groupRequestsByBand` to `r.project_id === filter.projectId`.
   - Site branch UI: a project chip row (`worklistChipClass` idiom, like the view/mine chips) rendered **only when `projectOptions.length > 1`**: a ทุกโครงการ chip + one chip per project, `aria-current` on the active one. `reqHref` carries the `project` axis so view/mine/incoming links preserve it.
   - Card project label (both branches): pass `projectName` **only when the loaded rows span >1 distinct project** (`projectOptions.length > 1`). This supersedes spec 301f's procurement-only lean-card rule: the chip appears exactly when disambiguation is needed, for every role, and stays hidden in a single-project world.
3. `src/lib/i18n/labels.ts` — new SSOT constants `ALL_PROJECTS_OPTION_LABEL` ("ทุกโครงการ") and `PROJECT_FILTER_ARIA` ("กรองตามโครงการ"); the new chip row uses both; `procurement-filters.tsx` swaps its inline aria string for the constant (2nd usage → SSOT rule). (The accounting page's inline ทุกโครงการ is pre-existing — follow-up, not this unit.)

**Not in scope:** changing procurement's filter UI, pagination, the /incoming surface (already per-project), any schema.

**Tests:** flip the `load-requests-data.test.ts` site-role pin (projectNameById now loads) — RED first; new RTL test for the site project chip row (renders only at >1 option, hrefs compose with view/mine/incoming, aria-current); existing card test already covers `projectName` rendering.

**Verify:** full suite + guard suites; browser as dev-preview (super_admin sees >1 project incl. archived-project decided rows → chips + labels appear; filter narrows bands).

### U2 — membership gates on labor money RPCs (schema, mig `075770`)

**Finding:** `log_labor_day` (mig 073400) and `correct_labor_log` (mig 071700) are SECURITY DEFINER money writes gated on role only — a site_admin/PM member of only project A can write/supersede/tombstone labor onto project B's WP. `receive_po_lines` (mig 002700) same gap (stock, not money). All siblings check `can_see_wp`/`can_see_project`.

**Change:** one migration `075770`: `create or replace` the three functions adding, after the existence lookup, `if not public.can_see_wp(<wp>) then raise exception ... using errcode='42501'`. For `receive_po_lines`, gate on the delivery's project via `can_see_project`. NO signature changes, NO behavior change for authorized callers. pgTAP: new file `311-multi-project-gates` with two-project isolation asserts (member-of-A blocked on B's WP, allowed on A's; super_admin/director unaffected) — RED first (asserts fail against live defs), GREEN after push.

### U3 — mixed-project PO basket guard (schema, next watermark after 075770)

**Finding:** `create_purchase_order` accepts PR lines spanning projects; basket UI shows no project.

**Change:** migration: in `create_purchase_order`, after loading the lines' PRs, `raise exception` (P0001, Thai message via existing error style) when the lines' `project_id`s (non-null) span >1 distinct project. Code: `validate-create-purchase-order.ts` mirrors the check client-side; basket cards (`phone-po-basket`) show the project name when the visible set spans >1 project (reuse U1's loaded map). pgTAP RED first.

### U4 — rental GL project attribution (schema, money 🔔 operator-merge)

**Finding:** `post_rental_batch_to_gl` + `post_rental_charge_to_gl` debit WIP 1400 with NULL `project_id` (batches carry no project). Live: 7/7 rental WIP lines unattributed, ฿40,260 invisible to per-project P&L.

**Change:** posters resolve the batch's project(s) from `equipment_project_allocations` overlapping the batch period; single allocation → stamp its project on the 1400 leg; multiple → proportional day-split (mirror `post_purchase_order_charge_to_gl`); none → NULL as today. Historic NULL lines untouched (append-only ledger; note for operator). Held for operator merge (money path).

### U5 — /payroll reconciliation guard under project filter (code-only, interim)

**Finding:** spec-309's per-project wage view reconciles against project-blind `wage_payments` → false drift + misattributed "จ่ายแล้ว". Full fix (project dimension on wage_payments) is gated on the shared-worker decision.

**Change:** when the project filter is active, suppress the payment-reconciliation panel (record/paid/drift) and render a one-line note that payment recording is period-wide (label via labels.ts). Zero behavior change on the unfiltered view.

## Order

U1 → U2 → U5 → U3 → U4. Each unit its own branch + PR off latest main; schema units serialize on the migration watermark.
