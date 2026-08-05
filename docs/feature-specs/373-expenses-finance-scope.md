# Spec 373 — /expenses finance scope: accounting sees every user's office expenses

**Status:** approved in chat 2026-07-29 · U1–U2 planned, code-only, NO schema
**Origin:** operator, 2026-07-29 — _"where can accounting team sees the office expenses from users? they need to validate documents and inputted data to confirm and consolidate further"_, then _"fix /expenses so accounting sees all users' expenses"_.

## 1. The problem, measured live

`/expenses` (spec 310) renders three sections for a finance viewer: their **own**
expense summary, their **own** expense list, and the reimburse queue. The own-list is
scoped `submitted_by = auth.uid()` in `listMyExpenses` **for every role** — so an
accountant opening the page sees none of the firm's expenses, only their own (usually
zero). Cross-user visibility exists only at `/accounting/review` (spec 345), which
carries no submitter-friendly list view of this source.

Live on 2026-07-29:

| fact                                                            | value                            |
| --------------------------------------------------------------- | -------------------------------- |
| office expenses total                                           | 19 rows, ฿23,776 (06-09 → 07-28) |
| with a receipt attached                                         | 18 / 19                          |
| reviewed via the spec-345 money-review queue                    | **0 / 19**                       |
| reimbursements still open (`reimbursed_at is null`, target set) | **19 / 19**                      |

The two backlogs are the same rows: nothing has been validated, and nothing has been
paid back. The reimburse queue — the only place money moves (`บันทึกคืนเงิน`) — shows
**no receipt state, no review state, and no link to the voucher**, so the natural flow
is pay-without-validating, the inverse of what the operator asked for.

**Gate-checked live (why this is code-only):**

- `office_expenses` SELECT policy: `submitted_by = auth.uid() OR coalesce(current_user_role() in ('super_admin','accounting'), false)` — see-all is already permitted at the DB. The wall is UI-only.
- `office_expense_attachments` SELECT follows the parent row with the same predicate.
- `OFFICE_EXPENSE_FINANCE_ROLES` = `ACCOUNTING_ROLES` = `MONEY_REVIEW_ROLES` membership (`accounting`, `super_admin`) — every viewer of the new scope can open the review voucher and act there. No affordance-then-refuse (the three-layer rule: affordance == action == RPC).
- `list_money_events_for_review(p_tab, p_project, p_month, p_limit, p_offset, p_source_table, p_source_id)` accepts a source filter without a source id — one call returns review status (and `doc_count`) for the whole source. ⚠️ `p_limit` defaults to 50 and clamps at 200 — pass it explicitly (200), and the 100-row list cap keeps us inside the clamp.
- ⚠️ **`submitterName` is NOT readable on the authed session** (fact-check 2026-07-29): `public.users` RLS is self-read-only for `accounting` (only super_admin has full access), so a `users!office_expenses_submitted_by_fkey(full_name)` embed nulls for every row the accountant didn't submit. Names come from the **admin client behind the page's `requireRole` gate** — the exact spec-345 voucher precedent (`load-review-voucher.ts` reads `users` the same way). Still code-only; no grant change.

## 2. Design

### D1 — scope chips: `ของฉัน` / `ทั้งหมด` (finance only)

A `?scope=all` query param, rendered as two chips above the summary, **only for
`OFFICE_EXPENSE_FINANCE_ROLES`**. Everyone else sees the page exactly as today — no
chips, and a crafted `?scope=all` resolves to `own` at the server (explicit gate;
RLS is the second wall, not the first). The resolution lives in a pure
`resolveExpenseScope(role, raw)` so the whole role enum is testable.

Composes with the existing `?project=` lens and `?from=` referrer — all three params
survive chip/filter navigation.

### D2 — the all-expenses list

New `listAllExpenses(supabase, { projectId, month })` in `load-office-expenses.ts`:
the `OfficeExpenseRow` shape plus `submitterName` (admin-client seam — §1 wall) and
`docCount`. Ordered newest first, capped at 100 with a visible
`แสดง 100 รายการล่าสุด` note when the cap bites (no silent truncation).

**Review status and doc counts are not re-derived.** One call to
`list_money_events_for_review(p_tab: 'any', p_source_table: 'office_expenses',
p_limit: 200)` on the **authed session** (the DB gate reads the caller's role;
service-role coalesces to `''` and is refused — spec 345 lesson), joined to the
list by id: it already returns `review_status` AND `doc_count` per row. Absent
row = `รอตรวจ`. Spec 345's queue stays the SSOT; this page only displays it.

