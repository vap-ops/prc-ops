// Spec 69 — DC payroll CSV download. requireRole(PM_ROLES) FIRST (money: the
// rate snapshot has zero authenticated grant; the report is built via the
// admin client). Reuses the same fetch + aggregation as the page, so the CSV
// and the on-screen figures can never disagree. no-store: a payroll export
// is always live, never a cached body.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { parsePayrollRange, payrollToCsv, buildPayrollFileName } from "@/lib/labor/payroll";
import { fetchPayrollReport } from "@/lib/labor/fetch-payroll";

export async function GET(request: NextRequest) {
  await requireRole(PM_ROLES);

  const { searchParams } = request.nextUrl;
  const range = parsePayrollRange(
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined,
    bangkokTodayIso(),
  );

  const admin = createAdminClient();
  const report = await fetchPayrollReport(admin, range);
  const csv = payrollToCsv(report, range);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildPayrollFileName(range)}"`,
      "Cache-Control": "no-store",
    },
  });
}
