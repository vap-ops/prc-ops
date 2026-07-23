# Spec 349 — Accounting nav redesign: work-queue-first, 4 destination tabs

**Status:** Draft (operator-approved design 2026-07-23, chat)
**Depends on:** spec 345 U1–U3 (`/accounting/review` live) · spec 313 U5 (`/accounting` hub chrome)
**Serialize behind:** lane 348parity (spec 348 touches `role-home.ts` + role-set constants — same SSOTs)

## 1. Problem

The `accounting` role has 2 bottom tabs (บัญชี `/accounting` + ตั้งค่า `/settings`, spec 149 U9)
while its real surface grew to 11 sub-routes plus a review workflow. 30-day
`interaction_events` (3 active accounting users, queried 2026-07-23):

| route                                        | hits     | note                                                                 |
| -------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `/accounting`                                | 220      | forced landing (GL dashboard)                                        |
| `/settings/company-docs`                     | 100      | #1 real destination — 2 taps deep behind ตั้งค่า                     |
| `/settings`                                  | 53       | mostly transit to company-docs                                       |
| `/accounting/purchases`                      | 30       | doc verification                                                     |
| `/accounting/projects` + details             | 37       | per-project money                                                    |
| `/accounting/retention`                      | 11       |                                                                      |
| PO detail                                    | 9        |                                                                      |
| billings / wht / payables / ledger / periods | 3–6 each | GL tail                                                              |
| `/accounting/review`                         | 1        | spec 345 queue, shipped 2026-07-22 — one link among 9 on the GL page |

The daily work (review queue, documents, purchases) is buried; the landing page
(trial balance) is the tail. Operator directive: work-queue-first.

## 2. Design (operator-approved)

Destination-tab grammar (same as the other 6 tabbed roles — the procurement
section-spine was considered and rejected: heavier build, would ratify the 2nd
grammar for another role while nav-coherence-audit Decision 2 is still open, and
telemetry maps cleanly onto 3–4 destinations).

`ACCOUNTING_TABS` 2 → 4 (under the 5-tab nav-law ceiling), `ACCOUNTING_HUB_NAV`
mirrors it (nav law rule 2, strip ⊇ bar — enforced by
`tests/unit/nav-law-strip-superset.test.ts`):

| #   | tab     | href                     | why                                            |
| --- | ------- | ------------------------ | ---------------------------------------------- |
| 1   | งานตรวจ | `/accounting/review`     | new **roleHome** — the daily queue lands first |
| 2   | บัญชี   | `/accounting`            | GL dashboard + its 8 drill-downs, untouched    |
| 3   | เอกสาร  | `/settings/company-docs` | 100 hits/30d promoted from 2-tap burial        |
| 4   | ตั้งค่า | `/settings`              | universal hub                                  |

Nothing is removed: every current surface keeps its door (U3 removes only two
home-page rows whose destinations became tabs in U1 — the affordance moves up,
never away).

### Design decisions

- **D1 landing flip.** `roleHome("accounting")` → `/accounting/review`
  (`role-home.ts:530` today returns `/accounting`). `/accounting` stays a live
  hub one tab over; bookmarks unaffected.
- **D2 review page chrome.** `/accounting/review` today renders `DetailHeader`
  (back → `/accounting`). As a landing it gets hub chrome (AppHeader +
  HubNav strip, no back chip) — the exact swap spec 313 U5 did for
  `/accounting`. Reclass in `nav-back-affordance.test.ts` from the
  STATIC_DETAIL list (line ~74) to the hub bucket; deliberate guard trip.
- **D3 เอกสาร tab lights correctly by the existing longest-prefix rule.**
  `/settings/company-docs` (22 chars) beats `SETTINGS_TAB` href `/settings` —
  no `match` surgery needed. The page KEEPS its `DetailHeader` (back →
  `/settings`): it stays a drill-down that happens to own a tab for this one
  role (precedent: `/payroll` lights ตั้งค่า via `match` while being a
  drill-down). No guard reclass for it.
- **D4 super_admin never strands — runtime yes, invariant needs one edit.**
  `ACCOUNTING_ROLES` = accounting + super_admin; super is served PM chrome.
  At RUNTIME `SETTINGS_TAB.match` claims `/accounting` and the bar uses
  `startsWith` longest-prefix (`bottom-tab-bar.tsx:242-250`), so ตั้งค่า lights
  on `/accounting/review` for super — no stranding (the spec-313 U5 `/legal`
  class, checked at design time). BUT the promoted-hub invariant
  (`nav-law-strip-superset.test.ts:66-74`) tests EXACT membership
  (`(t.match ?? []).includes(href)`), not prefix, and its `PROMOTED` fixture
  lists only `/accounting` + `/legal`. U2 therefore (i) adds
  `{ href: "/accounting/review", roles: ACCOUNTING_ROLES }` to `PROMOTED` and
  (ii) adds `"/accounting/review"` to `SETTINGS_TAB.match` — a runtime no-op
  (prefix already lights it) that makes the exact-match clause hold for super.
  Alternative (rejected for blast radius): rewrite the clause to prefix
  matching. Fact-check catch 2026-07-23.
