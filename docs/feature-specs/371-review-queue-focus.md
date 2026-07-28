# Spec 371 — review queue: focus split (whose move is it?)

**Status:** U1 in build · **Schema:** none (code-only)
**Origin:** operator, 2026-07-28 — _"pm doesn't know where to focus on approval page, rejected items are counted as well"_

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

Row chip: **`รอมา N วัน`** (days since queue entry). This replaces a status pill that
repeated the group heading on all 51 rows — the age is the only thing that differs
between them, so the age is what the chip should carry.

### Zone B — `รอหน้างานถ่ายรูปใหม่` (18), collapsed

Not the PM's move. Collapsed `<details>`, muted surface, and an explicit
**`ไม่นับในยอดรอตรวจ`** note so the exclusion is stated rather than inferred.

Row chip: the spec-355 reason (`รูปไม่ครบ` / `รูปไม่ตรงกับงาน` / `งานยังไม่เสร็จ`), falling
back to `รอถ่ายเพิ่ม` (`REVIEW_AWAITING_PHOTOS_LABEL`) for bounces that predate spec 355.
Live split of the 18: **11 carry a reason** (`mismatch` 7, `incomplete` 4 — `premature`
has no live rows here) and **7 are null**, all of them the older cohort. So the reason is
the common case and the fallback is the tail — but the tail is precisely the oldest,
most-stuck rows, so the fallback must read as a normal state, never as missing data.

Second chip: **`ส่งกลับไป N วัน`**, counted from the decision (`approvals.decided_at`),
not from queue entry. That is the number that says whether the site is stuck. The live
worst reads **7 วัน**: `daysSince` floors _elapsed 24-hour periods_, so it never
overstates a wait (the same row is 8 days apart by calendar date).

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
- **U2 (later, schema lane)** — make the counts agree with the page. The ภาพรวม badge
  and the `PendingApprovalsCard` hero both count bare `status='pending_approval'`; the
  actionable subset needs "latest decision is not an unanswered `needs_revision`", which
  a client `head:true` count cannot express. Needs a view or a DEFINER read RPC.
  **Until U2 lands the badge still says 70 while the page says 52** — U1 is shipped
  knowing this, because the page is where the PM decides and the split there is the
  whole ask.

## 4. Non-goals

- No change to any decision RPC, to spec 15's oldest-first ordering _within_ a zone, or
  to what a WP's status means.
- No "nudge the site admin" action on zone B rows — chasing needs notification wiring
  and a rate rule; separate spec if the operator wants it.
