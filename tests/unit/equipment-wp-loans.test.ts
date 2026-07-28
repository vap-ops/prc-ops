// Spec 363 U7 — the WP ของ-tab เครื่องมือ section's pure shapers.
// shapeWpLoans: open loans AT THIS WP → display rows (aging days, who has it —
// borrower when recorded, else the recorder; the fact-check F5 rule).
// availableToBorrow: unit-tracked items currently at the WP's project, minus
// items already out on ANY open loan (one-open-span mirror of the RPC guard).

import { describe, expect, it } from "vitest";
import {
  availableToBorrow,
  loanDays,
  shapeWpLoans,
  type WpLoanLogRow,
} from "@/lib/equipment/wp-loans";
import type { EquipmentMovementRecord } from "@/lib/equipment/current-location";

const LOG = (over: Partial<WpLoanLogRow> = {}): WpLoanLogRow => ({
  id: "log-1",
  itemId: "item-1",
  workPackageId: "wp-1",
  checkedOutOn: "2026-07-20",
  borrowerWorkerId: null,
  enteredBy: "user-sa",
  ...over,
});

describe("spec 363 U7 — loanDays", () => {
  it("counts inclusive days from checkout to today", () => {
    expect(loanDays("2026-07-20", "2026-07-28")).toBe(8);
  });
  it("day 0 is วันนี้ (0 days)", () => {
    expect(loanDays("2026-07-28", "2026-07-28")).toBe(0);
  });
});

describe("spec 363 U7 — shapeWpLoans", () => {
  const items = new Map([
    ["item-1", "สว่านโรตารี่ Hilti"],
    ["item-2", "เครื่องตัดไฟเบอร์"],
  ]);
  const workers = new Map([["w-1", "สมชาย ใจดี"]]);
  const users = new Map([["user-sa", "อรปรีญา"]]);

  it("only THIS WP's open loans shape into rows, OLDEST first", () => {
    const rows = shapeWpLoans(
      [
        LOG({ id: "a", checkedOutOn: "2026-07-25" }),
        LOG({ id: "b", itemId: "item-2", checkedOutOn: "2026-07-26" }),
        LOG({ id: "other-wp", workPackageId: "wp-9" }),
      ],
      { items, workers, users, wpId: "wp-1", today: "2026-07-28" },
    );
    expect(rows.map((r) => r.logId)).toEqual(["a", "b"]); // oldest obligation first
    expect(rows[1]!.itemName).toBe("เครื่องตัดไฟเบอร์");
    expect(rows[1]!.days).toBe(2);
  });

  it("who = borrower when recorded, else the RECORDER (entered_by is always the scanning SA)", () => {
    const rows = shapeWpLoans(
      [LOG({ borrowerWorkerId: "w-1" }), LOG({ id: "log-2", itemId: "item-2" })],
      { items, workers, users, wpId: "wp-1", today: "2026-07-28" },
    );
    expect(rows.find((r) => r.logId === "log-1")!.holderName).toBe("สมชาย ใจดี");
    expect(rows.find((r) => r.logId === "log-2")!.holderName).toBe("อรปรีญา");
  });

  it("an unknown item id still renders (name falls back to the id) — a registry miss must not hide an open obligation", () => {
    const rows = shapeWpLoans([LOG({ itemId: "ghost" })], {
      items,
      workers,
      users,
      wpId: "wp-1",
      today: "2026-07-28",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.itemName).toBe("ghost");
  });
});

describe("spec 363 U7 — availableToBorrow", () => {
  const move = (itemId: string, projectId: string | null, at: string): EquipmentMovementRecord => ({
    itemId,
    kind: projectId ? "deployed" : "received",
    projectId,
    occurredAt: at,
  });

  const items = [
    { id: "item-1", name: "สว่าน", tracking: "unit" as const },
    { id: "item-2", name: "เครื่องตัด", tracking: "unit" as const },
    { id: "bulk-1", name: "นั่งร้าน", tracking: "bulk" as const },
  ];

  it("unit items deployed at the project, minus open loans, minus bulk", () => {
    const out = availableToBorrow({
      items,
      movements: [
        move("item-1", "p-1", "2026-07-01"),
        move("item-2", "p-1", "2026-07-01"),
        move("bulk-1", "p-1", "2026-07-01"),
      ],
      projectId: "p-1",
      openLoanItemIds: new Set(["item-2"]),
    });
    expect(out.map((i) => i.id)).toEqual(["item-1"]);
  });

  it("an item whose latest movement left the project is not offered", () => {
    const out = availableToBorrow({
      items,
      movements: [move("item-1", "p-1", "2026-07-01"), move("item-1", "p-2", "2026-07-02")],
      projectId: "p-1",
      openLoanItemIds: new Set(),
    });
    expect(out).toHaveLength(0);
  });
});
