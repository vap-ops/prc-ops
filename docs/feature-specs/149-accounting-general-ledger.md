# Spec 149 — Accounting general ledger (foundation; ADR 0057)

**Status:** locked — 2026-06-19. **Design only / not built.** ADR 0057.
**Driver:** the four operational subledgers (purchases, labor, DC, equipment) are
correct islands with **no unifying ledger** — no chart of accounts, no
double-entry, no trial balance, no periods, no retention or WHT. ADR 0057 decided
a **full in-app double-entry general ledger** on an **accrual/WIP** basis: the
construction _management_ book, dimensioned by project + work package, posted to
automatically from the subledgers, closed per period, feeding **PEAK** (the
statutory book, spec 129) from its journal entries. Money posture is the
`wp_labor_costs` / `dc_payments` posture (spec 68 / 127) copied exactly: **zero
authenticated grant, admin-read behind `requireRole(pm/super)`, never on a
site_admin-reachable screen, every write audited, append-only.**

This spec opens with the **first unit fully scoped** (the chart of accounts — the
ledger's spine, zero money movement) and a **roadmap** (U1–U9) so the operator
sees where it goes. Per the feature workflow, **build U1 only, then stop.**

---

## Roadmap (units, dependency-ordered)

| Unit    | Ships                                                                                                                                                                                                                                                                                                                  | Depends on       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **U1**  | **Chart of accounts** — `gl_accounts` (tree, five-class enum, `peak_account_code`) + a construction-standard seed + the maintain RPC + pgTAP. **No money movement. Specced below.**                                                                                                                                    | —                |
| U2      | **Periods** — `accounting_periods` (month, status enum) + open/close/lock RPCs + the period-resolve helper the poster will gate on. **Specced below.**                                                                                                                                                                 | U1               |
| U3      | **Journal** — `journal_entries` + `journal_lines` + the internal `_post_journal(entry, lines[])` (balance assert + period-open guard + audit + reversal) + `post_journal_entry` (manual/closing entries, pm/super gate).                                                                                               | U1, U2           |
| **U4a** | **Posting outbox (capture)** — `gl_posting_outbox` + `enqueue_gl_posting` + AFTER-triggers on the four subledgers that enqueue a post-job on the money event (async, ADR 0057 decision 12). Cannot fail the operational write; no posting logic yet. **Specced below.**                                                | U3               |
| U4b     | **Posting engine + purchase poster** — `journal_lines` **party** FKs; `posted_by` nullable (system posts); `post_journal_internal` gains `p_posted_by` + party; reverse split into `reverse_journal_internal`; **de-gate** `resolve_posting_period`; `post_purchase_to_gl` with **reverse-and-repost** (auto-correct). | U4a              |
| U4c     | **Drainer + remaining posters** — `drain_gl_posting` loop (service-role) consuming the outbox; dc_payment / labor_freeze / rental posters; the U4a idempotency refinement (in-flight-only + money-change WHEN) that makes auto-correct flow end-to-end.                                                                | U4b              |
| U5      | **Client billing + retention** — `client_billings` (งวด claim: gross/retention/VAT/WHT-suffered) + `retention_receivables` (held→due→released) + their posters; the **client-withheld 5%**.                                                                                                                            | U3 (U4b posters) |
| U6      | **WHT certificates** — `wht_certificates` (deducted/suffered, PND3/53/1) + a Thai-rate reference table + WHT posting into the AP/AR posters.                                                                                                                                                                           | U4b, U5          |
| U7      | **Trial balance + reconciliation** — period trial-balance query + the control-account reconciliation-invariant check function (ADR 0057 decision 11).                                                                                                                                                                  | U3–U6            |
| U8      | **PEAK feed from the GL** — enqueue `journal_entries` to `peak_sync_outbox` via `peak_account_code`; retires spec 129 U2's per-source transforms.                                                                                                                                                                      | U3 (U7 recon)    |
| U9      | **`/accounting` read surface** — onboard the `accounting` role off `/coming-soon`; trial balance, project/WP P&L, retention + WHT registers (read-only).                                                                                                                                                               | U7               |

Open questions stay in **ADR 0057** (revenue-recognition rule, the real COA, the
WHT rate map, AP retention, intercompany booking, opening balances, `accounting`
onboarding) — confirmed before their unit, not now.

---

## U1 — chart of accounts (2026-06-19)

**Status:** designed — not built. **Schema** (change-management gate). The
ledger's spine: the account dictionary every journal line points at. **Zero money
movement** — no entry posts this unit; U1 is purely the reference structure +
seed + maintain path. Reads are back-office; the _codes_ are not secret, but the
table lives in the money domain (it is meaningless without the journal) and is
gated `pm/super` like the rest of the GL.

### What ships

- **Migration — `account_type` enum.**
  `create type public.gl_account_type as enum ('asset','liability','equity','income','expense');`
  The five fixed accounting classes (a class add is an ADR event, like any enum;
  individual accounts are rows, not enum values — ADR 0057 decision 4).

- **Migration — `gl_accounts`:**
  - `id uuid pk default gen_random_uuid()`
  - `code text not null unique` — the account number (e.g. `'1150'`); CHECK
    `length(code) between 1 and 20`
  - `name_th text not null`, `name_en text null` — CHECK each `<= 120`
  - `account_type public.gl_account_type not null`
  - `normal_side text not null` — `'debit'` | `'credit'`; CHECK `in ('debit','credit')`.
    Stored (not derived) for clarity at the line level.
  - `parent_id uuid null` FK → `gl_accounts(id)` — the COA tree; a leaf's parent is
    a heading. CHECK `parent_id <> id` (no self-parent).
  - `is_postable boolean not null default true` — only **leaves** post; headings
    (`is_postable = false`) group. The poster (U3) refuses a line on a
    non-postable account.
  - `peak_account_code text null` — the PEAK COA map (ADR 0057 decision 1; the U8
    sync key). CHECK `peak_account_code is null or length(...) <= 40`.
  - `active boolean not null default true` — soft-retire without deleting (history
    references the row).
  - `sort_order integer not null default 0` — display order within a parent.
  - `created_at timestamptz not null default now()`,
    `updated_at timestamptz not null default now()` (shared `set_updated_at`
    trigger, the `purchase_orders` convention).
  - index on `(parent_id, sort_order)` (tree render) and `(account_type)`.
  - **Money-domain posture (the `wp_labor_costs` shape):** `enable row level
security`; `revoke all … from anon, authenticated`; `grant select … to
authenticated` **is NOT given** — read is admin-client-only behind
    `requireRole(pm/super)`, written only by the RPC below. No INSERT/UPDATE/DELETE
    policy (the definer RPC is the sole writer). **No hard delete** of a posted-to
    account — retire via `active=false` (a poster-referenced account is permanent;
    enforced operationally in U1, by FK from `journal_lines` in U3).
  - `comment on table` / `comment on column peak_account_code` document the
    posture + the PEAK map intent.

- **Migration — seed a construction-standard skeleton COA** (a _placeholder_ to be
  replaced/extended by the accountant — ADR 0057 open question; structurally
  complete, correctness-pending). Headings + the postable leaves the U4/U5/U6
  posters will need, e.g.:
  - **Assets** — Bank, AR – trade, **Retention receivable**, **WHT prepaid (suffered)**,
    Input VAT, **WIP – construction** (project/WP-dimensioned at the line).
  - **Liabilities** — AP – trade, **AP – DC clearing**, **AP – intercompany (equipment)**,
    **WHT payable (deducted)**, Output VAT, **Retention payable (AP, phase 2)**.
  - **Equity** — owner capital, retained earnings.
  - **Income** — construction revenue.
  - **Expense** — COGS – materials / labor / DC / equipment (WIP relief targets).
    Each control account (DC clearing, AP, Retention receivable, …) is the
    reconciliation anchor for its subledger (ADR 0057 decision 11). The seed is
    **idempotent** (`insert … on conflict (code) do nothing`) so a later real-COA
    migration can run alongside.

- **RPC — `upsert_gl_account(p_code text, p_name_th text, p_name_en text,
p_account_type public.gl_account_type, p_normal_side text, p_parent_code text
default null, p_is_postable boolean default true, p_peak_account_code text
default null, p_sort_order integer default 0)`** returns `uuid`,
  `security definer`, `set search_path = public`. The single maintain path
  (insert-or-update by `code`):
  - Gate: `current_user_role() not in ('project_manager','super_admin')` → raise
    `42501`. (GL is pm/super; `accounting` joins in U9.)
  - Validate: `p_code`/`p_name_th` non-empty; `p_normal_side in ('debit','credit')`
    → else `P0001`; resolve `p_parent_code` to a `parent_id` (`P0001` if a given
    parent code is unknown); reject `parent_id = self` (`P0001`).
  - UPSERT on `code` (`on conflict (code) do update set …`), `updated_at = now()`.
  - `audit_log` row: action `gl_account_upsert`, `target_table 'gl_accounts'`,
    `target_id <id>`, payload `{code, account_type, normal_side, parent_code,
is_postable, peak_account_code}`.
  - `revoke all on function … from public, anon; grant execute … to authenticated;`.

- **Migration — audit-action enum value, own migration (enum-add isolation):**
  `alter type public.audit_action add value if not exists 'gl_account_upsert';`.
  **Grep every `audit_action` enum pin in pgTAP and update** — both the
  `enum_has_labels` pins (files 03 AND 18; the spec 146 lesson, re-applied).

- **Pure helper** (`src/lib/accounting/`, **TDD first**):
  - `validateGlAccount({ code, nameTh, normalSide, accountType })` →
    `{ ok: true } | { ok: false; error: string }` (friendly Thai): non-empty code
    (≤20) + name (≤120); `normalSide ∈ {debit,credit}`; `accountType` ∈ the five.
    The UI gate before `upsert_gl_account`. (No tree validation in the helper —
    parent existence is a DB concern.)

- **`database.types.ts`** hand-extended (the enum, the table, the RPC signature,
  the audit-action value), then `db:types` reconciled at the gate.

### Scope

- **IN:** the `gl_account_type` enum; the `gl_accounts` table + RLS + zero-grant +
  CHECKs + tree FK + indexes; the idempotent skeleton-COA seed; the
  `upsert_gl_account` RPC; the `gl_account_upsert` audit-action (own migration,
  both pins); the `validateGlAccount` helper (test-first); pgTAP (new file
  `79-gl-accounts.test.sql`); types.
- **OUT:** periods (U2); any journal table or posting (U3+); the real
  accountant COA (open question — this is a skeleton); deleting/merging accounts;
  multi-currency; any UI (U9). No money entry exists to post against an account
  this unit.

### Money posture

`gl_accounts` lives in the money domain: **zero authenticated grant**, admin-read
behind `requireRole(pm/super)`, never on a site_admin-reachable screen, written
only via the audited `upsert_gl_account` RPC. (Account _codes_ are not
confidential, but the COA is inseparable from the ledger and gated with it — no
special-case grant.)

### Tests

- **TDD (RED first):** `tests/unit/gl-account.test.ts` — `validateGlAccount`
  (empty code/name rejected, over-length rejected, bad normal_side rejected, the
  five account types accepted, happy path) before any migration or helper exists.
  State **"Writing failing test first."**
- **pgTAP — new file `79-gl-accounts.test.sql`** (written before `db:push`):
  catalog (table + PK + the enum + its five labels); the CHECKs (`normal_side`
  domain, `code`/name length, `parent_id <> id`); the tree FK; RLS enabled +
  **zero authenticated grant** (`has_table_privilege` SELECT/INSERT false for
  `authenticated`); no INSERT/UPDATE/DELETE policy; the seed present (a known
  control account, e.g. `'AP – DC clearing'`, exists and is `is_postable`); the
  RPC gate (`visitor` AND **site_admin** → `42501`; a pm upserts an account; a
  bad `normal_side` → `P0001`; an unknown `parent_code` → `P0001`); `audit_log`
  row written with action `gl_account_upsert`; anon denied. Update **both**
  `audit_action` enum pins (grep first).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green; `pnpm db:push` then
`pnpm db:test` green; `pnpm db:types` regenerated. **No user-visible change** (no
UI this unit). The helper + pgTAP carry correctness; the RPC write is
**verified-by-checklist** (auth-gated, CHECK-guarded, pgTAP-covered). Operator
on-device pass not required (nothing renders).

### Seams

- The seed is a **skeleton**, not the books — the accountant's real COA (codes +
  PEAK map) replaces/extends it via a later idempotent migration (ADR 0057 open
  question). U1 ships structure, not chart-of-account correctness.
