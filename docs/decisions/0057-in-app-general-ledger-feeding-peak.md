# ADR 0057: In-app management general ledger feeding PEAK

## Status

Proposed — 2026-06-19 (operator confirmed: **full** in-app double-entry general
ledger; **WIP / accrual** basis). Design only — build is spec 149+ (data layer
first: chart of accounts → periods → journal → subledger posters → retention →
WHT → trial balance → PEAK feed → `/accounting` surface).

**Amendment 2026-06-19 (decision 12):** the posting mechanism (left open in
decision 2 as "trigger or in-RPC") is resolved to an **async posting outbox**
(operator-confirmed). Synchronous posting was rejected — it would couple a
money-ledger bug to operational writes and break on non-human writers
(`appsheet_writer` / service-role have a NULL `current_user_role()`, which the
`resolve_posting_period` gate refuses). See decision 12.

Reuses the `wp_labor_costs` / `dc_payments` money posture
([spec 68](../feature-specs/68-labor-cost-and-close.md),
[spec 127](../feature-specs/127-dc-payment-recording.md)), the append-only
immutability layers ([ADR 0004](0004-audit-trail-and-data-immutability.md),
[ADR 0009](0009-supersede-current-state-query-pattern.md)), the completed-project
INSERT lock ([spec 145](../feature-specs/145-lock-completed-project-wp-insert.md)),
the VAT-on-purchase capture ([ADR 0045](0045-vat-capture-on-purchases.md)), and
the PEAK outbound outbox ([spec 129](../feature-specs/129-peak-accounting-integration.md)).

## Context

- Today every money event lives in its **own operational subledger** — purchases
  (`purchase_requests` + `vat_rate`), labor (`labor_logs` →
  `wp_labor_costs`), DC payments (`dc_payments`), equipment rental
  (`equipment_rental_batches`). Each is correct in isolation, but there is **no
  unifying ledger**: no chart of accounts, no double-entry, no trial balance, no
  accounting periods, no notion of what is _owed_ vs _paid_ across the business.
- The operator runs construction projects whose accounting has constructs a
  generic ledger does not model well:
  - **Retention** — the client **withholds 5%** of each progress claim
    (งวดงาน) until the warranty period ends. That 5% is earned revenue not yet
    collectible — a **retention receivable**, invisible today.
  - **Withholding tax (WHT)** — PRC **deducts** WHT paying subcontractors/service
    vendors (issues PND3/PND53) and **suffers** WHT when clients pay PRC's
    invoices (collects their certificate). Only output/input **VAT** is partly
    captured today (ADR 0045); WHT is entirely absent.
  - **Work-in-progress (WIP)** — construction costs accrue against a job before
    revenue is recognized; the operator chose **accrual/WIP**, not cash basis.
- [PEAK](../feature-specs/129-peak-accounting-integration.md) is already the
  **statutory accounting system** (outbound sync shipped at the infra layer). The
  question is therefore **not** "build accounting from scratch" — it is "what
  ledger lives in prc-ops, and how does it feed PEAK without double-keying."
- The app already enforces, and this ADR inherits without exception: RLS on every
  table; append-only `audit_log`; supersede for evidence tables; Postgres enums
  for status; money columns at **zero authenticated grant**, read only via the
  service-role admin client behind `requireRole`; **no money on any
  site_admin-reachable screen** (spec 46); change-management gate for all schema.

## Decision

**Build a full double-entry general ledger inside prc-ops as the construction
_management_ book — dimensioned by project and work package, posted to
automatically from the existing operational subledgers, closed per accounting
period — and feed PEAK from its journal entries as the statutory book. Reuse the
labor-cost money posture and the append-only/period-lock mechanisms; invent no
new immutability or access primitive.**

1. **Two books, one boundary. prc-ops GL = management ledger; PEAK = statutory
   ledger.** prc-ops owns the real-time, project/WP-dimensioned, construction-aware
   ledger (WIP, retention, งวด billing, WHT tied to specific payments). PEAK owns
   the legal books and filings. The GL's `journal_entries` are the **clean sync
   source** to PEAK (replacing spec 129 U2's per-subledger transforms with one
   journal-shaped payload), keyed via `gl_accounts.peak_account_code`. The two are
   **reconciled monthly**, never double-keyed.

2. **Subledgers stay systems-of-record and POST to the GL; they are not
   replaced.** `purchase_requests`, `labor_logs`/`wp_labor_costs`, `dc_payments`,
   `equipment_rental_batches` keep their current shape and posture. Each money
   event raises a **balanced journal entry** via an internal poster (the async
   outbox of decision 12), carrying `source_table`/`source_id` back to the
   originating row. The subledger is the
   detail; the GL is the financial summary. No subledger column moves.

