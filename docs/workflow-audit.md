# Workflow audit (2026-06-21)

A coverage map of the app's business workflows — what's built, what's gated,
what's missing. Grounded in the live route tree (40 page routes) + the DB
function surface (~120 RPCs) as of 2026-06-21. Pairs with
`docs/beta-readiness-checklist.md` (the beta is the **core-ops** subset below).

**Legend:** ✅ built & beta-ready · 🟡 partial / needs config · 🔒 built but
gated off for beta · ⛔ not built / blocked · 📐 design-only

---

## A. Core ops — the beta surface

| Workflow                    | Status | Notes                                                                                                                                     |
| --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| LINE login / sessions       | ✅     | incl. PWA device-code handoff re-login                                                                                                    |
| Role promotion / user admin | 🟡     | **SQL-only — no in-app admin UI** (v2; ADR 0010)                                                                                          |
| Project setup               | ✅     | create, onboarding checklist, status change (active/on-hold/completed/archived), suggest code                                             |
| Project team / membership   | ✅     | in-app add/remove; **required** — visibility is membership-scoped (spec 143)                                                              |
| WP seeding                  | ✅     | manual · paste (163) · template · copy-project · CSV                                                                                      |
| WP lifecycle                | ✅     | rename, delete-empty, priority, schedule, notes, contractor, dependencies, defect-rework reopen, closed-project lock                      |
| งวดงาน (deliverables)       | ✅     | create/paste, bulk-map + ungrouped funnel, reorder, rename, detail page, delete + remove-งาน — **billing/amount link not built (165 U5)** |
| Field photo capture         | ✅     | Before/During/After, offline queue, client downscale, markup, filmstrip, lightbox, tombstone-supersede                                    |
| Approval                    | ✅     | pending→approve/revise, decision history, defect reopen                                                                                   |
| Labor capture               | ✅     | daily log, correct (supersede), cost freeze                                                                                               |
| Purchasing                  | ✅     | PR → review → purchase/site → PO → partial-delivery split; suppliers, attachments, AppSheet writer                                        |
| Deliveries                  | ✅     | first-class (135), dispatch, branching tracker — ⛔ Lalamove parked                                                                       |
| Reports (PDF)               | 🟡     | async generate + stale-reaper OK; **per-WP only — NOT งวด-grouped (spec 04 ph3), no watermark, no curation**                              |
| Schedule (Gantt)            | ✅     | `/schedule`                                                                                                                               |
| Contacts                    | ✅     | customers / vendors / crews + docs + bank                                                                                                 |
| Workers registry            | ✅     | create/update, day-rate, level, project assign, crew assignments                                                                          |
| Dashboard                   | ✅     | role-aware overview                                                                                                                       |

## B. Back-office / money — built but gated or unconfigured

| Workflow                                                                                 | Status  | Notes                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GL accounting (double-entry, billing งวด, retention, WHT, trial balance, reconciliation) | 🔒 + 🟡 | fully built + auto-posting (async outbox); **gated off for beta (166)**; needs accountant config (COA / WHT / revenue rule) before real use                                            |
| Payroll / DC payment                                                                     | 🟡      | wage summary + CSV ✅; DC payment ledger + GL post ✅; **⛔ bank auto-disbursement (K BIZ, 128) blocked on operator sample**                                                           |
| Equipment                                                                                | 🟡      | registry, movements, check-out/in, usage logs ✅; rental-money backend ✅ (rates/batches/allocations/wp_equipment_sell); full money UI flow partial                                    |
| Nova coin economy                                                                        | 🔒 📐   | full engine (settle/distribute/vesting/shop/clawback/dials) + operator UI ✅; **operator-only, dials are seeded placeholders (uncalibrated), no worker-facing UI** (gift-first, later) |

## C. External / integrations

| Workflow                 | Status | Notes                                                                                                                |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------- |
| Contractor (DC) portal   | ✅     | external role, LINE claim, scoped money, consent, bank-change — 🟡 operator upload smoke pending                     |
| LINE notifications       | 🟡     | outbox + drain built; **DORMANT until operator activates** (Messaging API channel + Vercel env + Vault — go-live §8) |
| PEAK accounting sync     | ⛔     | `enqueue_peak_sync` infra only; U2–4 blocked on PEAK UAT creds + accountant mapping                                  |
| Client / customer portal | ⛔     | not built (future)                                                                                                   |

## D. Platform / ops

|                                    | Status | Notes                                                                                           |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Backups                            | ✅     | Supabase Pro daily (2026-06-21); **restore drill not yet run** (`docs/backup-restore-drill.md`) |
| In-app user/role admin             | ⛔     | promotion SQL-only (v2)                                                                         |
| Worker-ecosystem / self-governance | 📐     | design-only (ADR 0060 / 0061); economic engine designed, not live to workers                    |

---

## What is NOT there — the headline gaps

1. **Reports grouped by งวด** — still per-WP. The งวด data + UI exist, but the PDF
   layout doesn't group by deliverable (spec 04 phase 3, not built). The one
   core-surface gap a beta PM would actually notice.
2. **งวด ↔ billing money link** — deferred to design (165 U5).
3. **In-app user/role management** — promotion is SQL-only.
4. **DC bank auto-pay** (blocked on K BIZ sample) and **PEAK sync** (blocked on creds).
5. **Nova** — uncalibrated dials + no worker-facing UI; **client portal** not built.
6. Polish: photo watermark, report image curation, multi-project reports.

## Beta implication

None of the gaps block a **core-ops beta** — they are gated (GL/Nova),
dormant-by-choice (LINE notif), back-office (PEAK/bank), or polish (report
grouping). Consider before beta: **reports are per-WP, not งวด-grouped** — if beta
PMs expect client-facing reports organised by งวด, flag it or build spec 04 ph3.