- `is_postable` is enforced **operationally** in U1; the hard guard (a
  `journal_lines` line can only reference a postable account) lands in U3 with the
  poster, where it bites.
- `peak_account_code` is recorded now but **unused** until U8 — the column ships in
  U1 so the table shape is final and the accountant can fill the map alongside the
  real COA.
- No `active=false` retire RPC path beyond `upsert` toggling it — a dedicated
  retire/merge flow is a later concern (accounts are append-grow this unit).

## U2 — accounting periods (2026-06-19)

**Status:** designed — not built. **Schema** (change-management gate). The second
unit: the monthly **period** every journal entry will belong to, with the
**close + lock** that freezes a posted month (ADR 0057 decision 7). No journal yet
(U3) — U2 ships the period table, its lifecycle RPCs, and the **resolve helper**
the poster will call to find/guard a date's period. Reuses the completed-project
INSERT-lock pattern (spec 145) — a status that, once set, makes a write fail
`P0002`.

### What ships

- **Migration — `period_status` enum:**
  `create type public.accounting_period_status as enum ('open','closing','closed','locked');`
  `open` accepts posts; `closing` is the reconciliation window (posts still
  allowed, flagged); `closed` rejects new posts (reversible by a super_admin
  reopen); `locked` is permanent (filed to PEAK — no reopen).

