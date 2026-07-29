// Spec 373 D1/D4 — pure scope + month resolution for /expenses. The role gate
// lives HERE (one testable home), not scattered in the page: a crafted
// ?scope=all from a non-finance role resolves to "own" at the server, and RLS
// is the second wall, not the first.

import { OFFICE_EXPENSE_FINANCE_ROLES } from "@/lib/auth/role-home";
import type { Enums } from "@/lib/db/database.types";

type UserRole = Enums<"user_role">;

export type ExpenseScope = "own" | "all";

export function canSeeAllExpenses(role: UserRole): boolean {
  return OFFICE_EXPENSE_FINANCE_ROLES.includes(role);
}

export function resolveExpenseScope(
  role: UserRole,
  raw: string | string[] | undefined,
): ExpenseScope {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" && canSeeAllExpenses(role) ? "all" : "own";
}

// Spec 373 D4 — the all-scope month filter (mirrors /accounting/review: same
// param shape, same degrade-to-default posture — crafted values must never
// reach a date-typed DB predicate as a cast error).
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ExpenseMonthRange {
  month: string; // "YYYY-MM" or "all"
  start?: string; // inclusive ISO date
  endExclusive?: string;
}

export function expenseMonthRange(raw: string | undefined, todayIso: string): ExpenseMonthRange {
  if (raw === "all") return { month: "all" };
  const month = MONTH_RE.test(raw ?? "") ? (raw as string) : todayIso.slice(0, 7);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const endExclusive = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { month, start: `${month}-01`, endExclusive };
}
