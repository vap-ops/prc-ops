import "server-only";

// Spec 345 U3 — loader for the money-event review voucher. The EVENT row comes
// through the DEFINER union RPC on the AUTHENTICATED session (tab 'any' +
// source filters — the same SSOT body as the queue). The review state, flags,
// source documents and the GL trail are read via the admin client BEHIND the
// page's requireRole gate (the sealed tables have no other read path) —
// firm-wide by design: the accountant audits the whole firm. Registered in
// money-read-policy.ts.

import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import type { MoneySourceTable } from "@/lib/accounting/review-queue-view";
import type { ReviewQueueRow } from "@/components/features/accounting/review-queue-list";

export interface ReviewVoucherFlag {
  id: string;
  flagType: string;
  raisedByKind: string;
  status: string;
  detail: string | null;
  flaggedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface ReviewVoucherDoc {
  label: string;
  url: string;
}

export interface ReviewVoucherData {
  event: ReviewQueueRow;
  review: {
    id: string;
    status: "pending" | "verified" | "flagged";
    verifiedAt: string | null;
    verifiedVia: string | null;
    verifiedByName: string | null;
    note: string | null;
  } | null;
  flags: ReviewVoucherFlag[];
  docs: ReviewVoucherDoc[];
  journal: { id: string; entryNo: number; entryDate: string } | null;
}

// The three sources that carry documents today (spec 345 §1.1); U6 adds wage +
// client-receipt attachments and extends this map.
const DOC_SOURCES: Partial<
  Record<MoneySourceTable, { bucket: string; table: string; fk: string; label: string }>
> = {
  purchase_requests: {
    bucket: "pr-attachments",
    table: "purchase_request_attachments",
    fk: "purchase_request_id",
    label: "เอกสารใบขอซื้อ",
  },
  office_expenses: {
    bucket: "expense-attachments",
    table: "office_expense_attachments",
    fk: "office_expense_id",
    label: "ใบเสร็จ",
  },
  rental_settlements: {
    bucket: "rental-settlement-receipts",
    table: "rental_settlement_attachments",
    fk: "settlement_id",
    label: "เอกสารปิดยอด",
  },
};

export async function loadReviewVoucher(
  sourceTable: MoneySourceTable,
  sourceId: string,
): Promise<ReviewVoucherData | null> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("list_money_events_for_review", {
    p_tab: "any",
    p_limit: 1,
    p_offset: 0,
    p_source_table: sourceTable,
    p_source_id: sourceId,
  });
  if (error) throw new Error(`review voucher event: ${error.message}`);
  const raw = rows?.[0];
  if (!raw) return null;

  const event: ReviewQueueRow = {
    sourceTable: raw.source_table as MoneySourceTable,
    sourceId: raw.source_id,
    projectId: raw.project_id,
    projectName: raw.project_name,
    amount: Number(raw.amount ?? 0),
    eventDate: raw.event_date,
    counterparty: raw.counterparty,
    docCount: raw.doc_count ?? 0,
    reviewStatus: raw.review_status as ReviewQueueRow["reviewStatus"],
    openFlagCount: raw.open_flag_count ?? 0,
    docsExpected: raw.docs_expected as ReviewQueueRow["docsExpected"],
  };

  const admin = createAdminClient();

  const { data: reviewRow } = await admin
    .from("money_event_reviews")
    .select("id, status, verified_by, verified_at, verified_via, note")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .maybeSingle();

  let review: ReviewVoucherData["review"] = null;
  let flags: ReviewVoucherFlag[] = [];
  if (reviewRow) {
    let verifiedByName: string | null = null;
    if (reviewRow.verified_by) {
      const { data: u } = await admin
        .from("users")
        .select("full_name")
        .eq("id", reviewRow.verified_by)
        .maybeSingle();
      verifiedByName = u?.full_name ?? null;
    }
    review = {
      id: reviewRow.id,
      status: reviewRow.status,
      verifiedAt: reviewRow.verified_at,
      verifiedVia: reviewRow.verified_via,
      verifiedByName,
      note: reviewRow.note,
    };
    const { data: flagRows } = await admin
      .from("money_review_flags")
      .select("id, flag_type, raised_by_kind, status, detail, flagged_at, resolved_at, resolution")
      .eq("review_id", reviewRow.id)
      .order("flagged_at", { ascending: false });
    flags = (flagRows ?? []).map((f) => ({
      id: f.id,
      flagType: f.flag_type,
      raisedByKind: f.raised_by_kind,
      status: f.status,
      detail: f.detail,
      flaggedAt: f.flagged_at,
      resolvedAt: f.resolved_at,
      resolution: f.resolution,
    }));
  }

  let docs: ReviewVoucherDoc[] = [];
  const docSource = DOC_SOURCES[sourceTable];
  if (docSource) {
    const { data: docRows } = await admin
      .from(docSource.table as "office_expense_attachments")
      .select("id, storage_path")
      .eq(docSource.fk as "office_expense_id", sourceId);
    const paths = (docRows ?? []).filter(
      (d): d is { id: string; storage_path: string } => d.storage_path !== null,
    );
    const urls = await mintSignedUrls(docSource.bucket, paths);
    docs = paths
      .map((d, i) => ({
        label: `${docSource.label} ${i + 1}`,
        url: urls.get(d.storage_path) ?? "",
      }))
      .filter((d) => d.url !== "");
  }

  const { data: je } = await admin
    .from("journal_entries")
    .select("id, entry_no, entry_date")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const journal = je ? { id: je.id, entryNo: Number(je.entry_no), entryDate: je.entry_date } : null;

  return { event, review, flags, docs, journal };
}
