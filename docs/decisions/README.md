# Architecture Decision Records — index

Binding decisions. They **override defaults**. Before implementing a feature,
scan this index and read in full the ADRs that touch the area you're changing —
you do not need to read all of them every time.

Each ADR file is `NNNN-slug.md`. "Amends/Supersedes" notes which earlier ADR a
later one corrects — read both when the topic is live.

| ADR  | Title                                                                | Notes                                          |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------- |
| 0001 | Technology Stack                                                     |                                                |
| 0002 | WP Data Import Strategy                                              |                                                |
| 0003 | Photo Upload and Watermarking                                        |                                                |
| 0004 | Audit Trail and Data Immutability                                    |                                                |
| 0005 | v1 Scope                                                             |                                                |
| 0006 | Database testing via pgTAP against linked remote project             |                                                |
| 0007 | `public.users` is keyed to `auth.users`                              |                                                |
| 0008 | Role Enum Expansion                                                  |                                                |
| 0009 | Supersede current-state query pattern                                | Amends 0004                                    |
| 0010 | Visitor default role                                                 | Amends 0007                                    |
| 0011 | RLS role-check helper (breaks self-referential policy recursion)     |                                                |
| 0012 | LINE auth via custom app-handled flow                                | Supersedes spec 01 decision #4                 |
| 0013 | Project access model — role-level only for v1                        |                                                |
| 0014 | Work-packages CSV import contract                                    |                                                |
| 0015 | `photo_logs` tombstone-supersede + well-formedness CHECK             |                                                |
| 0016 | Deliverables domain table + `work_packages.deliverable_id`           |                                                |
| 0017 | Display-name self-edit via SECURITY DEFINER RPC                      | First user-write to `users`                    |
| 0018 | AppSheet back-office DB role (least-privilege external principal)    |                                                |
| 0019 | Revoke UPDATE on `public.users` from authenticated/anon              | Amends 0007                                    |
| 0020 | LINE profile picture as avatar (self-view MVP)                       |                                                |
| 0021 | `getClaims()` local JWT verify on read-render path                   | Cuts per-page auth round-trip                  |
| 0022 | Purchasing domain — single stateful table, dual-identity             |                                                |
| 0025 | AppSheet purchase/delivery write path                                |                                                |
| 0026 | Purchase-request enrichment — needed_by/eta/priority, attachments    |                                                |
| 0027 | `on_route` purchase-request status                                   |                                                |
| 0028 | Purchase-request attachments + delivery-confirmation purpose         |                                                |
| 0030 | Site receipt photo completes delivery                                |                                                |
| 0031 | Request cancellation + PR running number                             |                                                |
| 0032 | Work-package owner + team (assignment metadata)                      |                                                |
| 0033 | Contractor entities as WP owners                                     | Supersedes 0032 user-owner UI                  |
| 0034 | AppSheet sunset: procurement moves in-app; image bridge cancelled    |                                                |
| 0035 | Tenancy: instance-per-customer, tenant-clean codebase                |                                                |
| 0036 | Client-side photo downscale — the downscaled file IS the original    |                                                |
| 0037 | LINE notification outbox                                             |                                                |
| 0038 | In-app purchase/shipment write path + suppliers master               |                                                |
| 0039 | Offline-tolerant photo upload queue (phase photos)                   |                                                |
| 0040 | On-demand report generation + stale-report reaper                    |                                                |
| 0041 | Device-code handoff for standalone PWA login                         |                                                |
| 0042 | Project settings write path (back-office RPC)                        |                                                |
| 0043 | On-site purchases & invoice/receipt documents                        |                                                |
| 0044 | Purchase orders: grouping tickets into a supplier order              | Per-ticket prices; PO = sum                    |
| 0045 | VAT capture on purchases                                             | amount = gross; rate derives net/VAT           |
| 0046 | Document-first PO creation (upload → side-by-side → AI-ready)        | PDF/image; preview local, upload on submit     |
| 0047 | Generated DB types shared across the app/worker boundary             | Vendored worker copy + drift-guard test        |
| 0048 | CI test-tier policy                                                  | Worker job in CI; e2e/db stay local            |
| 0049 | AI feature governance: toggles, system prompts, access control       |                                                |
| 0050 | super_admin user & role management                                   |                                                |
| 0051 | external partner access model (DC/client portal, row-level RLS)      | extends 0013                                   |
| 0052 | Within-ticket partial delivery via split-on-receipt                  | Amends 0044 §7; spec 134 U3                    |
| 0053 | Explicit PO-level receive (delivery without a per-ticket photo)      | Amends 0030; spec 134 U5                       |
| 0054 | First-class deliveries (PO ships in procurement-arranged deliveries) | Reverses 0053 deferral; spec 135               |
| 0055 | Equipment tracking & intercompany rental model                       | Extends 0051; reuses spec 68 posture; spec 141 |
| 0056 | Membership-scoped project visibility                                 | Amends 0013; spec 143                          |
| 0057 | In-app general ledger feeding PEAK (double-entry GL)                 | spec 149                                       |
| 0058 | `project_director` role — see-all `project_manager`                  | Extends 0008/0013/0056/0050; spec 152          |
| 0059 | Work-package mutation lifecycle (bind deliverable · edit · delete)   | Extends 0016/0004/0056/0058; specs 155–157     |

**Absent numbers** (never authored as standalone files; do not look for them):
0023, 0024 — skipped. 0029 — AppSheet image bridge, cancelled before authoring
(see ADR 0034 §3).
