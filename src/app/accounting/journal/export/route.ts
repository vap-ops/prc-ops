// Spec 288 U1 — GL journal CSV export for the external accountant.
// requireRole(ACCOUNTING_ROLES) FIRST (accounting + super_admin only, the
// read-only ledger audience). Mirrors the payroll export (src/app/payroll/export):
// admin client behind the gate (journal_entries/lines are RLS zero-grant — the
// server client would read nothing), one CSV row per journal LINE, UTF-8 BOM for
// Excel/Thai, no-store (an export is always a live read). Optional
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive); missing/bad/inverted → current month.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/require-role";
import { ACCOUNTING_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { bangkokTodayIso } from "@/lib/dates";
import {
  parseJournalRange,
  journalEntriesToCsv,
  buildJournalFileName,
} from "@/lib/accounting/journal-export";
import { loadJournalExportRows } from "@/lib/accounting/load-journal-export";

export async function GET(request: NextRequest) {
  await requireRole(ACCOUNTING_ROLES);

  const { searchParams } = request.nextUrl;
  const range = parseJournalRange(
    searchParams.get("from") ?? undefined,
    searchParams.get("to") ?? undefined,
    bangkokTodayIso(),
  );

  const admin = createAdminClient();
  const entries = await loadJournalExportRows(admin, range);
  const csv = journalEntriesToCsv(entries);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildJournalFileName(range)}"`,
      "Cache-Control": "no-store",
    },
  });
}
