// Spec 69 — ค่าแรง (wage) payroll CSV download. requireRole FIRST (money: the rate
// snapshot has zero authenticated grant; the report is built via the admin
// client). Gate = PAYROLL_VIEW_ROLES, the SAME set the /payroll page admits
// (spec 187 procurement parity; spec 252 accounting read-only) — the page
// shows every viewer the download button, and the CSV is the same derived
// read as the on-screen figures (write-free), so the two gates must match.
// Reuses the same fetch + aggregation as the page, so the CSV and the
// on-screen figures can never disagree. no-store: a payroll export is
// always live, never a cached body.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { PAYROLL_VIEW_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { parsePayrollRange, payrollToCsv, buildPayrollFileName } from "@/lib/labor/payroll";
import { fetchPayrollReport } from "@/lib/labor/fetch-payroll";

export async function GET(request: NextRequest) {
  await requireRole(PAYROLL_VIEW_ROLES);

  const { searchParams } = request.nextUrl;
  const range = parsePayrollRange(
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined,
    bangkokTodayIso(),
  );
  // Spec 309 — honour the same project scope as the page so the CSV matches.
  const projectId = searchParams.get("project") || undefined;

  const admin = createAdminClient();
  const report = await fetchPayrollReport(admin, range, projectId);
  const csv = payrollToCsv(report, range);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildPayrollFileName(range)}"`,
      "Cache-Control": "no-store",
    },
  });
}