3. **Double-entry, balanced, append-only.** `journal_entries` (header) +
   `journal_lines` (detail). Every entry's `Σdebit = Σcredit` (asserted in the
   post function before commit; a money invariant, not a UI nicety). Entries are
   **append-only**: a correction is a **reversal entry** (`reversal_of` → the
   original) plus a fresh correct entry — never an UPDATE/DELETE. Enforced by the
   `dc_payments` mechanism copied: zero grant + a `BEFORE UPDATE/DELETE` trigger
   that fires even for the definer (ADR 0004 third layer).

4. **Chart of accounts is a table, not an enum.** `gl_accounts`: `code`,
   `name_th`/`name_en`, `account_type` (Postgres **enum**:
   asset/liability/equity/income/expense — the five fixed classes), `normal_side`
   (debit/credit), `parent_id` (self-FK tree), `is_postable` (only leaves post),
   `peak_account_code` (the PEAK map). Accounts grow operationally like
   `equipment_categories` (ADR 0055 decision 2) — a new account is an insert, not
   an ADR; only the five **classes** are an enum.

5. **Accrual / WIP basis.** Construction costs (materials, labor, DC, equipment)
   debit a **project/WP-dimensioned WIP asset**, not an immediate expense. Revenue
   is recognized when a progress claim is **certified** (งวด milestone); WIP is
   relieved to **COGS** as revenue is booked. This makes per-WP profitability
   (cost vs certified revenue) fall straight out of the ledger — the WP-centric
   principle, enforced at the GL. (The exact recognition rule — งวด-milestone vs
   cost-to-cost percentage — is an open question for the accountant; the **schema**
   supports either.)

6. **Dimensions on every line.** Each `journal_lines` row carries `project_id`,
   `work_package_id`, and a `party` (supplier/contractor/client/equip_owner +
   id). Trial balance, project P&L, and **per-WP P&L** are all `GROUP BY` over the
   one ledger — no parallel rollup tables. This is the structural payoff of a GL
   over today's island subledgers.

7. **Accounting periods with a close + lock.** `accounting_periods` (one row per
   month; status open → closing → closed → locked). The post function **refuses**
   any entry whose `entry_date` falls in a `closed`/`locked` period (`P0002`),
   reusing the completed-project INSERT-lock pattern (spec 145) exactly.
   Corrections to a closed period post as reversals into the **current open**
   period, never by reopening history.

8. **Retention receivable (AR; client withholds 5%).** `client_billings` (the
   งวด progress claim: gross, `retention_rate` default 5%, `retention_amount`,
   VAT, WHT-suffered, `net_receivable`) and `retention_receivables` (the withheld
   pool per project/claim: status held → due → released → forfeited;
   `due_date` = warranty end). On **certify**, the GL books Dr AR + Dr Retention
   receivable + Dr WHT-prepaid / Cr Revenue + Cr Output VAT. Retention auto-flags
   `held → due` at warranty end (ties to spec 144/145), but the cash **release**
   (Dr Bank / Cr Retention receivable) is an **explicit operator action** — money
   never moves itself. The symmetric **AP retention** (PRC withholds 5% from
   subcontractors) is the same table shape, **deferred to phase 2**.

9. **WHT certificates, both directions.** `wht_certificates`: `direction`
   (deducted / suffered), `tax_form` (pnd3 individual / pnd53 juristic / pnd1
   payroll), party + 13-digit tax id, `income_type`, `base_amount`, `wht_rate`,
   `wht_amount`, `pay_source_table`/`pay_source_id`, `period_id`. **Deducted**
   posts Cr WHT-payable (PRC owes the Revenue Department, issues the certificate);
   **suffered** posts Dr WHT-prepaid (a tax asset PRC reclaims). Standard Thai
   rates seed a reference table (service 3% · professional 3% · rent 5% · transport
   1% · advertising 2%); the accountant confirms before go-live.

10. **Money posture = the labor posture, copied.** Every GL/retention/WHT table is
    **money**: `enable row level security`, **zero authenticated grant**, read
    only via the admin client behind `requireRole`, **never** on a
    site_admin-reachable screen, every write audited. Written only by SECURITY
    DEFINER functions (the internal posters + the human-facing
    `post_journal_entry` for manual/closing entries). The `accounting` role (in
    the `users` enum already, ADR 0008, v3) becomes the human reader at a future
    `/accounting`; until it onboards, pm/super operate the ledger.

11. **Reconciliation invariant.** For each subledger there is a GL **control
    account** whose balance must equal the subledger's current-state sum (e.g.
    Σ`dc_payments.paid_amount` current = the DC-clearing balance). A check function
    asserts it per period; drift is a bug, not an opinion. This is how a posted GL
    stays honest against the operational tables it summarizes.

