# Spec 99 — Split Contacts into three groups

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = operator phone — PM-gated).
**Driver:** operator — "ติดต่อ is quite packed, do you think it's better to separate out clients and suppliers?"

## Why

`/contacts` crammed **five** RadioChip tabs (ลูกค้า / ผู้ขาย / ผู้รับเหมา / DC / ผู้ให้บริการ) into one
screen, and the status filter (ปกติ/ทดลองงาน/บัญชีดำ) showed on only three of them — so the screen
behaved differently per tab. Packed + inconsistent. The data model already bifurcates: clients +
suppliers are office orgs (tax id / payment / bank, no status); contractors/DC/service are rated
field crews (status / blacklist / crew). Splitting by workflow declutters each screen.

## Decision (operator call)

**Three groups**, each its own screen, all reached from ตั้งค่า › ข้อมูลหลัก (**no new bottom-bar
tabs** — preserves the spec-93 declutter):

| Group                                 | Route                 | Tabs                          |
| ------------------------------------- | --------------------- | ----------------------------- |
| ลูกค้า (customers)                    | `/contacts/customers` | ลูกค้า (single — no chip row) |
| ผู้ขาย/ผู้ให้บริการ (vendors you pay) | `/contacts/vendors`   | ผู้ขาย · ผู้ให้บริการ         |
| ผู้รับเหมา/DC (labor crews)           | `/contacts/crews`     | ผู้รับเหมา · DC               |

Bare `/contacts` → redirect to `/contacts/customers` (keeps old links + the bottom-bar `/contacts`
match alive). Detail route `/contacts/[type]/[id]` unchanged (type ∈ clients/suppliers/contractors/
service-providers; group segments customers/vendors/crews are distinct, no collision).

Minor wrinkle (accepted): ผู้ให้บริการ carries status but sits in the vendors group, so the status
filter shows on that one tab only — far less conditional than the old 5-tab screen.

## What ships

- **`src/lib/contacts/groups.ts`** — pure: `ContactGroup` = customers|vendors|crews; `ContactTab` =
  clients|suppliers|service|contractors|dc; `CONTACT_GROUP_TABS` (group → ordered tabs);
  `STATUS_TABS` (the tabs that show the status filter: contractors/dc/service). The testable seam.
- **`contacts-tabs.tsx`** — gains a `group` prop; renders only that group's tabs (chip row hidden for
  a single-tab group), row arrays now optional. Field defs / create-update wiring / status badge
  unchanged.
- **Routes** — `app/contacts/customers/page.tsx`, `app/contacts/vendors/page.tsx`,
  `app/contacts/crews/page.tsx` (each fetches only its tables, renders `<ContactsTabs group=…>`);
  `app/contacts/page.tsx` → `redirect("/contacts/customers")`.
- **`settings/page.tsx`** — the single ติดต่อ row in ข้อมูลหลัก becomes three: ลูกค้า (`Users`) ·
  ผู้ขาย/บริการ (`Store`) · ผู้รับเหมา/DC (`Hammer`). คนงาน (`HardHat`) unchanged.

## Tests

- `contacts-groups.test.ts` (TDD, RED→GREEN) — pins `CONTACT_GROUP_TABS` (each group's tabs + order)
  and `STATUS_TABS` membership.
- Pages + the `ContactsTabs` `group` wiring = verified-by-checklist (Server Components / client shell;
  the pure groups module carries the logic test, per project convention — spec 87 precedent).

## Seams (recorded)

- Naming of the three menu entries is operator-tweakable (look-loop).
- ผู้ให้บริการ status-filter-on-one-tab (see wrinkle) — could move service into crews if the operator
  prefers the strict status seam.
- A central nav/contacts registry — still not built; three group pages define their own fetches.
