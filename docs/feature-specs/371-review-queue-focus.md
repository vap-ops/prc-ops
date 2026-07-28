# Spec 371 — review queue: focus split (whose move is it?)

**Status:** U1 shipped (#814, code-only) · U2 in build (additive schema — one view, mig `075864`)
**Origin:** operator, 2026-07-28 — _"pm doesn't know where to focus on approval page, rejected items are counted as well"_, then on seeing U1 — _"Amount 70 items is misleading, how about separating them?"_

## 1. The problem, measured live

`/review` lists every work package at `status='pending_approval'`, flat, oldest-first,
and the ภาพรวม hero counts the same set. Live on 2026-07-28:

| population                                      | count  | what it means              | PM can act?       |
| ----------------------------------------------- | ------ | -------------------------- | ----------------- |
| never reviewed                                  | 51     | first pass owed            | ✅ yes            |
| bounced, SA re-shot (`wp_evidence_resubmitted`) | 1      | ready for a second look    | ✅ yes            |
| bounced, **not** answered yet                   | 18     | the site admin owes photos | ❌ no             |
| **total shown / badged**                        | **70** |                            | **52 actionable** |

So a PM opening the page is told they owe 70 decisions when 52 are theirs. The 18
un-cured bounces are marked only by one small `รอถ่ายเพิ่ม` pill on a row otherwise
identical to an actionable one — and because the list is ordered by queue age, **12 of
the 18 sit in one unbroken block at rendered positions 2–13, ahead of the very first
never-reviewed row.** The dozen rows a PM meets on opening the page are almost entirely
not their move. (The other 6 are scattered down to position 43.)

Three clarifications the measurement settled, against the operator's wording:

- **"rejected items are counted as well" is about bounces, not `rejected`.** A true
  `rejected` decision leaves `pending_approval` outright — the live body of
  `decide_work_package` sets `status='rework'` and bumps `rework_round` (spec 337 F3) —
  so no rejected WP is in this queue. What the operator is seeing counted is
  `needs_revision`: the PM already said "re-shoot these", and it is still sitting in
  their queue as if it were their move. ⚠️ The corroborating live query is vacuous on
  its own — **no `rejected` row has ever been written to `approvals`**, so "zero rejected
  in the queue" would read the same whether or not F3 worked. The RPC body is the
  load-bearing evidence here.
- **The project axis is degenerate; the category axis exists but doesn't answer this.**
  All 70 rows are in one project. Work-category, however, **is** populated on all 70 —
  ⚠️ `work_packages.category_id` is an FK to **`project_categories`**, not to
  `work_categories`; a join to `work_categories` matches 0 of 70 rows and produces a
  false "uncategorised" reading (this spec asserted exactly that error before the
  fact-check). The 51 first-review rows span 6 project categories (สถาปัตยกรรม 19 ·
  โครงสร้าง 10 · ประปา 9 · ภายนอก 8 · ไฟฟ้า 4 · ปรับอากาศ 1). So grouping by trade is
  _possible_ — it is just not the fix: every trade group would still mix rows the PM can
  act on with rows they cannot, which is the actual complaint. Trade is a plausible later
  lens, not this unit's axis.
- **"the badge" is two different numbers.** The ภาพรวม hero (`PendingApprovalsCard`) is a
  pure `pending_approval` count = 70. The nav badge is a **sum of three queues** (WP
  review + contractor-bank + worker-bank changes) and reads 70 today only because both
  bank queues are live-empty. U2 fixes the WP term of that sum, not the sum.

## 2. Design

One page, two zones, split on ball-in-whose-court. Nothing is hidden — the second zone
is collapsed, not removed, because it is exactly where a PM goes to chase the site.

### Zone A — `ตรวจได้ตอนนี้` (52)

The PM's actual worklist. Subtitle carries the oldest wait so the size of the backlog
is legible without counting rows. One primary action: **`เริ่มตรวจงานเก่าสุด`**, linking
straight into the oldest actionable WP — a 52-deep queue needs a start button, not a
scroll.

Two subgroups, in this order:

1. **`พร้อมตรวจอีกครั้ง`** — the answered bounces (existing `REVIEW_READY_AGAIN_LABEL`).
   Spec 337 U2 already lifted these to the top of the flat list via `reviewQueueRank`;
   the zone heading makes that ordering legible instead of unexplained, and replaces
   the rank function — the partition IS the ranking now, so `reviewQueueRank` and its
   sibling `reviewQueueLabel` are deleted with their only consumer.
2. **`รอตรวจครั้งแรก`** — never-reviewed, oldest first (spec 15 order, unchanged).

Row chip: **`รอมาแล้ว N วัน`** (days since queue entry) — the wording already shipped on
the PO worklist, single-sourced as `waitingDaysChip` rather than minting a second
phrasing for one idea. It replaces a status pill that repeated the group heading on all
51 rows; the age is the only thing that differs between them, so the age is what the chip
should carry.

The one exception: a row whose latest decision is `approved` or `rejected` keeps its real
decision pill. Neither should ever be in this queue, but if one is, captioning it
"never reviewed" would be a lie — and this is the path where nobody would notice.

### Zone B — `รอหน้างานถ่ายรูปใหม่` (18), collapsed

Not the PM's move. Collapsed `<details>`, muted surface, and an explicit
**`ไม่นับในยอดด้านบน`** note so the exclusion is stated rather than inferred. The note is
scoped to _this page's_ number on purpose (it was written while the hero and badge still
counted these rows; U2 fixed those, and the scoped wording stays correct either way) —
and it renders only when there IS a number above it. When nothing is actionable the zone **opens
itself**, so an all-bounced queue is never a single collapsed bar with no way to tell
anything is behind it.