12. **Posting mechanism = async outbox** (amendment 2026-06-19, operator-confirmed;
    resolves the decision-2 hand-wave). A subledger money event does **not** post
    to the GL synchronously. Instead an AFTER-trigger **enqueues** a job into a
    `gl_posting_outbox` (a SECURITY DEFINER trigger that only inserts a queue row —
    it cannot fail the operational write, and works for **every** writer including
    `appsheet_writer` and service-role). A **service-role drainer** then builds the
    balanced journal per the posting-rules map and calls `post_journal_internal`.
    Rationale: (a) decouples a money-ledger bug from operational writes — a bad
    poster never blocks a purchase/payment; (b) sidesteps the role-gate trap —
    `resolve_posting_period` is gated on `current_user_role()`, which is NULL for
    appsheet/service writers, so a synchronous in-line poster would raise `42501`
    and abort the write; (c) reuses the proven `peak_sync_outbox` /
    `notification_outbox` shape, and is consistent with the GL→PEAK feed (U8) which
    is async too. **Consequence:** `resolve_posting_period`'s provisional staff-role
    gate (U2) is **removed** when the drainer lands (U4b) — it becomes pure internal
    plumbing (revoked from anon/public; the human gates stay on `post_journal_entry`
    / `open_accounting_period` / `set_accounting_period_status`). The outbox is
    delivery **state**, not evidence (the source rows + the resulting
    `journal_posted` audit row are the evidence chain), so — like
    `notification_outbox` / `peak_sync_outbox` — it carries **no** new
    `audit_action`. Idempotency: a live-or-posted job for a `(source, event)` is
    never re-queued (prevents double-posting on incidental re-fires).

## Consequences

**Positive** — one **financial truth** replaces four island subledgers;
**per-WP P&L** and trial balance are `GROUP BY` over one table (the WP-centric
principle, structurally); PEAK gets a single journal-shaped feed instead of
N per-source transforms; retention and WHT — today invisible — become
first-class; the whole thing **reuses** the labor money posture, the
append-only triggers, and the period-lock pattern, inventing no new mechanism;
schema is additive (subledgers untouched), so it layers on without a rewrite.

**Negative** — the largest money surface in the app to audit on every column; the
**posters must be exhaustive and reconciled** (a missed or unbalanced post is a
silent books error — the reconciliation invariant + pgTAP are the defense); WIP
accrual is genuinely more complex than cash, and the revenue-recognition rule
needs an accountant; the COA, WHT rate table, and opening balances are
**accountant dependencies** that gate go-live, not the build.

**Neutral** — basis is resolved (accrual/WIP, decision 5); GL depth is resolved
(full in-app, decision 1); **depreciation, fixed-asset registers, and payroll
(PND1 employee tax) accounting** stay out of v1 (PEAK / later territory, as in
ADR 0055); whether to **backfill** historical subledger rows into the GL or run
**go-forward only** from a cut-over period is an opening-balances decision for
the first close, designed-for but deferred.

## Open questions (confirm before the relevant unit)

- **Revenue recognition rule** (decision 5) — งวด-milestone (recognize the
  certified claim) vs cost-to-cost percentage-complete. Schema supports either;
  the accountant picks. Blocks U5 (client billing) posting.
- **Chart of accounts** — the actual account list + codes + PEAK code map. An
  accountant deliverable; U1 seeds a **construction-standard skeleton** to be
  replaced/extended. Blocks nothing structurally; blocks correctness at go-live.
- **WHT rate table** (decision 9) — confirm the income-type → rate map and the
  form set (PND3/53/1). Accountant deliverable. Blocks U6 correctness.
- **AP retention** (decision 8) — PRC withholding 5% from subcontractors: same
  shape, phase 2 — confirm timing and the release trigger (subcon warranty vs
  project completion).
- **Intercompany booking** (ADR 0055 open question, now GL-relevant) — the sister
  company's equipment rental: a real cash entry vs an intercompany clearing
  account. Affects the equipment poster (U4).
- **Opening balances / cut-over** — backfill the existing subledgers into the GL,
  or go-forward from a named period with manual opening balances. First-close
  decision.
- **`accounting` role onboarding** — operate the GL as pm/super now and onboard
  `accounting` later (off `/coming-soon`), or stand the role up with U9.

## References

- Spec 68 — `wp_labor_costs` + `freeze_wp_labor_cost` (money posture + freeze pattern copied)
- Spec 127 — `dc_payments` (append-only money table + `BEFORE UPDATE/DELETE` trigger copied)
- Spec 129 — PEAK outbound sync (the GL becomes its clean journal source)
- ADR 0004 / 0009 — audit immutability layers + supersede anti-join (reversal correction reuses)
- ADR 0045 — VAT capture on purchases (output/input VAT become GL accounts; AP poster reads it)
- ADR 0044 — purchase orders (the AP subledger the purchase poster reads)
- ADR 0055 — equipment rental money (the equipment subledger the rental poster reads)
- Spec 144 / 145 — defect rework + completed-project INSERT lock (retention-release gate + period-lock pattern)
- Spec 100 — budget-vs-spend (the per-project/WP rollup the GL now serves from one table)
- ADR 0008 — role enum (`accounting` reader role already present)