- **Migration — `accounting_periods`:**
  - `id uuid pk default gen_random_uuid()`
  - `period_month date not null unique` — the first of the month (CHECK
    `extract(day from period_month) = 1`)
  - `status public.accounting_period_status not null default 'open'`
  - `closed_at timestamptz null`, `closed_by uuid null` FK → `users(id)`
  - `created_at timestamptz not null default now()`
  - **Money-domain posture** (the U1 shape): RLS enabled; zero authenticated
    grant; admin-read behind `requireRole(pm/super)`; written only by the RPCs
    below. **No delete** (a period is permanent once it exists).

- **RPC — `open_accounting_period(p_month date)`** returns `uuid`,
  `security definer`. pm/super gate (`42501`); normalize `p_month` to the
  first-of-month (`date_trunc('month', p_month)::date`); UPSERT
  `on conflict (period_month) do nothing`, return the id; audit
  `accounting_period_open`.

- **RPC — `set_accounting_period_status(p_month date, p_status
public.accounting_period_status)`** returns `boolean`, `security definer`.
  pm/super gate; **`locked` and reopening a `locked` period require super_admin**
  (a filed month is not casually reopened — flagged like the equipment
  procurement-divergence so review reads it as intentional); guard legal
  transitions (`open↔closing`, `closing→closed`, `closed→locked`,
  super-only `closed→open`); set `closed_at`/`closed_by` when entering
  `closed`/`locked`; audit `accounting_period_status_change` with old/new.

