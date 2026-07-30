# Spec 382 — Four photos per equipment item (ชุดรูปอุปกรณ์)

**Status:** draft · **Origin:** operator, 2026-07-30, verbatim: _"We need 3 types of
images — 1. รูปอุปกรณ์ 2. รูป name plate (ให้ติด serial number) 3. ยี่ห้อ … 4. Our QR
code"_ plus _"Show sample as instructions as well"_.
**Related:** [367](367-equipment-registry-completeness.md) §7 (the single-image U5
this replaces) · [370](370-equipment-scan.md) (the QR stickers being photographed) ·
[381](381-equipment-item-history.md) (the trail these swaps land in).

---

## 1. Why now, and why it is cheap

`equipment_items` is at **0 rows** — the spec-367 reset emptied it and the operator
has not started re-typing. So this changes the shape **before** the data exists:
no backfill, no half-documented fleet, and every item is born with four slots.
A week from now the same change costs a migration plus a chase list.

It is also the gate on spec 367 §3: the PRI transfer runs _"after updating the
images of all equipments in store"_ (operator, same day). "Updated" needs a
definition, and `รูป n/4` is it.

## 2. The four kinds

| Kind        | Thai           | What it is for                                                                                                                                       |
| ----------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item`      | รูปอุปกรณ์     | The machine as a whole — what it looks like on the shelf.                                                                                            |
| `nameplate` | เพลทเลขเครื่อง | The manufacturer's plate, **serial number legible**. The only proof that this row is that physical asset.                                            |
| `brand`     | ยี่ห้อ         | The maker's badge/logo on the body.                                                                                                                  |
| `qr_tag`    | QR ของเรา      | **Our** spec-370 sticker, photographed **on the machine** — proof the tag was actually applied, and the link between the printed label and this row. |

## 3. Decisions (taken with the operator, 2026-07-30)

- **D1 — exactly ONE photo per kind, replaceable.** Four slots, not a gallery.
  Re-shooting replaces that slot. Enforced by `unique (item_id, kind)`, so
  "documented?" stays a countable question.
- **D2 — optional, never blocking; completeness is a CHIP.** A save is never
  refused for a missing photo: a dead camera, a dark container or a tool already
  on a truck must still be recordable, and the registry is being typed right now.
  The row shows `รูป n/4`. That same count is the PRI-transfer readiness query.
- **D3 — samples are DRAWN, not photographed.** Each slot shows a small
  illustration of the _angle_ plus one Thai line. A real reference photo of one
  machine misleads for every other machine type, and drawing costs no assets, no
  storage, no upload, and works offline.
- **D4 — `equipment_items.image_path` becomes a MIRROR of the `item` kind**,
  maintained by trigger. The CSV export's `hasImage`, the page thumbnail and the
  spec-367 pgTAP pins keep working untouched, and an item-photo swap lands in the
  spec-381 history for free (that trigger already diffs `image_path`). The new
  table is the SSOT; the column is a derived convenience and is documented as such.
- **D5 — paths do not change.** `<itemId>/<uuid>.<ext>`, folder depth 1 — the only
  arm of the live `equipment-images` INSERT policy that admits the back office.
  Adding kinds must not become a storage-policy change.

## 4. Schema (U1)

```
equipment_photo_kind : enum ('item','nameplate','brand','qr_tag')

equipment_item_photos
  id            uuid pk
  item_id       uuid not null → equipment_items(id) on delete cascade
  kind          equipment_photo_kind not null
  storage_path  text not null
  created_by    uuid not null → users(id)
  created_at    timestamptz not null default now()
  unique (item_id, kind)
```

RLS mirrors `equipment_items`: readable by the `/equipment` audience, written by
the back office. No money columns, so no column-grant games — unlike its parent.

## 5. Units

| Unit   | Scope                                                                                                                                 | Schema?                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **U1** | enum + table + RLS + grants + the `image_path` mirror trigger + pgTAP                                                                 | **yes** — one migration                        |
| **U2** | the four-slot control (drawn guides + Thai lines) on the add and edit sheets, replacing the single control; `รูป n/4` chip on the row | no                                             |
| **U3** | Bulk "what is still missing" view for the PRI transfer prep                                                                           | no — after U2, if the chip proves insufficient |

## 6. Acceptance — a fill rate, not a green suite

```sql
select kind::text, count(*) from equipment_item_photos group by 1 order by 1;
select count(*) filter (where n = 4) as complete, count(*) as items
  from (select i.id, count(p.*) n from equipment_items i
          left join equipment_item_photos p on p.item_id = i.id
         group by i.id) t;
```

The second query is the PRI-transfer readiness number. Zero `qr_tag` rows after a
week of curation means the sticker step is not happening on the floor, whatever
the suite says.

## 7. Out of scope

- Several angles per kind (D1 — revisit if a nameplate genuinely needs two shots).
- OCR of the serial from the nameplate photo. Tempting, and a separate spec.
- Reference photos supplied by the operator (D3 — the drawn guide ships first).
- Retiring `image_path` (D4 keeps it; dropping a column is destructive and buys
  nothing while it is a cheap mirror).
