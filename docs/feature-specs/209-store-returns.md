# Spec 209 — store returns: separate "fix a wrong entry" from a real "return"

**Status:** PROPOSED — 2026-06-27. Trigger: operator flagged the label **กลับรายการ**
as ambiguous, then ("it's not just about the label") asked to rethink the _flow_.

Investigation found the ambiguity is a symptom: one mechanism — an append-only,
**all-or-nothing mistake-undo** (`reverse_stock_receipt` / `reverse_stock_issue`,
spec 177 U11, `20260809000500`) — is surfaced with **physical-movement wording**
("ของจะถูกคืนเข้าสโตร์" / "ตัดออกจากสโตร์"), so users reach for it to handle real
returns it cannot do correctly. Store-only (ADR 0065) makes returns routine, so the
flow gap now matters.

## The three distinct events (today collapsed into one "กลับรายการ")

| Event                                                                     | What it needs                                                      | Today                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Wrong entry** (typo, duplicate, never happened)                         | full void at original cost, before any downstream use; append-only | ✅ `reverse_stock_*` — correct for THIS                                              |
| **Material returned from a WP → store** (offcuts, leftovers, job changed) | **partial** qty, defined cost basis, any time, repeatable          | ❌ not modelled — void is full-only, blocked once consumed, re-adds at original cost |
| **Return to supplier** (defective / over / wrong delivery)                | **credit note**: AP ↓ + Input VAT ↓, partial, supplier subledger   | ❌ not modelled                                                                      |

The void mechanism is sound _as a mistake-undo_ and stays. This spec adds the **real
WP→store return** as a first-class movement and **renames the mistake-undo** so the two
stop colliding. Return-to-supplier is a **named follow-up** (its own spec — it's an
AP/VAT credit-note feature, see spec 208 out-of-scope Gap 2).

## Operator decisions (2026-06-27, AskUserQuestion)

1. **A WP→store return re-enters the store at the ISSUE cost** (`stock_issues.unit_cost`
   — the moving-avg cost the WP was charged). Symmetric: it reverses exactly that much
   WP cost and restores that much store value. (Not current moving-avg.)
2. **Build the WP→store return now**; defer supplier returns/credit-notes to their own spec.
3. (Implied) the mistake-undo is **relabelled** and reserved for genuine wrong entries.

## Model — the WP→store return

A return is a **new append-only movement** (NOT a void): material physically moves
WP → store. It is the partial inverse of a `stock_issues` row.

**`stock_returns`** (new table, append-only):
`id, project_id, catalog_item_id, issue_id → stock_issues(id), work_package_id, qty,
unit, unit_cost (snapshot = the issue's unit_cost), total_cost (generated qty*unit_cost),
note, returned_by, returned_at`.

- **Partial + repeatable:** unlike `stock_reversals` (one-per-movement), an issue may have
  several returns. **Guard:** `sum(stock_returns.qty for issue) ≤ stock_issues.qty` —
  cannot return more than was issued (net of prior returns). No unique-per-issue index.
- Rolls `stock_on_hand`: `qty_on_hand += qty`, `total_value += qty*unit_cost`.

**`return_stock_to_store(p_issue_id uuid, p_qty numeric, p_note text)`** (SECURITY DEFINER):

- Gate: `SITE_STAFF_ROLES` + `can_see_project` (mirrors who issues — เบิก is site-staff; a
  return is the same custody action). `revoke … from public, anon` + null-safe gate.
- Validate `p_qty > 0` and `p_qty ≤ (issue.qty − already-returned)`; else `22023`.
- Insert `stock_returns`, roll `stock_on_hand`, enqueue the GL job (do not post inline —
  the receipt/issue posters drain async; mirror that).