- **Helper RPC — `resolve_posting_period(p_date date)`** returns `uuid`,
  `security definer` (the seam U3's poster calls): find the period for
  `date_trunc('month', p_date)`; if its status is `closed`/`locked` raise
  `P0002` (the spec-145 lock errcode); if no period row exists, **auto-open** one
  (`open`) and return it — so posting never fails merely because a month was not
  pre-created, only because it was deliberately **closed**. Returns the period id
  for the entry's `period_id`.

- **Migration — audit-action enum values, own migration:**
  `'accounting_period_open'`, `'accounting_period_status_change'` (both pins).

- **Pure helper** (`src/lib/accounting/`, **TDD first**):
  `firstOfMonth(iso: string)` + `canTransitionPeriod(from, to, isSuper)` →
  decide-shape — the legal-transition table mirrored for the form, ISO-string
  dates (no `Date` parsing), super-gate on lock/reopen. The DB RPC is the real
  guard; the helper fails the UI friendly.

### Scope

- **IN:** the two enums (period status; the period table); `accounting_periods`
  - posture + no-delete; the three RPCs (`open`, `set_status`,
    `resolve_posting_period`); the two audit-action values (own migration, both
    pins); the two pure helpers (test-first); pgTAP (new file
    `80-accounting-periods.test.sql`); types.
- **OUT:** the journal (U3 — `resolve_posting_period` is the seam U3 plugs into);
  any close _report_ / trial balance (U7); reopening UI; multi-period adjusting
  entries; any UI (U9).

### Money posture

Same as U1 — money domain, zero grant, admin-read behind `requireRole(pm/super)`,
super-only on `locked`/reopen, every lifecycle write audited.

### Tests

- **TDD (RED first):** `tests/unit/accounting-period.test.ts` —
  `firstOfMonth` + `canTransitionPeriod` (open→closing ok, closing→closed ok,
  closed→locked ok, closed→open super-only, illegal jumps rejected).
- **pgTAP — `80-accounting-periods.test.sql`:** catalog + the status enum's four
  labels; the first-of-month CHECK + unique; RLS + zero-grant + no-delete; the
  RPC gates (visitor/site_admin → `42501`; pm opens + advances; **a non-super
  reopening a `closed` period → `42501`**); `resolve_posting_period` returns a
  period for an open month, **auto-opens** a missing month, and **raises `P0002`
  for a `closed` month**; audit rows for open + status change; anon denied. Both
  audit pins updated.

### Verification

`pnpm lint && pnpm typecheck && pnpm test`; `pnpm db:push` + `pnpm db:test`;
`pnpm db:types`. No user-visible change. RPCs verified-by-checklist.

### Seams

- `resolve_posting_period` is the **only** coupling to U3 — the poster passes the
  entry date, gets a `period_id` or a `P0002`. U2 ships it now so U3 is pure
  journal mechanics.
- `closing` status carries no special posting behavior yet (posts allowed, same as
  `open`) — the reconciliation-window flagging (warn-on-post-to-closing) is a U7
  concern; the **status value** ships now so the lifecycle is complete.
- Period **rollup snapshots** (a frozen trial balance per closed period) are U7 —
  U2 only gates posting; it does not summarize.

## U4a — posting outbox (capture) (2026-06-19)

**Status:** designed — not built. **Schema** (change-management gate). The
**capture half** of the subledger→GL bridge, async per ADR 0057 decision 12: a
money event on any of the four subledgers **enqueues** a post-job; it never posts
inline. No posting logic this unit (that is U4b's drainer) — U4a is purely the
queue + the enqueue triggers. **Infra unit** (the `peak_sync_outbox` precedent,
spec 129 U1): tested by pgTAP, no pure-TS validator (no TS logic — the conditions
live in the trigger WHEN clauses). Modifies **no** existing function — purely
additive triggers + one table, so it cannot regress an existing write path.

### What ships

- **Migration — `gl_posting_status` enum** (mirror `peak_sync_status`):
  `('pending', 'posting', 'posted', 'failed', 'skipped')`.

- **Migration — `gl_posting_outbox`** (mirror `peak_sync_outbox` posture):
  - `id uuid pk` · `source_table text not null` (CHECK len ≤ 64) · `source_id uuid
not null` · `source_event text not null` (CHECK len ≤ 64) · `status
gl_posting_status not null default 'pending'` · `attempts integer not null
default 0` · `last_error text` · `journal_entry_id uuid null` FK →
    `journal_entries(id)` (set by the U4b drainer on success) · `created_at` ·
    `posted_at timestamptz`.
  - index `(status, created_at)` (drain order) + `(source_table, source_id)`.
  - **Zero user access** (the `peak_sync_outbox` posture): RLS enabled; `revoke all
… from anon, authenticated`; no policy. The drainer (service-role, U4b) is the
    only reader/updater; the only writer is the enqueue path below. **No new
    `audit_action`** — the outbox is delivery STATE, not evidence (ADR 0057
    decision 12; the source rows + the eventual `journal_posted` row are the
    evidence chain).

- **Function — `enqueue_gl_posting(p_source_table text, p_source_id uuid,
p_source_event text)`** returns uuid, `security definer`, `set search_path =
public`. Idempotent: if a job for `(source_table, source_id, source_event)`
  already exists in `('pending', 'posting', 'posted')`, return it (do **not**
  re-queue — prevents a double-post on incidental re-fires; stronger than
  `enqueue_peak_sync`, which dedups only live jobs, because a GL double-post is a
  books error). Otherwise insert `pending`, return the id. **No role gate** — it is
  reachable only via the SECURITY DEFINER trigger functions below (and the U4b
  drainer); `revoke all … from public, anon, authenticated` (the triggers' owner
  has execute).

- **Migration — AFTER triggers** on the four subledgers, each a SECURITY DEFINER
  trigger function (owner = the migration owner) that calls `enqueue_gl_posting`
  on the **money event** — so it works for every writer (`appsheet_writer`,
  site_admin, pm, service-role) without a role gate, and only ever inserts a queue
  row (it cannot fail/clog the operational write):
  - `purchase_requests` — AFTER INSERT OR UPDATE, WHEN `new.amount is not null and
new.status in ('purchased', 'site_purchased')`. event `'purchase'`.
  - `dc_payments` — AFTER INSERT (append-only). event `'dc_payment'`.
  - `wp_labor_costs` — AFTER INSERT OR UPDATE (UPSERT re-freeze). event
    `'labor_freeze'`.
  - `equipment_rental_batches` — AFTER INSERT. event `'rental_batch'`.

### Scope

- **IN:** the `gl_posting_status` enum; the `gl_posting_outbox` table + zero
  access; `enqueue_gl_posting` (idempotent); the four AFTER-trigger functions +
  triggers; pgTAP (new file `82-gl-posting-outbox.test.sql`); types reconciled.
- **OUT:** ALL posting logic — building journal lines, the posting-rules map, the
  per-source DB posting functions, the drainer (every bit is U4b); the party FKs
  on `journal_lines` (U4b, when populated); de-gating `resolve_posting_period`
  (U4b, when the service-role drainer calls it); re-post / reversal on a corrected
  source row (U4b+); WHT/VAT split (U6). No `journal_entries` is written this unit.

### Money posture

`gl_posting_outbox` is zero user access (the `peak_sync_outbox` posture) — RLS on,
no grant, no policy. It carries no money column (just source pointers + delivery
state), so it is not "money" in the cost sense, but stays fully closed to
authenticated/anon regardless. The enqueue function + triggers are internal.

### Tests

- **pgTAP — new file `82-gl-posting-outbox.test.sql`** (the test artifact; runs
  post-`db:push`): catalog (table + the status enum + FK to `journal_entries`);
  RLS enabled + **zero grant** (authenticated cannot read/write) + no policy;
  `enqueue_gl_posting` idempotency (a second call for the same `(source, event)`
  returns the same id, no second row; a `failed` prior job DOES re-queue); the four
  triggers fire — insert a `dc_payments` row → one `pending` outbox row with event
  `'dc_payment'`; a `purchase_requests` row that is **not** purchased/has no amount
  → **no** outbox row; a purchased+amount row → one; `wp_labor_costs` upsert → one;
  `equipment_rental_batches` insert → one; anon/authenticated denied. **No
  `audit_action` pin change** (the outbox adds none — assert nothing here).
- **No vitest** — infra unit, no pure-TS logic (the `peak_sync_outbox` precedent).

### Verification

`pnpm lint && pnpm typecheck && pnpm test` green (unchanged — no TS); `pnpm
db:push` then `pnpm db:test` green; `pnpm db:types` regenerated. **No
user-visible change.** The triggers are **verified-by-checklist + pgTAP**
(additive, owner-context, insert-only). Operator on-device pass not required.

### Seams

- The outbox fills with `pending` jobs that nothing drains until **U4b** — that is
  expected; U4a proves capture, U4b proves posting. A `pending` backlog before U4b
  ships is harmless (no journal written).
- Idempotency keys on `(source_table, source_id, source_event)`. A **corrected**
  source row (e.g. a re-frozen `wp_labor_costs`, a superseding `dc_payment`) that
  needs a _re-post_ is **not** handled here — U4b decides reverse-and-repost vs
  skip. U4a simply will not re-queue a `(source, event)` already posted; the
  re-post trigger/event design is a recorded U4b seam.
- The trigger WHEN conditions encode "is this the money event"; they are mirrored
  nowhere in TS this unit (no consumer). If U4b's drainer or a UI needs the same
  predicate, extract a shared helper then (recorded seam).

## U3–U9 — designed, scoped at build time

Each downstream unit mirrors the posture and shape established in U1/U2 (zero-grant
money table or money RPC + a single audited SECURITY DEFINER write path + own
audit-action migration + both enum pins + a test-first pure validator + a new
pgTAP file + `db:types`). Highlights to pin them, full scope authored when built:

- **U3 journal** — `journal_entries` (header: `entry_no` seq, `entry_date`,
  `period_id`, `source_table`/`source_id`/`source_event`, `memo`, `status`
  enum draft/posted/reversed, `reversal_of` self-FK, `posted_by`/`posted_at`) +
  `journal_lines` (`account_id` FK → postable `gl_accounts`, `debit`/`credit`
  `numeric(14,2)` with the one-side CHECK, `project_id`/`work_package_id`/`party`
  dimensions). The internal `_post_journal(entry, lines[])` asserts
  **Σdebit = Σcredit** and `is_postable` per line, calls `resolve_posting_period`
  (U2) for the `P0002` period guard, writes one audit row, and is the **single**
  insert path; append-only via the `dc_payments` `BEFORE UPDATE/DELETE` trigger,
  corrections via a `reversal_of` entry. `post_journal_entry(...)` is the
  human-facing wrapper (pm/super) for manual + closing entries.

- **U4a posting outbox (capture)** — `gl_posting_outbox` + `enqueue_gl_posting` +
  AFTER-triggers on the four subledgers (ADR 0057 decision 12, async). Specced in
  full below.

- **U4b posting engine + purchase poster** — the engine made drainer-ready +
  the first poster, end-to-end with **auto-correct** (operator decision
  2026-06-19): `journal_lines` gains the typed **party** FKs
  (supplier/contractor/client/equipment_owner); `journal_entries.posted_by`
  becomes **nullable** (a system/automated post has no human actor — appsheet/
  service-role); `post_journal_internal` gains `p_posted_by` (attributes the
  entry to the source row's actor) + per-line party; the reverse logic is split
  into an internal `reverse_journal_internal(entry, posted_by, memo)` (the human
  `reverse_journal_entry` delegates to it); `resolve_posting_period` is
  **de-gated** to pure plumbing (the service-role drainer has a NULL role) +
  granted to `service_role`. `post_purchase_to_gl(source_id)` posts a purchase
  per the ADR map — Dr WIP-materials (net, WP/project) + Dr Input VAT / Cr
  AP-trade (gross, supplier party) — and is **reverse-and-repost**: if a current
  entry already exists for that purchase it reverses it first, so an amount
  correction flows through. Tested by calling the poster directly (the drainer
  that consumes the outbox is U4c).

- **U4c posting drainer + remaining posters** — `drain_gl_posting(limit)` (the
  service-role loop that claims `pending` outbox jobs, dispatches to the right
  poster, marks posted/failed, sets `journal_entry_id`); the dc_payment /
  labor_freeze / rental posters (each its accrual postings: DC payment → Dr
  DC-clearing / Cr Bank; labor freeze → Dr WIP-labor (WP) / Cr DC-clearing +
  Payroll-clearing; rental batch → Dr WIP-equipment / Cr intercompany AP); and
  the **U4a idempotency refinement** (enqueue dedups in-flight only +
  money-change WHEN on the triggers) that makes auto-correct flow end-to-end
  through the outbox. WHT split folds in at U6.

- **U5 client billing + retention** — `client_billings` (งวด claim: `gross`,
  `retention_rate` default 0.05, `retention_amount`, `vat_amount`,
  `wht_suffered`, `net_receivable`, status draft→…→paid) + `retention_receivables`
  (per project/claim, status held→due→released→forfeited, `due_date` = warranty
  end, `release_entry_id`). Certify posts Dr AR + Dr Retention receivable + Dr
  WHT-prepaid / Cr Revenue + Cr Output VAT. `held→due` auto-flags at warranty end
  (spec 144/145 tie); the **release** (Dr Bank / Cr Retention receivable) is an
  explicit operator RPC — **the client-withheld 5%, made first-class.**

- **U6 WHT** — `wht_certificates` (direction deducted/suffered, `tax_form`
  pnd3/53/1, party + 13-digit `tax_id`, `income_type`, `base_amount`, `wht_rate`,
  `wht_amount`, `pay_source_*`, `period_id`) + a Thai-rate reference table (service
  3% · professional 3% · rent 5% · transport 1% · ads 2%, accountant-confirmed).
  Deducted → Cr WHT-payable; suffered → Dr WHT-prepaid. Folds into the AP poster
  (U4) and the billing poster (U5).

- **U7 trial balance + reconciliation** — the period trial-balance query
  (`GROUP BY account` over `journal_lines`, Σdebit/Σcredit per account) + the
  **reconciliation-invariant** check function (Σ each subledger current-state = its
  GL control-account balance; drift → flagged). Project P&L and **per-WP P&L** are
  the same `GROUP BY` with the dimensions.

- **U8 PEAK feed from GL** — `enqueue_peak_sync('expense'/'contact', 'journal_entries',
<id>, …)` keyed via `gl_accounts.peak_account_code`; retires spec 129 U2's
  per-subledger transforms (one journal-shaped payload replaces N). Reconcile (U7)
  before sync so only balanced, reconciled months feed the statutory book.

- **U9 `/accounting` surface** — onboard the `accounting` role off `/coming-soon`
  (its `roleHome`), a read-only surface: trial balance, project/WP P&L, the
  retention register, the WHT register. First non-pm/super GL reader; gates widen
  from `pm/super` to `pm/super/accounting` on the read RPCs.

### Cross-unit invariants (hold for every unit)

- **Balanced or rejected** — no entry posts unless `Σdebit = Σcredit` (U3 assert).
- **Period-guarded** — no post into a `closed`/`locked` period (`P0002`, U2 helper).
- **Append-only** — corrections are reversals, never UPDATE/DELETE (ADR 0004 / the
  `dc_payments` trigger, U3).
- **Reconciled** — each subledger ties to a GL control account (U7); drift is a bug.
- **Money posture** — every GL table zero-grant, admin-read behind `requireRole`,
  off every site_admin screen, audited (spec 46 / 68 / 127).
