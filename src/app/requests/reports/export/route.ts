// Spec 262 U2 — the report's CSV export. requireRole(PURCHASE_REPORT_ROLES)
// FIRST — the SAME constant the page gates on (source-scan pinned by
// purchase-reports-export-gate.test.ts; the payroll page/route gate-drift
// bug is the named anti-pattern this must not repeat). Reuses the exact
// same parseReportQuery + purchase_report call as the page, so the CSV and
// the on-screen rows can never disagree. no-store: always a live read.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASE_REPORT_ROLES, isProcurementManagerTier } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import {
  mapReportRow,
  parseReportQuery,
  reportRowsToCsv,
} from "@/lib/purchasing/purchase-report-view";

export async function GET(request: NextRequest) {
  const ctx = await requireRole(PURCHASE_REPORT_ROLES);
  const canSeePurchaser = isProcurementManagerTier(ctx.role);

  const { searchParams } = request.nextUrl;
  const state = parseReportQuery(
    {
      preset: searchParams.get("preset") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      bucket: searchParams.get("bucket") ?? undefined,
      group: searchParams.get("group") ?? undefined,
      project: searchParams.get("project") ?? undefined,
    },
    bangkokTodayIso(),
    canSeePurchaser,
  );

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("purchase_report", {
    p_from: state.from,
    p_to: state.to,
    p_bucket: state.bucket,
    p_group_by: state.group,
    ...(state.projectId ? { p_project_id: state.projectId } : {}),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  const rows = (data ?? []).map((r) => mapReportRow(state.bucket, r));
  const csv = reportRowsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchase-report-${state.from.replaceAll("-", "")}-${state.to.replaceAll("-", "")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
