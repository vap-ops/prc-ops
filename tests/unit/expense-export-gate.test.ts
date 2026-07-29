// Writing failing test first.
//
// Spec 373 §5 follow-up — export route gate. The CSV dumps EVERY user's
// expenses, so it must admit only OFFICE_EXPENSE_FINANCE_ROLES (accounting +
// super_admin — same audience as the ทั้งหมด scope). Source-scan pins, the
// journal-export-gate pattern. Unlike the zero-grant journal, expense ROWS are
// read on the AUTHED client (RLS admits finance firm-wide); the admin client
// is only the users-name seam, and the review RPC must stay on the authed
// session (the DB gate reads the caller's role; service-role is refused).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICE_EXPENSE_FINANCE_ROLES } from "@/lib/auth/role-home";

const ROUTE = join(process.cwd(), "src", "app", "expenses", "export", "route.ts");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const route = () => stripComments(readFileSync(ROUTE, "utf8"));

describe("expense export gate (spec 373 §5)", () => {
  it("gates on requireRole(OFFICE_EXPENSE_FINANCE_ROLES) BEFORE any client or read", () => {
    const src = route();
    expect(src).toContain("requireRole(OFFICE_EXPENSE_FINANCE_ROLES)");
    // Placement is the property, not presence — a gate below the reads passes
    // a bare toContain (fresh-eyes).
    expect(src.indexOf("requireRole(")).toBeLessThan(src.indexOf("createClient("));
  });

  it("OFFICE_EXPENSE_FINANCE_ROLES is exactly accounting + super_admin", () => {
    expect([...OFFICE_EXPENSE_FINANCE_ROLES].sort()).toEqual(["accounting", "super_admin"]);
  });

  it("month degrades through expenseMonthRange (never a raw param into a date predicate)", () => {
    expect(route()).toContain("expenseMonthRange(");
  });

  it("responds as an attachment with no-store (an export is always a live read)", () => {
    const src = route();
    expect(src).toContain("attachment; filename=");
    expect(src).toContain("no-store");
  });
});
