// Spec 373 D1/D4 — the /expenses scope resolver. Pure: role + raw ?scope= in,
// scope out. The positive set is pinned EXACTLY (exhaustive-domain rule): an
// enum-add or a widening of the finance set both red here deliberately.

import { describe, expect, it } from "vitest";

import {
  canSeeAllExpenses,
  expenseMonthRange,
  resolveExpenseScope,
} from "@/lib/expenses/expense-scope";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { Enums } from "@/lib/db/database.types";

type UserRole = Enums<"user_role">;
const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

describe("spec 373 D1 — resolveExpenseScope", () => {
  it("the roles that may see the all scope are EXACTLY accounting + super_admin", () => {
    expect(ALL_ROLES.filter((r) => canSeeAllExpenses(r)).sort()).toEqual([
      "accounting",
      "super_admin",
    ]);
  });

  it("every role resolves to own without the param", () => {
    for (const role of ALL_ROLES) {
      expect(resolveExpenseScope(role, undefined)).toBe("own");
    }
  });

  it("scope=all resolves to all ONLY for the finance pair; crafted values degrade to own", () => {
    for (const role of ALL_ROLES) {
      const expected = canSeeAllExpenses(role) ? "all" : "own";
      expect(resolveExpenseScope(role, "all")).toBe(expected);
      // Crafted garbage never widens.
      expect(resolveExpenseScope(role, "ALL")).toBe("own");
      expect(resolveExpenseScope(role, "everything")).toBe("own");
      expect(resolveExpenseScope(role, ["all", "own"])).toBe(expected);
    }
  });
});

describe("spec 373 D4 — expenseMonthRange", () => {
  it("a valid month yields [start, next-month) bounds", () => {
    expect(expenseMonthRange("2026-07", "2026-07-29")).toEqual({
      month: "2026-07",
      start: "2026-07-01",
      endExclusive: "2026-08-01",
    });
  });

  it("December rolls the year", () => {
    expect(expenseMonthRange("2026-12", "2026-07-29")).toEqual({
      month: "2026-12",
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
  });

  it("'all' means unbounded", () => {
    expect(expenseMonthRange("all", "2026-07-29")).toEqual({ month: "all" });
  });

  it("garbage degrades to the current Bangkok month, never a cast error", () => {
    for (const raw of [undefined, "2026-13", "07-2026", "drop table", ""]) {
      expect(expenseMonthRange(raw, "2026-07-29")).toEqual({
        month: "2026-07",
        start: "2026-07-01",
        endExclusive: "2026-08-01",
      });
    }
  });
});