Each all-scope row shows: submitter · date · category · amount · project ·
receipt chip (`ไม่มีเอกสาร` when `docCount = 0`) · review-status chip
(`รอตรวจ` / `ติดธง` / `ตรวจแล้ว`) · link to
`/accounting/review/office_expenses/<id>?from=/expenses...` — the voucher is where
verify/flag live; this page adds **no write path**.

### D3 — the summary follows the scope

Under `ทั้งหมด`, the month total, the by-category breakdown and the
pending-reimburse figure all go firm-wide — the summary card must never disagree
with the list under it (the invariant the project lens already keeps, spec 323 U4).
The all-scope summary adds a **payment-source subtotal line** over the
`payment_source` enum (`company_card` / `own_money` / `company_direct`) using the
**existing SSOT labels** `PAYMENT_SOURCE_CARD_LABEL` (บัตรเครดิต) /
`PAYMENT_SOURCE_OWN_LABEL` (สำรองจ่าย) / `PAYMENT_SOURCE_DIRECT_LABEL`
(บริษัทจ่ายตรง) — `labels.ts:1241` — because reconciling the card statement against
card spend is a real monthly task. ⚠️ Payment source is orthogonal to reimbursement
state (live: 16 of 19 open reimbursements are `company_card` rows) — the subtotal
line is spend-by-source only; ค้างคืนเงิน stays its own figure.

Every label that says or implies "ของฉัน" is re-justified under the new meaning
(the changed-behaviour-relabels rule) and pinned in both scopes.

### D4 — month filter on the all scope

Consolidation is monthly. The all scope gets the same `เดือน` + `ดูทุกเดือน`
control `/accounting/review` already has (same param name `m`, same
degrade-to-default posture for crafted values). Default = current Bangkok month.
The own scope keeps today's no-filter behaviour — a personal list is short.

### D5 — validate-before-pay signal on the reimburse queue

Each reimburse-queue row gains the receipt chip and the review-status chip (the
`list_money_events_for_review` call runs whenever `isFinance` — the queue renders
in both scopes, so the call is not conditional on `scope=all`) and links to the
voucher. **Soft signal only at first ship — superseded 2026-07-29:** the
operator decided the HARD gate
(§5), so `บันทึกคืนเงิน` now requires review = verified at all three layers
(button · action · RPC, mig `20260813075871`).

**Amendment (build-time find, U2):** the queue's group names hit the same `users`
RLS wall — `listReimbursableExpenses` embeds `users.full_name` on the authed
session, which nulls for an `accounting` viewer (only super_admin reads all
users), so the person-grouped queue rendered `—` for every group for the exact
audience it serves. Fixed with the same admin-client seam (`resolveUserNames`),
shared with D2's submitter names.

### D6 — voucher back chip becomes referrer-aware

`/accounting/review/[source]/[id]` hardcodes its back chip to `/accounting/review`.
Threading `?from=` at a page that ignores it is worse than not threading one
(doctrine), so the voucher page gains `searchParams.from` +
`safeBackHref(from, "/accounting/review")` and is registered in
**`MULTI_PARENT_DETAILS`** (the nav-guard list for multi-parent _dynamic_ routes,
full `…/page.tsx` path — fact-check 2026-07-29: the route is already
auto-discovered as a detail route by `dynamicDetail`, so `STATIC_DETAIL` /
`STATIC_MULTI_PARENT` are the wrong lists and no accounting `DRILL_DOWNS` list
exists). ⚠️ `MULTI_PARENT_DETAILS`' assertion is a bare
`toContain("safeBackHref")`, satisfiable by an import line — mutation-check the
voucher registration actually bites (guard-carries-the-bug lesson).

## 3. Non-goals