- **D5 MA business unit = non-goal.** Operator ruled MA is the same legal
  entity (new business line): one set of books, no entity dimension owed.
  Future BU rollup = an additive nullable `business_unit` label on projects +
  grouping in existing project-scoped GL reads. Nothing here prepares for it
  and nothing here makes it harder. Do not re-litigate.
- **Badge on งานตรวจ deferred** — pending-count badge belongs to spec 345 U5
  (notifications), not this spec.

## 3. Units

### U1 — tabs + strip (code-only, auto-merge)

`ACCOUNTING_TABS` and `ACCOUNTING_HUB_NAV` 2 → 4 per the table. Icons:
งานตรวจ `ListChecks` (already imported), เอกสาร `FileText` (new import).
`/accounting` home page untouched (its review + docs rows become redundant
with the tabs — removed in U3, kept here so U1 is purely additive).

- Failure modes: wrong tab lights on `/accounting/review` (both งานตรวจ and
  บัญชี prefix-match; longest wins — RED-first test pins งานตรวจ) · strip ⊄ bar
  (existing invariant test catches) · tab count > 5 ceiling (documented
  convention in `ui-conventions.md` §12, review-enforced — NO automated guard
  exists; 4 tabs is under it regardless).
- Tests: tab-set contents pin (≥2-occurrence rule for constants), active-tab
  resolution for `/accounting/review`, `/accounting`, `/settings/company-docs`,
  `/settings`; mutation-check each.

### U2 — landing flip + review hub chrome (DANGER-HELD: `role-home.ts`)

`roleHome("accounting")` → `/accounting/review`; review page `DetailHeader` →
AppHeader + HubNav (same PR — a landing with a back chip pointing sideways is
incoherent chrome; `HubNav` requires `maxWidthClass`); `nav-back-affordance`
reclass; roleHome fixture update (exhaustiveness guard trips by design); the
two D4 edits (`SETTINGS_TAB.match` += `"/accounting/review"`, `PROMOTED`
fixture += the review hub) so the promoted-hub invariant actually covers the
new hub for every gated role.

- Failure modes: accounting user lands on queue they cannot act on (cannot
  happen — page gate is `ACCOUNTING_ROLES`, identical to the old landing's
  gate) · super_admin opens `/accounting/review` and sees no "you are here"
  (D4 — RED-first: add the `PROMOTED` entry BEFORE the match edit and watch
  the super_admin case fail, then green it) · view-as accounting must land
  the queue (accounting ∈ `ASSUMABLE_ROLES`, `effective-role.ts:41`).
- Recovery: flip is one line; revert restores `/accounting` landing.

### U3 — home trim (code-only, auto-merge)

`/accounting` page: remove the `MONEY_REVIEW_LABEL` row and the
`COMPANY_DOCS_LABEL` row from the link list (both are tabs after U1/U2; the
labels stay exported — other consumers exist). Everything else on the page
stays.

- Failure mode: removing a row deletes the only door for some OTHER gated role
  — does not apply: the only roles that can open `/accounting` are
  `ACCOUNTING_ROLES`, both of which carry the new tabs (accounting) or reach
  the surfaces via their own chrome (super_admin: `/accounting/review` via the
  settings match; company-docs via `/settings`).
- Tests: absence pins on the two removed rows (bare literals, not
  quote-wrapped), presence pins on the surviving links.

## 4. Verification (per unit)

- `pnpm lint && pnpm typecheck && pnpm test` + the named RED-first tests.
- Real-flow: dev-preview login, view-as `accounting` (in `ASSUMABLE_ROLES` —
  gate-check at build), walk all 4 tabs on phone viewport + strip on desktop;
  zero console errors. U2 additionally: login lands `/accounting/review`.
- `pnpm db:test` once per session (doctrine — queue-ejection insurance); no
  schema in any unit.

## 5. Non-goals

- MA/BU dimension (D5). Review-count badge (345 U5). Voucher correction UI
  (345 U4b). `/payroll` `?from` param rename (nav-coherence audit). Section-spine
  ratification (audit Decision 2). site_owner/auditor homes (313 U6 owns them).
