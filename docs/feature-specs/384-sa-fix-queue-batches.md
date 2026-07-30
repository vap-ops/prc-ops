# Spec 384 — ต้องแก้ไข arrives in batches, not one at a time

**Status:** DRAFT · **Origin:** operator, 2026-07-31 — _"sa home is now an infinite scroll"_, refined to _"main problem is with the rejected WPs that require attention"_ · **Scope:** CODE-ONLY. No schema, no new route, no new RPC.

Sibling of [375](375-sa-home-movement-sort.md) (which owns the `งานของฉัน` list) and the SA-side mirror of [371](371-review-queue-focus.md) (which solved this exact shape on the PM's `/review`).

---

## 1 · The measurement

All figures live on prod, queried 2026-07-31.

### 1.1 The SA home is ~27,000px — and the attention section is the top 6,000 of it

| Block                           | Rows    | Height                     |
| ------------------------------- | ------- | -------------------------- |
| `ต้องแก้ไข` (`SaActionSection`) | **38**  | ~160px each ⇒ **~6,000px** |
| `งานของฉัน` (spec 375 U1 list)  | **140** | ~150px each ⇒ ~21,000px    |
|                                 |         | **≈ 40 phone screens**     |

`ต้องแก้ไข` renders **above** the muster strip, today's plan, the custody pair and the tools grid. Everything the SA needs on an ordinary morning sits below six thousand pixels of amber.

### 1.2 The 38 are homogeneous, and they arrived together

| Reason (`approval_revision_reason`) | n   | Age           |
| ----------------------------------- | --- | ------------- |
| `incomplete` → `รูปไม่ครบ`          | 16  | 1–3 days      |
| `mismatch` → `รูปไม่ตรงกับงาน`      | 13  | 2–3 days      |
| _no reason_ (pre-spec-355 rows)     | 7   | **6–10 days** |
| `rework` (status, not a decision)   | 2   | —             |

**All 36 bounces are `needs_revision`. Zero are `rejected`** — the red `ไม่อนุมัติ` arm of `SaActionSection` has never fired on live data (`select count(*) from approvals where decision='rejected'` = 0).

Decisions per day show why: the PM reviews in **sweeps**, not a trickle.

| Date     | approved | needs_revision |
| -------- | -------- | -------------- |
| 07-21    | 35       | **16**         |
| 07-27    | 12       | **12**         |
| 07-28    | 28       | **13**         |
| 07-29/30 | 6        | 5              |

So the SA does not receive one bounce and act on it. She receives **twelve to sixteen at once, most of them carrying the same reason and the same next action**, and the surface renders sixteen separate self-explaining cards each repeating that reason and that CTA.

The section's own header comment states the assumption it was built on: _"pinned above งานของฉัน, each row self-explaining"_. That is right for 1–3 items and wrong for 16.

### 1.3 The loop closes for 40% of bounces

- **60** WPs have ever been bounced. **24** reached `approved` (40%); **36** are still open.
- `wp_evidence_resubmitted` audit rows, lifetime: **14**.
- Of the 36 open bounces, **0 are answered** — none has a resubmit row against its current decision.

⚠️ **Do not read "reasonless bounces go stale" out of §1.2.** The 7 reasonless rows are stale _and_ reasonless, but spec 355 shipped the reason on 2026-07-24 — so reasonless ⇔ decided before 07-24 ⇔ older, by construction. The confound is total; this data cannot separate the two. What it does establish is the boundary in §2.2: **the age distribution has an empty gap between 3 and 6 days.**

### 1.4 ⭐ The camera FAB cannot open a single one of the 38

`src/app/sa/page.tsx`:

```
const inPlay = wps.filter((w) => w.status !== "pending_approval");
const { actions, rest } = buildSaActionList({ inPlay, … });
const items = rest;                       // rest = inPlay minus rework
const captureWps = items.map(…);          // → <CameraFab wps={captureWps} />
```

`inPlay` drops every `pending_approval` WP, and `buildSaActionList` then drops `rework` from `rest`. So `captureWps` is **exactly the complement** of `actions`: the picker's domain is every WP that is _not_ asking for a photo. All 36 bounced + 2 rework WPs are unreachable from the SA's most-used control.

They are still reachable through each card's CTA (`#wp-photos`), so this is not a block — but the FAB exists because _"capture is the daily loop's most-used action"_, and it declines to offer the 38 work packages that were explicitly asked for photos.

Secondary: the picker sheet is an unsearchable flat list of **140** rows — a third scroll wall, inside a bottom sheet.

### 1.5 The precedent this spec copies

Spec 371 met the same shape from the PM's side: a 70-item `/review` queue where only 52 rows were the PM's move. Its answer, already shipped and in `labels.ts`, was **zones plus a start button rather than a scroll** — `REVIEW_START_HERE_CTA = "เริ่มตรวจงานเก่าสุด"`, `REVIEW_AWAITING_SITE_ZONE_LABEL`, `REVIEW_ACTIONABLE_ZONE_LABEL`. The two surfaces are the two ends of one loop; they should speak one vocabulary.

---

## 2 · Design

### 2.1 Shape

```
ต้องแก้ไข  38
┌──────────────────────────────────────────┐
│ ค้างเกิน 3 วัน · 7 งาน                    │   ← always expanded, oldest first
│   … full cards, exactly as today          │
└──────────────────────────────────────────┘
▸ รูปไม่ครบ · 16 งาน · เก่าสุด 3 วัน
▸ รูปไม่ตรงกับงาน · 13 งาน · เก่าสุด 3 วัน
   งานแก้ไข · 2 งาน                            ← ≤3 items: no collapse, cards inline
```

- **Stale first, always open.** A row older than the boundary in §2.2 is the one actually being dropped, and it is never part of a fresh sweep. It keeps the full card it has today.
- **A fresh batch collapses to one row per reason.** Tap expands the cards in place. Collapsed, a group costs one 48px row instead of sixteen 160px cards.
- **A group of ≤3 renders expanded**, no tap. Hiding two cards behind a chevron costs more than it saves, and `rework` is a 2-row group today.
- **Inside every group, oldest first.** Today the order is `kind → projectCode → code` — alphabetical within a kind, which scatters a 10-day-old row among rows from this morning.
- Height: **~6,000px → ~700px**, with no row removed and no row moved off the page.

**The age each row is sorted and banded by** is _when it landed back on the SA_, and it already exists on both paths:

| Kind                    | Age source                                                    | Read                                                                      |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `revision` / `rejected` | `approvals.decided_at` of the latest decision                 | already fetched — `getLatestDecisionsForWorkPackages` selects it          |
| `rework`                | `created_at` of the latest `wp_reopened_for_defect` audit row | the page's `reopenRes` query already orders by it; add it to the `select` |

So U1 adds **one column to one existing select** and no new round trip. `SaActionItem` gains one field (`sinceIso`). ⚠️ A rework row whose reopen audit row is missing has no age — it sorts last within its group and is **never** banded stale, because "unknown" is not "old". `reopens` is 2 lifetime, so this arm is real but unexercised: it needs a test, not a guess.

### 2.2 The stale boundary is **3 days**, and the data picks it

Ages present today: 1, 2, 3 … then nothing … then 6, 7, 8, 9, 10. The distribution is bimodal with an empty band at 4–5 days, because a sweep clears within its own cycle or not at all. `> 3 days` therefore separates "this morning's batch" from "the ones nobody came back to" without splitting either mode.

⚠️ **This is a distribution, and a distribution moves.** The constant lives in one place with the query that produced it written beside it, and §6's acceptance re-runs that query. If the empty band closes, the boundary is wrong and the spec is wrong with it.

### 2.3 The group key, stated exhaustively

`approvals_revision_reason_forbidden_unless_needs_revision` only **forbids** a reason outside `needs_revision` — it does **not require** one for `needs_revision`. A reasonless bounce is still writable at the DB level, so the grouping must be total, not a lookup that can miss:

| Row                      | Group label                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `revision` with a reason | `APPROVAL_REVISION_REASON_LABEL[reason]` — รูปไม่ครบ · รูปไม่ตรงกับงาน · งานยังไม่เสร็จ       |
| `revision`, no reason    | `APPROVAL_DECISION_LABEL.needs_revision`                                                      |
| `rejected`               | `APPROVAL_DECISION_LABEL.rejected`                                                            |
| `rework`                 | `งานแก้ไข` (a status, not a decision — it keeps its own label, as `KIND_META` already has it) |

Group order: the existing `KIND_ORDER` severity first (`rejected` → `rework` → `revision`), then **by oldest member, oldest group first**. Rows inside a group: oldest first. Every row lands in exactly one group and the stale band takes precedence over all of it.

⚠️ Do **not** implement this as a `Record` keyed on `revision_reason` with a `default:` arm — a reason added to the enum later would render into no group while typecheck stays green. Derive the key exhaustively over the union and let the compiler fail on a new member.

### 2.4 What stays exactly as it is

The card itself — tone, chip, reason line, per-reason CTA from `REVISION_REASON_GUIDANCE`, the premature special case, the `#wp-photos` deep link. Spec 355 got the card right. This spec only changes how many of them are on screen at once.

### 2.5 Why on `/sa` and not a new `/sa/fix` page

A red count at the top of a page with **855 views in 14 days** outranks a dedicated route. The measured failure mode is the opposite one: spec 339 U1 put a correct staleness detector on `/settings → เกี่ยวกับ`, a page site admins opened **70 times against 810 `/sa` visits**, and 14 of 15 active users stayed on a stale bundle for six days. `/sa/registrations` is the same story on this very page — 7 of 855 `/sa` visits reach it.

The collapse is the whole win. Moving the section would only re-buy the same win at the price of a route.

---

## 3 · Units

| #      | Unit                                                                                    | Scope                                                                                         |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **U1** | `ต้องแก้ไข` grouped: stale band + per-reason collapsible groups + oldest-first ordering | pure builder in `src/lib/sa/action-list.ts` + a client `SaActionSection`; page passes `nowMs` |
| **U2** | `CameraFab` domain = `actions` ∪ `rest`, bounced rows first                             | `src/app/sa/page.tsx` + `camera-fab.tsx`                                                      |
| **U3** | `CameraFab` picker gains type-to-find over code + name                                  | `camera-fab.tsx`                                                                              |

U1 is the operator's stated problem and ships first. **U2 is additive** — it only adds WPs to a picker — so it splits cleanly and can ship in either order. U3 is polish on the 140-row sheet and is optional until U2 lands.

`งานของฉัน` (the other 21,000px) stays with **spec 375** — the head-plus-door shape into the project hub's already-searchable, group-collapsed, three-lens list.

---

## 4 · Non-goals

- **Batch resubmit.** Answering sixteen bounces in one gesture is a real idea and a different spec — it needs a decision about whether one photo can answer several WPs. Spec 372 §5 already carries the bulk-decision question from the PM side.
- **Changing the bounce loop.** No new decision, status, RPC or audit event.
- **Chasing stale bounces.** Nothing notifies anyone about the 7. That is spec 372 §5's open item and stays there.
- **Re-styling the card.** See §2.3.

---

## 5 · Build traps

1. **`SaActionSection` becomes a Client Component** (collapse state). It is rendered by a Server Component page, so anything it imports must be RSC-safe — a shared constant goes in a leaf module with no `server-only` and no DB import. Spec 371 U2 shipped a 500 on `/dashboard` doing exactly this, and the full vitest suite stayed green through it: jsdom does not model the RSC boundary. **`pnpm build` is the gate, not the suite.**
2. **`Date.now()` in a Server Component render body is rejected by the React Compiler lint** ("Cannot call impure function during render"). Follow `coldCutoffFromNow` / `coldCutoffIso` from spec 375 U1: the grouping is a pure function of an injected `nowMs`, and the page reads the clock outside the render body.
3. **New Thai terms go in `labels.ts`.** The stale-band label and the group-row suffix are user-facing terms in 2+ places once tests pin them. Compose from the existing `APPROVAL_REVISION_REASON_LABEL` — do not retype `รูปไม่ครบ`, or the queue and the card can drift.
4. **The `rejected` arm has zero live rows** (§1.2). It must keep working and keep its red tone, but no test may assume it is reachable from production data, and no acceptance query may wait on it.
5. **Pin the grouping behaviourally, not by source scan.** A fixture with known decision ages, then a mutation back to the flat alphabetical order. A source scan proves only that the helper is imported — and pin the _use count_, not `≥2`: the stale band and the group list are two separate uses.
6. **Enumerate every branch the section renders** and give each an assertion that dies with it: stale band present/absent, a ≤3 group rendering expanded, a >3 group rendering collapsed, an empty section returning `null`. Spec 371's guard had 13 assertions and an entire zone could still be deleted green.
7. **Contiguity is an invariant, like spec 375's cold rule.** The stale band is a boundary claim about the rows near it: assert that no row inside a reason group is older than the boundary, so the band and the groups cannot disagree.
8. **U2 changes what a control can reach.** `CameraFab` returns `null` at zero WPs and links directly at exactly one; widening the domain moves both boundaries. Its existing tests cover the old domain — re-justify each.

---

## 6 · Acceptance — a fill rate, not a green suite

Baselines, 2026-07-31:

```sql
-- ① does the loop close more often?  baseline: 14 lifetime
select count(*) from audit_log where payload->>'event' = 'wp_evidence_resubmitted';

-- ② does the open backlog fall?  baseline: 36 open / 24 closed of 60 ever-bounced
with latest as (
  select distinct on (work_package_id) work_package_id wpid, decision::text dec
  from approvals order by work_package_id, decided_at desc
)
select l.dec, count(*) from latest l
join (select distinct work_package_id wpid from approvals where decision='needs_revision') b
  on b.wpid = l.wpid
group by 1;

-- ③ is the 3-day boundary still real?  baseline: modes at 1–3 and 6–10, empty at 4–5
with latest as (
  select distinct on (work_package_id) work_package_id wpid, decision::text dec, decided_at
  from approvals order by work_package_id, decided_at desc
)
select (now()::date - decided_at::date) age, count(*) from latest l
join work_packages wp on wp.id = l.wpid
where wp.status in ('pending_approval','in_progress') and l.dec in ('needs_revision','rejected')
group by 1 order by 1;
```

**A green suite proves nothing here.** ① rising and ② shifting toward `approved` is the only evidence the redesign worked; ③ unchanged is the only evidence the boundary in §2.2 is still honest. If ① is flat a week after U1+U2 ship, the wall was not what stopped her, and the next unit is batch resubmit (§4), not more layout.
