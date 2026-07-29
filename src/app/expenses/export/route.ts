// Spec 373 §5 — office-expense CSV export for consolidation.
// requireRole(OFFICE_EXPENSE_FINANCE_ROLES) FIRST — the file dumps EVERY
// user's expenses, the same audience as the ทั้งหมด scope. Mirrors the journal
// export (src/app/accounting/journal/export): UTF-8 BOM for Excel/Thai,
// no-store (an export is always a live read). ?m=YYYY-MM|all + ?project=uuid
// degrade through expenseMonthRange / UUID_REGEX exactly like the page — a
// crafted param never reaches a date/uuid-typed DB predicate. Rows read on the
// AUTHED client (RLS admits finance firm-wide), names via the admin seam,
// review status from the shared paged RPC helper on the authed session.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { OFFICE_EXPENSE_FINANCE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { expenseMonthRange } from "@/lib/expenses/expense-scope";
import {
  fetchOfficeExpenseReviewMap,
  listAllExpensesForExport,
  type AllExpenseRow,
} from "@/lib/expenses/load-office-expenses";
import { buildExpenseExportFileName, officeExpensesToCsv } from "@/lib/expenses/expense-export";
import { UUID_REGEX } from "@/lib/validate/uuid";

export async function GET(request: NextRequest) {
  await requireRole(OFFICE_EXPENSE_FINANCE_ROLES);

  const { searchParams } = request.nextUrl;
  const range = expenseMonthRange(searchParams.get("m") ?? undefined, bangkokTodayIso());
  const projectParam = searchParams.get("project");
  const projectId = projectParam && UUID_REGEX.test(projectParam) ? projectParam : undefined;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [loaderRows, reviewMap] = await Promise.all([
    listAllExpensesForExport(supabase, admin, {
      ...(projectId ? { projectId } : {}),
      ...(range.start ? { monthStart: range.start } : {}),
      ...(range.endExclusive ? { monthEndExclusive: range.endExclusive } : {}),
    }),
    fetchOfficeExpenseReviewMap(supabase),
  ]);

  const rows: AllExpenseRow[] = loaderRows.map((r) => {
    const review = reviewMap.get(r.id);
    return {
      ...r,
      docCount: review?.docCount ?? 0,
      reviewStatus: review?.status ?? "pending",
      docsExpected: review?.docsExpected ?? "expected",
    };
  });

  return new NextResponse(officeExpensesToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildExpenseExportFileName(range.month)}"`,
      "Cache-Control": "no-store",
    },
  });
}
