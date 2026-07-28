# Spec 368 — Equipment in the project store, and the site move

**Status:** U1 shipped 2026-07-28. U2/U3 planned. U4 designed + operator-approved
2026-07-28 (§6) — buildable after spec 363 U7 or spec 370 gives ยืม a write door.
**Origin:** operator, 2026-07-28, correcting spec 367's premise:

> All the items on equipment catalog is misplaced. They are supposed to be items
> in the store of the active project โพธิ์ทอง

> 1. Handle view in store, separate equipments from materials
> 2. All equipments will be transported to a new site soon, as โพธิ์ทอง is
>    approaching the end

## 1. The premise correction

Spec 367 assumed `equipment_items` was the right home and enriched it for a PRI
transfer. The operator's actual complaint is that the 64 tools are **not visible
where they physically live** — the store of the active project.

Live grounding (2026-07-28): โพธิ์ทอง = `PRC-2026-004` (TFM โพธิ์ทอง ลพบุรี),
**active**, store carrying **532 receipts across 398 catalog items**.
`equipment_items` = 64, with **1 exact name overlap** against `catalog_items`.
`catalog_items.kind` already has `tool` (8) and `equipment` (2) beside
`material` (584) — so the catalog _could_ hold tools.

## 2. D1 — tools stay in `equipment_items`; the STORE gains a view

The obvious reading ("move them into the store as stock") was **rejected on
evidence**, and point 2 of the directive is why.

Every stock routine was enumerated — `record_stock_in`, `issue_stock`,
`confirm_stock_issue`, `return_stock_to_store`, `reverse_stock_receipt`,
`reverse_stock_issue`, `record_stock_count`, `correct_stock_receipt`,
`issue_stock_bulk`, `record_stock_in_bulk` — and **there is no
project-to-project transfer of any kind.** Stock is per-project and stays there.

⇒ If the 64 tools became โพธิ์ทอง stock, then when โพธิ์ทอง closes there would be
**no supported way to move them to the new site**. The only route would be
reversing 64 receipts at one project and re-receiving them at another, which
fabricates ledger and GL events for a move that is neither a purchase nor a
disposal.

`equipment_movements` already models exactly this: `deployed` carries a
`project_id`, and the DB CHECK enforces
`(project_id IS NOT NULL) = (kind = 'deployed')`. "At this site" is a movement,
and the site move is one more movement.

ⓘ Returns were checked too and DO exist (`return_stock_to_store` +
`stock_returns` + `post_stock_return_to_gl`), so the durable-vs-consumable worry
was **not** the deciding factor. The transfer gap was.

## 3. U1 ✅ — the store view split

`src/lib/equipment/at-project.ts` (pure): item ids whose CURRENT location is a
deployment to this project. `StoreEquipmentSection` renders them on
`/projects/[id]/store` as `เครื่องมือและอุปกรณ์`, grouped by category, beside the
วัสดุ stock list — the separation the operator asked for.

**Read-only by design.** Moving a tool is a movement and that write path already
exists on `/equipment`; a second write path over one fact is how two surfaces
start disagreeing. Renders nothing when the set is empty, so a project with no
tools — and a viewer whose RLS cannot read `equipment_items` — gets no empty box.