Row chip: the spec-355 reason (`รูปไม่ครบ` / `รูปไม่ตรงกับงาน` / `งานยังไม่เสร็จ`), falling
back to `รอถ่ายเพิ่ม` (`REVIEW_AWAITING_PHOTOS_LABEL`) for bounces that predate spec 355.
Live split of the 18: **11 carry a reason** (`mismatch` 7, `incomplete` 4 — `premature`
has no live rows here) and **7 are null**, all of them the older cohort. So the reason is
the common case and the fallback is the tail — but the tail is precisely the oldest,
most-stuck rows, so the fallback must read as a normal state, never as missing data.

Second chip: **`ค้างมา N วัน`**, counted from the decision (`approvals.decided_at`), not
from queue entry. That is the number that says whether the site is stuck; the live worst
renders **8 วัน**.

⚠️ Deliberately **not** `ส่งกลับ…`: that verb is already
`APPROVAL_DECISION_LABEL.rejected` (`ส่งกลับแก้งาน`), while this zone holds only
`needs_revision`. Spec 353 separated those two on purpose, and the operator report behind
_this_ spec is itself a rejected-vs-bounce conflation — using the rejected verb here
would hand it straight back.

Both chips count **Asia/Bangkok calendar days** (`daysWaiting`), not elapsed 24-hour
periods: `src/lib/dates.ts` fixes app dates to Bangkok civil dates (spec 46 C7), each row
renders `เข้าคิวเมื่อ` in that same timezone, and the app's other aging chip
(`poAgingDays` → `รอมาแล้ว N วัน`) already counts this way. An elapsed-ms floor put
`รอมาแล้ว 0 วัน` on a row stamped 23:30 the previous evening.

### Wording notes (gate-checked against the label SSOT)

- The re-shooter is the **site admin** (`USER_ROLE_LABEL.site_admin = ผู้ดูแลหน้างาน`) —
  so the zone reads `รอหน้างาน…`. `ช่าง` is the `technician` role and would name the
  wrong person.
