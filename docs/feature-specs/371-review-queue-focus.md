# Spec 371 — review queue: focus split (whose move is it?)

**Status:** U1 in build · **Schema:** none (code-only)
**Origin:** operator, 2026-07-28 — _"pm doesn't know where to focus on approval page, rejected items are counted as well"_

## 1. The problem, measured live

`/review` lists every work package at `status='pending_approval'`, flat, oldest-first,
and the ภาพรวม badge counts the same set. Live on 2026-07-28:

| population                                      | count  | what it means                         | PM can act?       |
| ----------------------------------------------- | ------ | ------------------------------------- | ----------------- |
| never reviewed                                  | 51     | first pass owed                       | ✅ yes            |
| bounced, SA re-shot (`wp_evidence_resubmitted`) | 1      | ready for a second look               | ✅ yes            |
| bounced, **not** answered yet                   | 18     | the site admin owes photos, 4–14 days | ❌ no             |
| **total shown / badged**                        | **70** |                                       | **52 actionable** |

So a PM opening the page is told they owe 70 decisions when 52 are theirs. The 18
un-cured bounces are indistinguishable at a glance (one small `รอถ่ายเพิ่ม` pill on a
row otherwise identical to an actionable one), and they are interleaved throughout by
queue age, so scrolling does not separate them either.

Two clarifications the measurement settled, against the operator's wording:

- **"rejected items are counted as well" is about bounces, not `rejected`.** A true
  `rejected` decision leaves `pending_approval` outright (spec 337 F3 → the WP goes to
  `rework`), so no rejected WP is in this queue. What the operator is seeing counted is
  `needs_revision` — the PM already said "re-shoot these", and it is still sitting in
  their queue as if it were their move.
- **Neither project nor work-category is a usable focus axis here.** All 70 rows are in
  one project and all 51 first-review rows have `category_id = null`. The only axis with
  signal is _whose move is it_, which is what this spec groups by.

## 2. Design

One page, two zones, split on ball-in-whose-court. Nothing is hidden — the second zone
is collapsed, not removed, because it is exactly where a PM goes to chase the site.

### Zone A — `ตรวจได้ตอนนี้` (52)

The PM's actual worklist. Subtitle carries the oldest wait so the size of the backlog
is legible without counting rows. One primary action: **`เริ่มตรวจงานเก่าสุด`**, linking
straight into the oldest actionable WP — a 51-deep queue needs a start button, not a
scroll.

Two subgroups, in this order:

1. **`พร้อมตรวจอีกครั้ง`** — the answered bounces (existing `REVIEW_READY_AGAIN_LABEL`).
   Already ranked first today by `reviewQueueRank`; this makes the ranking visible as a
   heading instead of an unexplained ordering.
2. **`รอตรวจครั้งแรก`** — never-reviewed, oldest first (spec 15 order, unchanged).

Row chip: **`รอมา N วัน`** (days since queue entry). This replaces a status pill that
repeated the group heading on all 51 rows — the age is the only thing that differs
between them, so the age is what the chip should carry.

### Zone B — `รอหน้างานถ่ายรูปใหม่` (18), collapsed

Not the PM's move. Collapsed `<details>`, muted surface, and an explicit
**`ไม่นับในยอดรอตรวจ`** note so the exclusion is stated rather than inferred.

Row chip: the spec-355 reason (`รูปไม่ครบ` / `รูปไม่ตรงกับงาน` / `งานยังไม่เสร็จ`), falling
back to `รอถ่ายเพิ่ม` (`REVIEW_AWAITING_PHOTOS_LABEL`) for bounces that predate spec 355
— all 18 live rows have `revision_reason = null`, so the fallback is the common case
today and must not read as an error.

Second chip: **`ส่งกลับไป N วัน`**, counted from the decision (`approvals.decided_at`),
not from queue entry. That is the number that says whether the site is stuck; the live
worst is 8 days.

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

- No change to any decision RPC, to `reviewQueueRank`'s ordering within a zone, or to
  what a WP's status means.
- No "nudge the site admin" action on zone B rows — chasing needs notification wiring
  and a rate rule; separate spec if the operator wants it.
