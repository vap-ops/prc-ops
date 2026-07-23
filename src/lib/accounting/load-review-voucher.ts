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
  journal: { id: string; entryNo: number; entryDate: string; count: number } | null;
}

// The three sources that carry documents today (spec 345 §1.1); U6 adds wage +
// client-receipt attachments and extends this map.
const DOC_SOURCES: Partial<
  Record<
    MoneySourceTable,
    { bucket: string; table: string; fk: string; label: string; hasSupersede: boolean }
  >
> = {
  purchase_requests: {
    bucket: "pr-attachments",
    table: "purchase_request_attachments",
    fk: "purchase_request_id",
    label: "เอกสารใบขอซื้อ",
    hasSupersede: true,
  },
  office_expenses: {
    bucket: "expense-attachments",
    table: "office_expense_attachments",
    fk: "office_expense_id",
    label: "ใบเสร็จ",
    hasSupersede: false,
  },
  rental_settlements: {
    bucket: "rental-settlement-receipts",
    table: "rental_settlement_attachments",
    fk: "settlement_id",
    label: "เอกสารปิดยอด",
    hasSupersede: false,
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
    // PR attachments use the supersede pattern (ADR 0009): a NEWER row's
    // superseded_by points at the row it replaced — exclude replaced originals
    // (the queue RPC anti-joins the same way; without this, a removed doc
    // resurfaces here with a fresh signed URL — fresh-eyes catch, live-proven).
    // Only purchase_request_attachments carries the column (selecting it on the
    // other two would 400), and the select strings must stay static literals
    // for the client's template-literal typing.
    let rows: Array<{ id: string; storage_path: string | null; superseded_by?: string | null }>;
    if (docSource.hasSupersede) {
      const { data: docRows } = await admin
        .from("purchase_request_attachments")
        .select("id, storage_path, superseded_by")
        .eq("purchase_request_id", sourceId);
      rows = docRows ?? [];
    } else {
      const { data: docRows } = await admin
        .from(docSource.table as "office_expense_attachments")
        .select("id, storage_path")
        .eq(docSource.fk as "office_expense_id", sourceId);
      rows = docRows ?? [];
    }
    const supersededIds = new Set(rows.map((d) => d.superseded_by).filter(Boolean));
    const paths = rows.filter(
      (d): d is { id: string; storage_path: string } =>
        d.storage_path !== null && !supersededIds.has(d.id),
    );
    const urls = await mintSignedUrls(docSource.bucket, paths);
    docs = paths
      .map((d, i) => ({
        label: `${docSource.label} ${i + 1}`,
        url: urls.get(d.storage_path) ?? "",
      }))
      .filter((d) => d.url !== "");
  }

  // A corrected event carries multiple entries (reversal + repost) — order by
  // the monotonic entry_no (entry_date ties are nondeterministic) and surface
  // the count so the contra never masquerades as "the" entry.
  const { data: jes } = await admin
    .from("journal_entries")
    .select("id, entry_no, entry_date")
    .eq("source_table", sourceTable)
    .eq("source_id", sourceId)
    .order("entry_no", { ascending: false })
    .limit(20);
  const latest = jes?.[0];
  const journal = latest
    ? {
        id: latest.id,
        entryNo: Number(latest.entry_no),
        entryDate: latest.entry_date,
        count: jes?.length ?? 1,
      }
    : null;

  return { event, review, flags, docs, journal };
}
