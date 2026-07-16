// FB-4620 — the itemized (line-level) CSV export, sibling to
// /requests/reports/export (which emits the bucket×group summary). Procurement
// asked for the ordered items (ชื่อ + จำนวน + ราคา) to plan the next project of the
// same client. requireRole(PURCHASE_REPORT_ROLES) FIRST — the SAME constant the
// page + summary export gate on (pinned by purchase-reports-export-gate.test.ts;
// the payroll page/route gate-drift bug is the anti-pattern this must not repeat).
// Reuses parseReportQuery so its period/project scope can never drift from the
// page's. Reads via the admin client (purchase_requests RLS excludes accounting —
// the register pattern). no-store: always a live read.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASE_REPORT_ROLES, isProcurementManagerTier } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import { parseReportQuery } from "@/lib/purchasing/purchase-report-view";
import { loadPurchaseLineItems } from "@/lib/accounting/load-purchase-line-items";
import { purchaseLineItemsToCsv } from "@/lib/purchasing/purchase-line-export";

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

  const admin = createAdminClient();
  const rows = await loadPurchaseLineItems(admin, state.from, state.to, state.projectId);
  const csv = purchaseLineItemsToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="purchase-items-${state.from.replaceAll("-", "")}-${state.to.replaceAll("-", "")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