**GL (the inverse of the issue's cost posting):** `Dr 1500 Inventory / Cr 1400 WP-WIP` at
`p_qty * issue.unit_cost`. The issue posted cost-only (Dr 1400 / Cr 1500, `20260809001900`
§3 — "total_cost is the COST snapshot, NOT the sell"), so the return mirrors it exactly.
A new `post_stock_return_to_gl` (modelled on the issue poster, reversed) + an enqueue
trigger + the `drain_gl_posting` arm.

**`wp_profit` (sell-basis, ADR 0060/0065):** the WP's material cost in `wp_profit` is the
**sell** transfer value of issues, not the GL cost. A return must **reduce the WP's
material by the returned proportion at the SELL basis** — i.e. `wp_profit`'s issue term
must net `stock_returns`. **PRECONDITION (U1):** confirm how `wp_profit` sources issues
(spec 178 U4 sell layer) and net returns there, or the WP P&L will overstate material
after a return. Add a pgTAP that a return reduces the WP's `wp_profit` material by the
returned sell amount.

**Cost-basis note:** returning at the issue cost (not current moving-avg) shifts the
store's moving average slightly toward the issue cost when other receipts have changed it
since — accepted (operator decision 1; it keeps the WP reversal exact, which is what
matters for P&L).

## Units

### U1 — `stock_returns` + `return_stock_to_store` + GL + wp_profit net **[ADDITIVE-DB, money → operator-sign-off]**

Failing test first (pgTAP): a partial return of an issued line (a) inserts one
`stock_returns`, (b) rolls `stock_on_hand` +qty/+value at issue cost, (c) posts
`Dr 1500 / Cr 1400` at `qty*issue.unit_cost` (drain synchronously, mirror test 213),
(d) blocks `qty > issued − returned` (22023), (e) reduces the WP's `wp_profit` material by
the returned sell amount, (f) is repeatable up to the issued qty, (g) anon/role gates hold.

### U2 — WP-detail return UI **[UI]**

On the WP detail page (where เบิก lives, `wp-issue-stock.tsx`), each issued line gets a
**"คืนเข้าสโตร์"** action with a **partial-qty** input (default = remaining returnable),
confirm "คืน {qty} {unit} เข้าสโตร์ — ต้นทุนจะกลับเข้าสโตร์และลดต้นทุนของงานนี้". Show the
remaining-returnable per issued line. Site-staff only (mirror issue).
Failing test first: returnable-qty math + the action calls `return_stock_to_store`.

### U3 — relabel the mistake-undo + single-source the term **[UI]**

The void (`reverse_stock_*`) is **mistake correction**, not a return. Relabel its buttons
**`แก้รายการที่บันทึกผิด`** (and confirm copy "ลบรายการรับเข้า/เบิก ที่บันทึกผิด") across the
store rows (`store-manager.tsx`) and WP (`wp-issue-stock.tsx`); reserve "คืน…เข้าสโตร์"
for U1/U2. **Lift both terms into `labels.ts`** as the single source (the labels are
hardcoded inline today — the drift that caused the ambiguity). Doctrine: [[ui-term-consistency-ssot]].
Failing test first: a labels test pins the two distinct terms; a guard that the store/WP
components use the labels, not inline strings.

## Ship order

```
U1  stock_returns + return_stock_to_store + GL + wp_profit net   [ADDITIVE-DB, money 🔴]
U2  WP-detail "คืนเข้าสโตร์" partial-return UI                     [UI]
U3  relabel mistake-undo → "แก้รายการที่บันทึกผิด" + labels SSOT  [UI]
```

U1 carries the money/GL change (held PR, operator sign-off). U2/U3 are UI (auto-eligible).

## Out of scope (named follow-ups)

- **Return to supplier / credit notes** (AP ↓ + Input VAT ↓, partial, supplier subledger) —
  own spec; spec 208 Gap 2.
- **Store-to-store / inter-project transfer** — spec 208 Gap 5.
- **Damage / loss / write-off** beyond the ตรวจนับ count adjustment — own spec.

## Open questions

1. **`wp_profit` netting (U1 precondition).** Confirm the issue→sell source so returns net
   at the sell basis (else WP P&L overstates material post-return). Blocks U1.
2. **Returnable window.** Any time while the WP is open? After WP completion/lock, a return
   should be blocked (or routed via the mistake-undo). Confirm the guard.
3. **Who returns.** Site-staff (custody), mirroring เบิก — confirm procurement is excluded
   (it is for issue; returns are the same physical-custody action).
