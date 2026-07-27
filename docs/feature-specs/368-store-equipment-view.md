# Spec 368 — Equipment in the project store, and the site move

**Status:** U1 shipped 2026-07-28. U2/U3 planned.
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

## 5. Non-goals

- Migrating tools into `catalog_items` / stock (§2).
- Any write affordance in the store section (§3).
- The PRI transfer, which spec 367 §3 still owns and which is now open again.