**Backfill (data op, 2026-07-28):** 63 items had no movement at all, so they read
as `—` everywhere (the original bug behind the operator's first question). One
`deployed` movement per item was inserted for โพธิ์ทอง, noted as a backfill,
attributed to the super_admin account. The 64th already had a movement. Verified
after: 64 of 64 resolve to `PRC-2026-004`.

## 4. ▶ Next

- **U2 — bulk site move.** Select all equipment at project A → record `deployed`
  to project B in one action. This is the unit point 2 of the directive actually
  asks for; U1 only makes the current location visible. Needs the new site to
  exist as a project.
- **U3 — decide what `equipment_items` is for.** It may remain the durable-asset
  registry (recommended), but spec 367's PRI framing needs revisiting now that
  the premise has moved.
- **U4 — the SA operating view: ในคลัง / ยืมออก split + คืน at store.** §6.

## 5. Non-goals

- Migrating tools into `catalog_items` / stock (§2).
- MOVEMENT writes in the store section — receiving, site moves, maintenance,
  loss all stay on `/equipment` (§3's rule, narrowed by U4: a คืน closes a
  usage-log span, which is a different fact from a movement; see §6.3).
- A browse-and-borrow LIST in the store section. Borrowing is item-first at
  the WP (`ของ` tab, spec 363 D6/U7) or scan-first (spec 370, whose `สแกน`
  button may sit on this section's header — the scan, not the list, is the
  door).
- Per-WP borrow tracking for BULK-tracked items (operator call 2026-07-28:
  units only in v1; the 9 bulk rows always render under อยู่ในคลัง with qty).
- The PRI transfer, which spec 367 §3 still owns and which is now open again.

## 6. U4 — the SA operating view (designed 2026-07-28, operator-approved)

**Origin:** operator: _"Design how SA should see the equipments in store."_
Decisions locked in chat over mockups: **split view + คืน at store; ยืม stays
WP-side / scan-side; condition photos arrive with spec 370.**

The SA is custodian of every on-site tool (custody doctrine, 2026-06-27), but
U1's flat list answers only "what tools does this site hold" — not the
operating questions: **which are out, with whom, at which WP, for how long.**
`equipment_usage_logs` = 0 rows ever (spec 202 U2 was never built), so today
nothing can distinguish a tool on the shelf from one nine days gone.

### 6.1 The split

The `เครื่องมือและอุปกรณ์` section becomes two groups. Header counts change from
`64 รายการ` to `61 ในคลัง · 3 ยืมออก`.

- **`ยืมไปที่งาน (n)`** — first, only when non-empty: unit-tracked items with an
  OPEN usage log. Row = name · WP chip (links the WP detail) · `ยืม n วัน`
  (from `checked_out_on`; `ยืมวันนี้` for day 0) · who has it · **คืน** button.
  "Who" = `borrower_worker_id` when recorded (spec 370 U1 adds it), else the
  recorder — bare `entered_by` is ALWAYS the scanning SA under 370 D1, so it
  alone cannot answer the question (fact-check F5).
  Sorted oldest loan first — an open obligation with a clock (spec 363's rule).
- **`อยู่ในคลัง (n)`** — everything else at this project, grouped by category
  exactly as U1 renders today. Bulk-tracked rows always sit here with a `×qty`
  badge.

**Open-log derivation (copy, don't re-derive):** open :=
`checked_in_on IS NULL` **and** no other row's `superseded_by` points at it —
the literal anti-join in `check_out_equipment`'s availability gate
(`check_in_equipment` enforces the same rule as two sequential guards behind
an advisory lock). Never derive "out" from
`equipment_items.status`: a movement can clobber the `in_use` overlay mid-loan
(the RPC's own status re-derive comment says so).

### 6.2 คืน at the store

Tapping คืน opens a small sheet — item name, where/when it went out, a date
field (default today; the RPC accepts backdating but refuses a date before
check-out) — and calls the live `check_in_equipment(p_log, p_date)` RPC via a
new server action. No RPC change.

Gate: **`EQUIPMENT_MOVE_ROLES`**, which was verified live (2026-07-28) to equal
the RPC's own allowlist (`site_admin`, `project_manager`, `project_director`,
`procurement`, `procurement_manager`, `super_admin`) — affordance == action ==
RPC, the three-layer parity rule. For site_admin/project_manager the RPC
additionally requires project membership (`can_see_wp`) **on the WP the log
points at** — normally the same project as the store, but a cross-project loan
(tool at store X, WP of project Y) would refuse a non-member SA with 42501:
surface the RPC's message honestly, never swallow it. Non-movers (site_owner,
auditor…) still see the split read-only.

### 6.3 Why คืน here does not violate §3

§3 refused write affordances because a MOVEMENT recorded in two places lets two
surfaces disagree about one fact. A คืน is not a movement — it closes a
usage-log span (append-only supersede), and the physical event happens AT the
store: the worker hands the tool back to the SA standing there. The WP `ของ`
tab (spec 363 U7) and the scan flow (spec 370) call the same RPC — same fact,
same write path, multiple doors. Movements stay single-homed on `/equipment`.

### 6.4 Sequencing + empty state

With zero open logs the section renders **byte-identical to U1** (out-group
hidden when empty; no empty box — U1's rule). So U4 is additive and shippable
alone, but pointless alone: build after spec 363 U7 (WP-side ยืม) or spec 370
U2 (scan ยืม) gives check-out a door — and note the fleet-pricing prerequisite
(spec 370 header): `check_out_equipment` refuses unpriced items and
`daily_rate` is 0/64, so NO door works until that 🔔 is answered.
Recommended order: pricing call → 363 U7 → this → 370.

### 6.5 Tests

- Pure grouping fn (`splitStoreEquipment` or similar): open-log anti-join
  (superseded-log trap case), bulk-always-in, day-count, sort order —
  exhaustive over the row shapes, mutation-checked.
- RTL: both groups render; คืน gated by role (drive the gate, not the default
  lens); out-row WP chip href.
- Server action: role gate + RPC args; the RLS-client fixture throws on
  misuse (the fake-coverage lesson from `fetchWorkerBadgeCodes`).
- SSR probe per role on a live WP once a real log exists.
