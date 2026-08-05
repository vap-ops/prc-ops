# UX/UI audit 2026-08 — dispositions

Status record for the 2026-08-04 UX/UI audit. The audit's own artifacts (plan,
findings, gap analysis) live outside the repo beside `LANES.md`; **this file is the
in-repo record of what was decided**, so a later audit does not re-raise a gap that
was already shipped, refuted, or deliberately parked.

One line per gap. "Refuted" means the gap's premise was measured and did not hold —
those entries carry their evidence, because a refutation with no evidence gets
re-litigated.

## Shipped

| gap       | what landed                                                                                                     | PR      |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| G1 (S0)   | honest error-boundary copy + crash telemetry (`where: error_boundary`), so the crash rate is measurable at last | #936    |
| G2 (S1)   | light-theme muted-ink contrast sweep; `text-ink-muted` moved off readable copy                                  | #940    |
| G9, G15   | dark-mode danger badges and the commit-button contrast, folded into the G2 sweep                                | #940    |
| G12 (S2)  | the `wp-schedule-panel` remove control + the widened brace-aware tap-floor guard                                | #934    |
| G12 sweep | the 9 controls `TAP_RATCHET` had frozen with an owed marker; ratchet walked to zero owed                        | this PR |

## Refuted — do not re-raise without new evidence

### G5 — "29% of active users run a bundle 8–13 releases behind" (was S1)

**Refuted 2026-08-04.** Two independent reasons:

1. **The recipe was already shipped.** G5's remedy is "move the version signal out of
   `/settings` into shared chrome". That is spec 339 U2b (#847, merged 2026-07-29):
   `UpdateAvailableChip` is mounted unconditionally in the root layout. The audit
   measured the staleness on 08-01/03, after that shipped.
2. **"Releases behind" is not a staleness metric on this repo.** `chore(release)` runs
   **8–27 times per day** (measured off `origin/main`), so "8–13 releases behind" is
   typically **under one day**. Per-device over 21 days, every genuinely active user's
   bundle advances constantly — 27 to 98 distinct versions across 15–19 active days.
   The entire "stuck" cohort is **1–4 active days and 4–37 events**: people who rarely
   open the app, and whose version still advances between sessions (one went
   `0.219.0` to `0.304.0`, another `0.133.0` to `0.219.0`).

**Carry:** a version-distance metric carries no time information. Convert it to elapsed
time before ranking on it.

**What is genuinely open, and is a different finding:** `UpdateAvailableChip` emits no
telemetry at all — no offer, apply, or dismiss event — so nobody can distinguish "never
fires" from "fires and is ignored". That is an instance of the audit's Class A ("the app
cannot see its own failures"). Not built here: it needs a new `FrictionEventType`, which
is a database enum add, and the schema lane was held.

## Parked by operator decision

### G3 — the accounting verification layer has never been used (was S1)

**Operator ruling 2026-08-04: aspirational, not expected day-to-day.** Nobody is
currently expected to work the `/accounting/review` queue, so the near-zero fill rate is
the intended state and not evidence of UI friction. **No UX pass was run and none is
owed.** GL itself is healthy and current, so money tracking is unaffected — what is
deferred is the human document-compliance trail spec 345 describes.

Re-open only if the operator changes that expectation. The check is one query:
`select status, count(*) from money_event_reviews group by 1`.

### G6 — the external portals have never been opened (was S1)

**Measured 2026-08-04 rather than assumed** (the operator was unsure, and telemetry alone
cannot separate "never invited" from "invited, claim path broken"):

- `client_invites` 2 rows, `contractor_invites` 1 row, `worker_invites` 0 rows.
- **Zero claimed, all-time.**
- Newest invite 2026-06-16.
- **Zero `route_view` rows all-time on any claim or portal route** — the only matches for
  "contractor" are internal `/contacts/*` admin pages.

So no invite link has ever been opened by anyone: the claim path has **never been
exercised**, and there is no evidence it is broken. The portals are **dormant
pre-launch**, correctly parked. Do not scope portal UX work off a zero-view number
until invites are actually sent.

**Loose end for the operator:** those 3 unclaimed invites are still outstanding.

## Still open

Unchanged from the gap analysis, in the audit's own ranking: G4 (dead surfaces triage),
G7 (`/login` emits no telemetry), G10 (health-notice recency,
danger path), G11 (pinch-zoom disabled app-wide), G13 (four spellings of "no documents"),
G14, G16, G17, G18.

## G8 — CLOSED 2026-08-06

**The audit under-scoped it, and building to the recorded wording would have re-done
finished work.** G8 was written as "procurement home paints a dead frame — a
`loading.tsx`, and `/expenses` owes the same one-liner". The procurement half had
**already shipped on 08-04** (`src/app/procurement/loading.tsx` plus a derived guard
over `roleHome()`), so the remaining scope was never one file.

Swept the destinations users actually land on — derived from the nav SSOTs
(`tabsForRole` hrefs, their `match` sub-surfaces, `hubNavForRole` strips) over the
complete role domain — and found **six** uncovered routes, none carrying a `Suspense`
fallback either:

| Route                | Awaited reads | Traffic (14d)                |
| -------------------- | ------------- | ---------------------------- |
| `/team`              | 12            | 368 views / 9 users          |
| `/registrations`     | 5             | 39 views                     |
| `/expenses`          | 10            | 23 views                     |
| `/store/corrections` | 6             | —                            |
| `/register/*`        | 2             | QR landing / redirect target |
| `/login`             | 4             | every user's first screen    |

`/team` is heavier than `/procurement`, the instance the audit named, and was never
mentioned. The last three were found by the unit's fresh-eyes review, not the sweep.

**Why the old guard could not see them:** it derived its routes from `roleHome()` —
role HOMES only. The guard now covers the nav destination set as well, still derived,
and additionally **renders every `loading.tsx` on disk** (a file that exists but paints
nothing satisfies an `existsSync` check while being no boundary at all). The ancestor
walk now stops above the root, so a single `src/app/loading.tsx` can no longer satisfy
every assertion at once. Guard: `tests/unit/nav-loading-boundaries.test.ts`.

⚑ Out of scope, spun off: `/portal`'s hand-rolled skeleton paints but announces nothing
to a screen reader — the only boundary in the repo without `PageSkeleton`'s `sr-only`
line.
