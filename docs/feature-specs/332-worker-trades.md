# Spec 332 — worker trades (สายงานช่าง)

Status: approved (operator, 2026-07-21 in chat — design presented as two diagrams;
three open calls answered explicitly: writer gate = PM/PD/super · top-9 grain only ·
manage UI in the roster sheet beside the level picker).

## Why

The org model separates four axes (ADR 0080). For technicians, two of the three
skill-adjacent axes already exist:

- **General level** (`workers.level`, `worker_level` enum, `set_worker_level` RPC,
  super_admin-gated, spec 272) — the MONEY axis (per-level rate table
  `worker_level_rates`, ADR 0060). Built; currently unfilled (26/26 null on prod).
- **Team headship** (`crews.lead_worker_id`, spec 330) — HT is a per-team position,
  NOT trade-based. This spec does not touch it.

What is missing is the **assignment axis**: which trades (สายงาน) a technician
works — ช่างไฟ, ช่างปูน, ช่างหลังคา. The 19/07 โพธิ์ทอง daily report groups people
by trade; the app has no representation of it. This spec adds trade TAGS against
the existing global `work_categories` top level (W01–W09, spec 277 identity chips
render them for free).

**Deliberately NOT in scope** (recorded so nobody re-adds them):

- **No per-trade rating column.** A hand-entered "skill 3/5 in plumbing" is a
  subjective rating; ADR 0060's anti-favoritism pillar bans those. Money stays on
  the single general level. Per-trade _proficiency_ is later DERIVED from
  `labor_logs → work_packages.category_id → work_categories` (measured days per
  trade — already computable, zero new writes; own spec when a consumer exists).
- **No trade on HT.** Headship stays on the team relation. An optional
  `crews.work_category_id` team-trade label is deferred until after the spec 328
  ช่างอวย pilot (the subcon side is where trade grouping pays off).
- **No self-report path v1.** Trades are staff-set (PM tier). A worker-self-claim
  at onboarding (spec 279/328 flows) is a later unit if the pilot wants it.

## Model

New table `worker_trades` — a junction from `workers` to top-level
`work_categories`:

| column             | type                                 | notes                                          |
| ------------------ | ------------------------------------ | ---------------------------------------------- |
| `worker_id`        | uuid FK → workers, on delete cascade | part of PK                                     |
| `work_category_id` | uuid FK → work_categories            | part of PK                                     |
| `is_primary`       | boolean not null default false       | max one true per worker (partial unique index) |
| `created_by`       | uuid FK → users                      | who wrote this row                             |
| `created_at`       | timestamptz not null default now()   |                                                |

Rules (RPC-enforced; the table trusts its sole writer):

- Category must be **top-level** (`char_length(code) = 3`, i.e. W01–W09) and
  `is_active`.
- **At most one primary** per worker (DB partial unique index — writer-agnostic,
  spec 330 U3a lesson: invariants live on the write path, not in readers).
- Multiple trades per worker allowed; zero trades = valid (ยังไม่ระบุสายงาน).

### Writer — `set_worker_trades(p_worker uuid, p_categories uuid[], p_primary uuid default null)`

Full-replace semantics in one transaction (mirrors the UI: a set of checkboxes +
one primary radio; idempotent):

1. Role gate (null-safe, live `set_work_package_category` wording):
   `v_role is null or v_role not in ('project_manager','super_admin','project_director')`
   → `42501 'set_worker_trades: role not permitted'`.
2. Worker exists → else `P0001 'set_worker_trades: worker not found'`.
3. `p_categories` deduped silently (array may repeat ids; not an error).
4. Every category exists, is top-level, is active → else
   `22023 'set_worker_trades: invalid category'` (one message for all three
   sub-cases; the UI only offers valid options, so the split carries no user value).
5. `p_primary`, when not null, must be a member of the (deduped) `p_categories`
   → else `22023 'set_worker_trades: primary not in set'`. **Distinct message from
   rule 4** — same errcode, so pgTAP pins the MESSAGE (spec 330 U3c lesson: pin the
   message whenever one function raises the same errcode from >1 guard).
6. Delete all existing rows for the worker, insert the new set, flag the primary.
7. One `audit_log` row: `worker_change` / kind `trades_change`, payload = category
   codes + primary (mirrors `set_worker_level`'s `level_change`).

Grants: `revoke execute from public, anon` + `grant to authenticated` INLINE
(brand-new fn; pgTAP 229 catch-all then auto-covers it).

### Reads

RLS enabled; `select` policy for `authenticated` (trade tags are non-PII
classification data — same openness class as `work_categories` itself). All
writes RPC-only (no insert/update/delete policies).

## Units

### U1 — schema + RPC + pgTAP (mig `075821`, additive; test file `333-worker-trades.test.sql` — `332-*` was already taken by crew-project-scope)

Failure modes → each becomes a RED-first pgTAP assert:

| #   | mode                                     | raise                       | user-facing Thai (U2 surfaces it)         | recovery                                      |
| --- | ---------------------------------------- | --------------------------- | ----------------------------------------- | --------------------------------------------- |
| 1   | caller not PM/PD/super (incl. null role) | `42501 role not permitted`  | `ไม่มีสิทธิ์แก้ไขสายงาน`                  | none — surface hidden from other roles anyway |
| 2   | worker deleted since read                | `P0001 worker not found`    | `ไม่พบช่างคนนี้ กรุณารีเฟรชหน้า`          | refresh list                                  |
| 3   | category unknown / sub-level / inactive  | `22023 invalid category`    | `หมวดงานไม่ถูกต้อง กรุณารีเฟรชหน้า`       | refresh (options list is stale)               |
| 4   | primary outside the set                  | `22023 primary not in set`  | `สายงานหลักต้องเป็นหนึ่งในสายงานที่เลือก` | fix selection                                 |
| 5   | empty set + null primary                 | **valid** — clears all tags | — (row shows ยังไม่ระบุสายงาน)            | —                                             |
| 6   | anon / PostgREST direct                  | no EXECUTE                  | —                                         | —                                             |

Also pinned: dedup behavior (repeated id in array → one row), one-primary DB
index (direct SQL insert of a second primary as a superuser fixture → unique
violation), cascade on worker delete, `authenticated` select / no-write RLS.

### U2 — roster sheet UI + chips + labels (code-only)

- `worker-roster-manager.tsx` sheet: trade checkbox group (9 × `CategoryChip`
  identity) + สายงานหลัก primary picker, beside the existing level picker; same
  UI gate as the RPC (PM/PD/super — mirror of the spec 272 gate comment pattern).
  ⚠ file is CONTENDED with lane 313u2b (string renames); whoever ships second
  rebases.
- Roster row display: primary-first compact trade letters via existing identity
  maps (`workCategoryIdentity`).
- `labels.ts` additive block: `TRADE_LABEL = 'สายงาน'`,
  `TRADE_PRIMARY_LABEL = 'สายงานหลัก'`, `TRADES_EMPTY_LABEL = 'ยังไม่ระบุสายงาน'`
  - the four error strings above (message-keyed map, muster action convention).

Failure modes: every RPC mode above → message-keyed Thai toast (never a raw
Postgres error); zero-trade row renders `TRADES_EMPTY_LABEL` (not blank); action
pending state disables the sheet's save button (spec 330 U1 lesson: wrap the
server action in try/catch so a rejection never wedges the sheet).

### Later (own specs, not units here)

- Derived days-per-trade stat (labor_logs) once a consumer wants it.
- `crews.work_category_id` team-trade label — after the 328 pilot.
- Worker self-claim of trades at onboarding.
- Surfacing trades on `/technician` + team map member chips.
