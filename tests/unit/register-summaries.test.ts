// Spec 149 U9b §Tests (TDD, RED first) — pure summaries for the /accounting
// registers. summarizeRetention totals the withheld 5% by status (open = held +
// due, the operator's "still owed to us" figure).

import { describe, it, expect } from "vitest";
import { summarizeRetention } from "@/lib/accounting/register-summaries";

const rows = [
  { status: "held", amountWithheld: 5000 },
  { status: "held", amountWithheld: 3000 },
  { status: "due", amountWithheld: 2000 },
  { status: "released", amountWithheld: 4000 },
  { status: "forfeited", amountWithheld: 1000 },
];

describe("summarizeRetention", () => {
  it("totals by status", () => {
    const s = summarizeRetention(rows);
    expect(s.held).toBe(8000);
    expect(s.due).toBe(2000);
    expect(s.released).toBe(4000);
    expect(s.forfeited).toBe(1000);
  });

  it("open = held + due (still owed to us)", () => {
    expect(summarizeRetention(rows).open).toBe(10000);
  });

  it("handles an empty register", () => {
    const s = summarizeRetention([]);
    expect(s.held).toBe(0);
    expect(s.open).toBe(0);
    expect(s.released).toBe(0);
  });

  it("ignores an unknown status without throwing", () => {
    const s = summarizeRetention([{ status: "weird", amountWithheld: 999 }]);
    expect(s.held).toBe(0);
    expect(s.open).toBe(0);
  });
});
