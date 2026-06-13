# Feature specs — index

One numbered spec per feature unit. The workflow (see `CLAUDE.md`) is: read the
spec for the unit you're told to build **in full**, implement exactly it. This
index is for finding the right spec and tracing related work — not a substitute
for reading the spec itself.

| Spec | Title                                                                     |
| ---- | ------------------------------------------------------------------------- |
| 01   | LINE Login Authentication (+ `01-line-auth-FINDINGS.md`)                  |
| 02   | Photos and Approvals                                                      |
| 03   | SA Photo Upload UI                                                        |
| 04   | Deliverable grouping in reports                                           |
| 05   | Profile Management (display-name self-edit)                               |
| 06   | AppSheet back-office DB role                                              |
| 07   | `/profile` route (universal display-name reach)                           |
| 08   | LINE profile picture as avatar (self-view MVP)                            |
| 09   | Purchasing — data layer (P1a)                                             |
| 10   | WP-centric purchase requests, mobile form fix, phase relabel              |
| 11   | Deliverable-grouped work-package list (SA project screen)                 |
| 12   | `/requests` back navigation + deliverable progress                        |
| 13   | Thai-capable font in the PDF report worker                                |
| 14   | Thai-first UI + UX coherence pass (whole-app upgrade iter 1)              |
| 15   | Purchasing visibility + review ergonomics (iter 2)                        |
| 16   | Purchase-request enrichment: unit picker, needed_by, eta, attachments     |
| 17   | App-shell structural refactor (iter 4)                                    |
| 18   | UX coherence + PWA installability (iter 5)                                |
| 19   | Bottom tab bar + purchasing-surface consolidation (iter 6)                |
| 20   | Sun-readable redesign: light high-contrast theme + nav identity (iter 8)  |
| 21   | Urgency as a colored segmented control                                    |
| 22   | Order tracking progress per request (with `on_route` stage)               |
| 23   | Delivery-confirmation photos                                              |
| 24   | Receipt photo on `on_route` completes the delivery                        |
| 27   | Cancellation + PR running number                                          |
| 28   | WP detail redesign: owner/team, attention strip, responsive IA            |
| 31   | Contractor WP owners (replaces spec-28 user-owner UI)                     |
| 32   | LINE notification outbox                                                  |
| 33   | In-app purchase/shipment recording + suppliers master                     |
| 34   | Client-side photo downscale (downscaled file IS the original)             |
| 35   | Offline-tolerant upload queue (WP phase photos)                           |
| 36   | Iteration-9 debt batch                                                    |
| 37   | Offline queue for all photo kinds + manual discard                        |
| 38   | Re-skin: Refined Utility + brand band                                     |
| 39   | On-demand report generation (+ stale-report reaper)                       |
| 40   | Re-skin round 2 (operator feedback on spec 38)                            |
| 41   | Page width unification                                                    |
| 42   | PWA standalone LINE re-login (iOS)                                        |
| 43   | Device-code handoff login for the installed PWA                           |
| 44   | Handoff resume hardening (iOS process death)                              |
| 45   | Handoff opens LINE in the same window (no popup)                          |
| 46   | Daily labor capture per Work Package                                      |
| 47   | Purchase request detail page                                              |
| 48   | Requester notes on purchase requests                                      |
| 49   | Photo filmstrip: horizontal strips replace growing grids                  |
| 50   | Lightbox swipe between photos                                             |
| 51   | Photo markup: drawing + comments on WP photos                             |
| 52   | WP status transitions: during → in_progress, manual on-hold toggle        |
| 53   | Refresh button on every content page                                      |
| 54   | WP detail redesigned to the operator's mockup                             |
| 55   | Mockup design language, round 2 (remaining detail headers)                |
| 56   | WP list: status filter rework, search removed                             |
| 57   | Long WP names never truncate                                              |
| 58   | Project settings page for back office                                     |
| 59   | Site-map audit + one project page                                         |
| 60   | Reports page: detail header + standalone-safe download                    |
| 61   | PM control over report content                                            |
| 62   | Headers pinned while scrolling                                            |
| 63   | Consolidate the reusable chrome                                           |
| 64   | Fixed app shell: chrome that cannot drift                                 |
| 65   | Consolidation pass (behavior-preserving refactor)                         |
| 66   | Documents have a home; on-site purchases are recordable                   |
| 67   | Design-critique remediation (the 9 survivors)                             |
| 68   | Labor P2: cost freeze, PM cost view, close-out variance                   |
| 69   | DC payroll export (subcontractor days, per period)                        |
| 70   | Procurement onboarding: the purchasing worklist                           |
| 71   | Notes as backup capture: work-package notes (v1 slice)                    |
| 72   | Notes everywhere (program) + Unit 1: shared NotesField + `projects.notes` |
| 73   | Notes everywhere Unit 2: editable purchase-request note                   |
| 74   | Notes everywhere Unit 3: labor-day note                                   |
| 75   | Notes everywhere Unit 4: worker roster note                               |
| 76   | App-feel slice 1: toast / snackbar system                                 |
| 77   | App-feel slice 2: press / active tactile feedback                         |
| 78   | App-feel slice 4: bottom-sheet primitive                                  |
| 79   | Project metadata + client information (clients master)                    |
| 80   | Project team / supervisors (`project_members`)                            |
| 81   | Contacts management (clients · suppliers · contractors)                   |
| 82   | Content-named route namespace (program) + Unit 1: project subtree         |
| 83   | Contacts v2 Unit 1: contractor taxonomy + enrichment + DC backfill        |
| 84   | Contacts v2 Unit 2: suppliers enrichment + service_providers table        |
| 85   | Contacts v2 Unit 3: bank info (money-isolated `contact_bank`)             |
| 86   | Contacts v2 Unit 4: select field primitive + write-action layer           |
| 87   | Contacts v2 Unit 6: list-first UI (5 tabs, add-sheet, status filter)      |

**Absent spec numbers** (no spec file — covered by ADRs or folded into another
unit): 25, 26, 29, 30.