- `รอหน้างานถ่ายรูปใหม่` composes `APPROVAL_DECISION_LABEL.needs_revision = ถ่ายรูปใหม่`
  (spec 353's evidence-vs-work framing), so the zone name and the decision name agree.
- `พร้อมตรวจอีกครั้ง` / `รอถ่ายเพิ่ม` / `รอตรวจครั้งแรก` are reused verbatim from the
  existing strings — no new synonym for a state that already has a name.

## 3. Units

- **U1 (this unit, code-only)** — the two-zone `/review` page: a new pure partition
  helper (`src/lib/approvals/review-queue.ts`), the zone rendering, the CTA, the day
  chips, additive labels. No data-shape change: the page already loads decisions and
  resubmit audit rows.
- **U2 (schema, additive)** — make the counts agree with the page. Operator, on seeing
  U1: _"Amount 70 items is misleading, how about separating them?"_ — so the fix is not
  merely to shrink the number to 52 but to show **both**, attributed.

  New view **`public.work_package_review_queue`** (`security_invoker = true`, the house
  pattern — all four pre-existing public views use it) classifies every pending WP into
  `first_review` / `ready_again` / `awaiting_site` and carries `bounced_at` +
  `revision_reason`. It is the ONE place the predicate lives, so the hero, the badge and
  the page derive their numbers from the same definition.
  - **Hero** (`PendingApprovalsCard`): headline **52 `ตรวจได้ตอนนี้`** with
    **`รอหน้างาน 18`** beside it. Its label had to change with its meaning — the old
    `งานรออนุมัติ` is equally true of the rows the count now excludes. When nothing is
    actionable but work IS waiting, the card says so rather than rendering its calm
    `ไม่มีงานรอตรวจ` empty state, which read as "nothing is happening" while N work
    packages sat with the site.
  - **Nav badge**: one `head:true` count against the view, `zone <> 'awaiting_site'`.
    The classification happens in SQL, so it stays a single round trip. ⚠️ Only the WP
    **term** of that badge moves — it is a sum of three queues (WP + contractor-bank +
    worker-bank).

  **Plan, measured:** the `distinct on` seq-scans `approvals` (189 rows live) and the
  zone's existence check is a bitmap index scan on `audit_log`; `work_packages` uses
  `work_packages_status_updated_idx`. Fine at pilot scale, and the same shape `/review`
  already ran in JS. If `approvals` grows an order of magnitude, correlate the CTE to the
  pending set with a `LATERAL` instead — in a NEW migration, never by editing `075864`
  (an applied migration re-pushed silently no-ops).

  ⚠️ **The counts are RLS-scoped per viewer, by design and worth knowing.** Probed live
  2026-07-28: `project_manager` "Moo" sees **0** of the 70 — `can_see_project` consults
  `project_members` for `project_manager` / `site_admin` / `site_owner` / `auditor`, and
  she is not a member. It returns true unconditionally for `super_admin`,
  `project_coordinator`, `project_director` and `procurement_manager`, which is why the
  project_directors who actually work this queue see the full 70 = 52 + 18. A pgTAP
  negative control therefore CANNOT use a project_director — it would see everything and
  look like a view bug.

## 3b. Open question surfaced by U2 (not implemented)

The project card on the same dashboard shows **`70 งานต้องดูแล`**, one row below the
hero's new 52. It is a _different_ metric — `rollupProgress`'s `needsAttention` counts
`on_hold + pending_approval + rework`, i.e. work needing **any** human, not the PM's
queue — and today it reads 70 only because the live composition is 70 `pending_approval`

- 0 `on_hold` + 0 `rework`. It is not wrong, but two numbers 70 and 52 an inch apart,
  both about "work needing attention", is the same class of confusion this spec exists to
  remove. Deciding what `งานต้องดูแล` should mean (the PM's work? anyone's?) is an
  operator call, so U2 leaves it alone.

## 4. Non-goals

- No change to any decision RPC, to spec 15's oldest-first ordering _within_ a zone, or
  to what a WP's status means.
- No "nudge the site admin" action on zone B rows — chasing needs notification wiring
  and a rate rule; separate spec if the operator wants it.
