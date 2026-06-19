# Feature specs — index

One numbered spec per feature unit. The workflow (see `CLAUDE.md`) is: read the
spec for the unit you're told to build **in full**, implement exactly it. This
index is for finding the right spec and tracing related work — not a substitute
for reading the spec itself.

| Spec | Title                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 01   | LINE Login Authentication (+ `01-line-auth-FINDINGS.md`)                                                           |
| 02   | Photos and Approvals                                                                                               |
| 03   | SA Photo Upload UI                                                                                                 |
| 04   | Deliverable grouping in reports                                                                                    |
| 05   | Profile Management (display-name self-edit)                                                                        |
| 06   | AppSheet back-office DB role                                                                                       |
| 07   | `/profile` route (universal display-name reach)                                                                    |
| 08   | LINE profile picture as avatar (self-view MVP)                                                                     |
| 09   | Purchasing — data layer (P1a)                                                                                      |
| 10   | WP-centric purchase requests, mobile form fix, phase relabel                                                       |
| 11   | Deliverable-grouped work-package list (SA project screen)                                                          |
| 12   | `/requests` back navigation + deliverable progress                                                                 |
| 13   | Thai-capable font in the PDF report worker                                                                         |
| 14   | Thai-first UI + UX coherence pass (whole-app upgrade iter 1)                                                       |
| 15   | Purchasing visibility + review ergonomics (iter 2)                                                                 |
| 16   | Purchase-request enrichment: unit picker, needed_by, eta, attachments                                              |
| 17   | App-shell structural refactor (iter 4)                                                                             |
| 18   | UX coherence + PWA installability (iter 5)                                                                         |
| 19   | Bottom tab bar + purchasing-surface consolidation (iter 6)                                                         |
| 20   | Sun-readable redesign: light high-contrast theme + nav identity (iter 8)                                           |
| 21   | Urgency as a colored segmented control                                                                             |
| 22   | Order tracking progress per request (with `on_route` stage)                                                        |
| 23   | Delivery-confirmation photos                                                                                       |
| 24   | Receipt photo on `on_route` completes the delivery                                                                 |
| 27   | Cancellation + PR running number                                                                                   |
| 28   | WP detail redesign: owner/team, attention strip, responsive IA                                                     |
| 31   | Contractor WP owners (replaces spec-28 user-owner UI)                                                              |
| 32   | LINE notification outbox                                                                                           |
| 33   | In-app purchase/shipment recording + suppliers master                                                              |
| 34   | Client-side photo downscale (downscaled file IS the original)                                                      |
| 35   | Offline-tolerant upload queue (WP phase photos)                                                                    |
| 36   | Iteration-9 debt batch                                                                                             |
| 37   | Offline queue for all photo kinds + manual discard                                                                 |
| 38   | Re-skin: Refined Utility + brand band                                                                              |
| 39   | On-demand report generation (+ stale-report reaper)                                                                |
| 40   | Re-skin round 2 (operator feedback on spec 38)                                                                     |
| 41   | Page width unification                                                                                             |
| 42   | PWA standalone LINE re-login (iOS)                                                                                 |
| 43   | Device-code handoff login for the installed PWA                                                                    |
| 44   | Handoff resume hardening (iOS process death)                                                                       |
| 45   | Handoff opens LINE in the same window (no popup)                                                                   |
| 46   | Daily labor capture per Work Package                                                                               |
| 47   | Purchase request detail page                                                                                       |
| 48   | Requester notes on purchase requests                                                                               |
| 49   | Photo filmstrip: horizontal strips replace growing grids                                                           |
| 50   | Lightbox swipe between photos                                                                                      |
| 51   | Photo markup: drawing + comments on WP photos                                                                      |
| 52   | WP status transitions: during → in_progress, manual on-hold toggle                                                 |
| 53   | Refresh button on every content page                                                                               |
| 54   | WP detail redesigned to the operator's mockup                                                                      |
| 55   | Mockup design language, round 2 (remaining detail headers)                                                         |
| 56   | WP list: status filter rework, search removed                                                                      |
| 57   | Long WP names never truncate                                                                                       |
| 58   | Project settings page for back office                                                                              |
| 59   | Site-map audit + one project page                                                                                  |
| 60   | Reports page: detail header + standalone-safe download                                                             |
| 61   | PM control over report content                                                                                     |
| 62   | Headers pinned while scrolling                                                                                     |
| 63   | Consolidate the reusable chrome                                                                                    |
| 64   | Fixed app shell: chrome that cannot drift                                                                          |
| 65   | Consolidation pass (behavior-preserving refactor)                                                                  |
| 66   | Documents have a home; on-site purchases are recordable                                                            |
| 67   | Design-critique remediation (the 9 survivors)                                                                      |
| 68   | Labor P2: cost freeze, PM cost view, close-out variance                                                            |
| 69   | DC payroll export (subcontractor days, per period)                                                                 |
| 70   | Procurement onboarding: the purchasing worklist                                                                    |
| 71   | Notes as backup capture: work-package notes (v1 slice)                                                             |
| 72   | Notes everywhere (program) + Unit 1: shared NotesField + `projects.notes`                                          |
| 73   | Notes everywhere Unit 2: editable purchase-request note                                                            |
| 74   | Notes everywhere Unit 3: labor-day note                                                                            |
| 75   | Notes everywhere Unit 4: worker roster note                                                                        |
| 76   | App-feel slice 1: toast / snackbar system                                                                          |
| 77   | App-feel slice 2: press / active tactile feedback                                                                  |
| 78   | App-feel slice 4: bottom-sheet primitive                                                                           |
| 79   | Project metadata + client information (clients master)                                                             |
| 80   | Project team / supervisors (`project_members`)                                                                     |
| 81   | Contacts management (clients · suppliers · contractors)                                                            |
| 82   | Content-named route namespace (program) + Unit 1: project subtree                                                  |
| 83   | Contacts v2 Unit 1: contractor taxonomy + enrichment + DC backfill                                                 |
| 84   | Contacts v2 Unit 2: suppliers enrichment + service_providers table                                                 |
| 85   | Contacts v2 Unit 3: bank info (money-isolated `contact_bank`)                                                      |
| 86   | Contacts v2 Unit 4: select field primitive + write-action layer                                                    |
| 87   | Contacts v2 Unit 6: list-first UI (5 tabs, add-sheet, status filter)                                               |
| 88   | Contacts v2 Unit 5: contact detail page + bank block                                                               |
| 89   | Contacts v2 Unit 9: blacklist hidden from assignment pickers                                                       |
| 90   | Contacts v2 Unit 8: crew on a contractor's detail page                                                             |
| 91   | Field-First token sweep: whole-app consistency                                                                     |
| 92   | WP schedule + critical path (KANNA-style Gantt)                                                                    |
| 93   | ตั้งค่า (Settings) hub + decluttered nav                                                                           |
| 94   | Detail info sheet: slim headers, ⓘ bottom sheet                                                                    |
| 95   | iOS keyboard repaint guard                                                                                         |
| 96   | Add work photos from the gallery                                                                                   |
| 97   | Contacts v2 Unit 7: contact documents (ID card + bank book)                                                        |
| 98   | Coming-soon menu placeholders (greyed, non-tappable future menus)                                                  |
| 99   | Split Contacts into three groups (customers · vendors · crews)                                                     |
| 100  | ภาพรวม / Dashboard — role-aware overview (progress + budget vs spend)                                              |
| 101  | Procurement depth U1: suppliers screen (inline) + desktop nav                                                      |
| 102  | Procurement depth U2: read-only project visibility (projects SELECT)                                               |
| 103  | Capture the on-site purchase amount (record_site_purchase + p_amount)                                              |
| 104  | Procurement worklist as a buyer's pipeline (band-ordered /requests)                                                |
| 105  | Procurement buyer summary strip (to-order · in-transit · overdue)                                                  |
| 106  | Outstanding-PO ฿ tile on the buyer summary (admin amount read)                                                     |
| 107  | Per-supplier spend chip on the suppliers screen (buyer intelligence)                                               |
| 108  | Procurement desktop grid worklist (Airtable arc, phase 1)                                                          |
| 109  | Procurement record-review sidesheet (Airtable arc, phase 2: row → drawer)                                          |
| 110  | Procurement worklist filters (supplier·project·status·overdue) + priority sort                                     |
| 111  | Compact process mini-bar in the grid status cell (shared order-stage helper)                                       |
| 112  | Band-relative row health color in the grid (buyer time pressure, not priority)                                     |
| 113  | Grid health smoke test + temporary visual preview (review all color cases)                                         |
| 114  | Enrich the review drawer + in-place buyer actions (record/ship/invoice/photo)                                      |
| 115  | Purchase orders — data layer (group tickets into a supplier order; ADR 0044)                                       |
| 116  | Purchase orders: create-PO UI (phase 2)                                                                            |
| 117  | Create-PO UX round (mockup-approved)                                                                               |
| 118  | Phone PO creation: the add-to-PO basket (mockup-approved)                                                          |
| 119  | VAT capture on purchases (phase 1)                                                                                 |
| 120  | Unify purchase recording into PO creation                                                                          |
| 121  | PDF support in purchasing attachments (ADR 0046 Layer A: documents foundation)                                     |
| 122  | Feature components grouped into domain folders (quality-debt; no ADR)                                              |
| 123  | Single source for generated DB types, app ↔ worker (ADR 0047)                                                      |
| 124  | CI: worker job + codified test-tier policy (ADR 0048)                                                              |
| 125  | PO source-document attachments (ADR 0046 Layer B, Unit 1)                                                          |
| 126  | Document-first create-PO surface (ADR 0046 Layer B, Unit 2)                                                        |
| 127  | DC payment recording (close the per-day payroll loop)                                                              |
| 128  | DC payment bank disbursement (KBank) — design                                                                      |
| 129  | PEAK accounting integration (outbound sync)                                                                        |
| 130  | DC self-service portal (external partner tier) — design                                                            |
| 131  | DC onboarding packet (docs · consent · emergency contact)                                                          |
| 132  | DC portal profile self-edit (cashout-scoped)                                                                       |
| 133  | Subcontractor-member → future-DC pipeline (prospect tier) — design                                                 |
| 134  | PO detail page + worklist PO grouping + within-ticket partial via split                                            |
| 135  | First-class deliveries (PO ships in procurement-arranged deliveries; ADR 0054)                                     |
| 136  | Create a purchase request on the WP page only (+ PM self-approve)                                                  |
| 137  | Action-state bands + view filter on the site /requests worklist                                                    |
| 138  | Mobile worklist redesign (procurement): attention panel · KPI hero · chips · tile filters                          |
| 139  | App-feel slice 3: optimistic UI (U1 — worker active-toggle, useOptimistic)                                         |
| 140  | App-feel slice 5: motion (U1 — staggered list-enter on the WP worklist)                                            |
| 141  | Equipment registry: categories + items (data layer, P1 U1; ADR 0055)                                               |
| 142  | Project onboarding (create_project RPC · stub + checklist · WP seeding)                                            |
| 143  | Membership-scoped project visibility (PM/site_admin see only their projects; ADR 0056)                             |
| 144  | Defect rework — reopen a complete WP to a `rework` status (post-completion defects)                                |
| 145  | Lock new work on a completed project (warranty-aware; rework still allowed)                                        |
| 146  | Equipment rental money (P2; daily rate + inbound batches; ADR 0055) — design only                                  |
| 147  | Data-fetch parallelization (waterfall fix; ranks 1-4: WP/project/request detail + portal)                          |
| 148  | Data-fetch parallelization round 2 (ranks 5-8: PO/delivery detail, schedule, projects hub)                         |
| 149  | Accounting general ledger (full double-entry GL feeding PEAK; COA · periods · journal · retention · WHT; ADR 0057) |
| 150  | Streaming: route-level loading.tsx coverage (instant nav skeletons; U1 = 13 routes)                                |
| 151  | Lazy client bundles: defer offline-queue runner (supabase+zod chunk off first paint; U1)                           |
| 152  | `project_director` role — see-all `project_manager` (executive-director tier; ADR 0058)                            |
| 153  | Desktop hub-strip coverage — HubNav on /settings + /dashboard (hubNavForRole selector)                             |
| 154  | Coordinator read-only project view — non-link WP rows + no calendar chip (spec 143 / ADR 0056)                     |
| 155  | Bind a work package to a deliverable (set_work_package_deliverable RPC + picker; ADR 0059)                         |
| 156  | Edit a work package's name (set_work_package_name RPC + edit sheet; ADR 0059)                                      |
| 157  | Delete a work package — Tier 1 empty-only hard delete (+ labor_logs FK fix; ADR 0059)                              |

**Absent spec numbers** (no spec file — covered by ADRs or folded into another
unit): 25, 26, 29, 30.