- **No schema** ~~(as first shipped)~~ — superseded 2026-07-29: the §5 hard pay-gate ships migs `20260813075871`/`075872` (RPC body gate).
- **No verify/flag/write actions on /expenses.** The voucher stays the one door.
- ~~No hard gate of reimbursement on review state~~ — superseded 2026-07-29, operator decided the hard gate (§5, SHIPPED).
- ~~No CSV export~~ — shipped 2026-07-29 (#839, §5).
- Reimburse queue grouping/settle mechanics unchanged.

## 4. Units

- **U1 (code-only):** `expense-scope.ts` resolver + chips · `listAllExpenses` +
  review-status join · summary-follows-scope + payment-source subtotals · month
  filter. Touches `src/app/expenses/page.tsx`, `src/lib/expenses/*`,
  `src/components/features/expenses/expense-list.tsx` + `expense-summary.tsx`,
  `labels.ts` (additive).
- **U2 (code-only):** voucher `?from=` + nav-guard registrations · reimburse-queue
  chips + voucher links. Touches the voucher page,
  `tests/unit/nav-back-affordance.test.ts`, `reimburse-queue.tsx`.

U1 ships alone safely (adds only); U2 completes the doors. Split checked against
the removes-a-signal rule: neither half removes an affordance.

⚠️ **Both units are danger-HELD in CI by path** (`src/app/expenses/` and
`src/app/accounting/` are in the danger-path deny list), so neither PR
GitHub-auto-merges — self-merge on green under the standing grant (the by-design
hold precedent, e.g. #827/#829) or operator one-tap.

### Tests (both units)

- Exhaustive-domain resolver test: iterate `Object.keys(USER_ROLE_LABEL)`, assert
  the positive set is EXACTLY `["accounting", "super_admin"]` — an enum-add or a
  widening both red.
- RTL: submitter + review chip render under `ทั้งหมด`, absent under `ของฉัน`;
  summary label swap pinned in both directions; non-finance `?scope=all` case.
- Source pin (comments stripped, ≥ actual-use-count occurrences) that the page
  calls the resolver; absence pins on retired literals bare, not quote-wrapped.
- Every assertion mutation-checked; commit before mutating (pre-flight
  `git status --porcelain` per batch).

## 5. Follow-ups / operator decisions logged

- ✅ **Hard validate-before-pay — DECIDED + SHIPPED 2026-07-29** (operator: hard
  gate). `mark_expense_reimbursed` refuses an unverified expense (P0001
  "expense not verified", mig `20260813075871`); the queue button renders only
  on verified rows, replaced by ต้องตรวจก่อนคืนเงิน + the voucher door; pgTAP
  `373-expense-pay-gate` pins absent/pending/flagged refuse + the verified
  positive control.
- ✅ **CSV export — SHIPPED 2026-07-29 (#839):** `/expenses/export` on the
  hardened `src/lib/csv` writer, ดาวน์โหลด CSV on the all-scope toolbar.
- ⬜ The 19 open reimbursements + 0 reviews are a live operational backlog, not a
  code gap — surfacing them to the accounting team is what this spec does; chasing
  them is theirs.

## 6. The verify assembly line (follow-up, 2026-07-29 — operator "Go")

The §5 hard gate makes per-voucher verification the accounting bottleneck (19
backlog on ship day). Bulk-verify was REJECTED — it would rubber-stamp the gate
§5 exists to enforce. Instead the flow chains:

- **Voucher chain door:** every review voucher renders `ตรวจรายการถัดไป` → the
  oldest OTHER pending event of the SAME source (one `p_tab:'pending'` RPC
  call, `p_limit: 2` — ids are unique so the first non-current id sits within
  two rows), threading the same `?from=` so the whole chain returns to one
  origin. Dry chain renders `ไม่มีรายการรอตรวจแล้ว` — deliberately NOT "all
  done": ⚠️ the pending tab EXCLUDES flagged rows, so a flagged backlog is
  invisible to the chain (flag resolution is its own flow on the voucher);
  the copy claims only what the query proves. The chain query lives in
  `loadReviewVoucher` (shared authed client; throws on error — a failed query
  must never masquerade as "nothing pending") and keys on the DB-normalized
  event id (a case-variant URL param must not make a door to itself). All 15
  sources get the door — the code path is source-generic.
  ⓘ The chain only advances by DECIDING (verify/flag) — standing on a pending
  voucher, the next door points at the oldest OTHER pending, so an undecided
  reviewer ping-pongs between the two oldest by design; a skip affordance is a
  possible follow-up. Ties in the RPC order (same date+amount) make "oldest"
  non-deterministic for some sources — acceptable, every pending row is still
  reachable by deciding.
- **Entry door on /expenses (all scope):** `เริ่มตรวจรายการเก่าสุด (N)` → the
  oldest pending expense FIRM-WIDE (deliberately not month-filtered — the
  backlog must not hide behind a view); N = pending count from the review map
  already in hand.
- Pure `pickNextPending` in `src/lib/accounting/review-chain.ts`; never
  returns the current voucher (a door must not lead to itself).
