// Spec 196 Tier 3 (U6) — loader for the purchase voucher: one PR with its source
// documents AND the GL entry it posted, so an auditor closes the loop document →
// ledger. Reads via the admin client behind requireRole(ACCOUNTING_ROLES). Quote
// (price) evidence is filtered out — procurement-only per the spec-196 decision.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { isAuditableAttachmentPurpose } from "@/lib/accounting/purchases-view";

type Admin = SupabaseClient<Database>;

export interface VoucherHeader {
  id: string;
  supplierLabel: string;
  projectLabel: string;
  wpLabel: string | null;
  gross: number;
  vatRate: number;
  status: string;
  purchasedAt: string | null;
  requestedAt: string | null;
  requesterName: string | null;
  approverName: string | null;
  poNumber: number | null;
  // Spec 211 U9b: the PO's id, for the voucher's live link into the PO detail.
  poId: string | null;
}

export interface VoucherAttachment {
  id: string;
  kind: string;
  purpose: string;
  href: string | null; // signed URL (image) or external link
}

export interface VoucherGlLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface PurchaseVoucher {
  header: VoucherHeader | null;
  attachments: VoucherAttachment[];
  glLines: VoucherGlLine[];
}

export async function loadPurchaseVoucher(admin: Admin, id: string): Promise<PurchaseVoucher> {
  const { data: pr } = await admin
    .from("purchase_requests")
    .select(
      "id, supplier_id, supplier, amount, vat_rate, status, purchased_at, requested_at, requested_by, approved_by, work_package_id, project_id, purchase_order_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!pr) return { header: null, attachments: [], glLines: [] };

  const [
    { data: supplierRow },
    { data: projectRow },
    { data: wpRow },
    { data: poRow },
    names,
    { data: attachmentRows },
    glLines,
  ] = await Promise.all([
    pr.supplier_id
      ? admin.from("suppliers").select("name").eq("id", pr.supplier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pr.project_id
      ? admin.from("projects").select("code, name").eq("id", pr.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pr.work_package_id
      ? admin.from("work_packages").select("code, name").eq("id", pr.work_package_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pr.purchase_order_id
      ? admin
          .from("purchase_orders")
          .select("po_number")
          .eq("id", pr.purchase_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetchDisplayNames(
      [pr.requested_by, pr.approved_by].filter((v): v is string => v !== null),
      "[accounting/voucher]",
    ),
    admin
      .from("purchase_request_attachments_current")
      .select("id, kind, purpose, storage_path, url")
      .eq("purchase_request_id", id)
      .order("created_at", { ascending: true }),
    loadVoucherGlLines(admin, id),
  ]);

  // Auditable source docs only (quote/price evidence stays procurement-only).
  // The current-state view types are nullable — drop any null id/purpose.
  const auditable = (attachmentRows ?? []).filter(
    (a): a is typeof a & { id: string; purpose: string } =>
      a.id !== null && a.purpose !== null && isAuditableAttachmentPurpose(a.purpose),
  );
  const signed = await mintSignedUrlsForAttachments(
    auditable.map((a) => ({ id: a.id, storage_path: a.storage_path })),
  );
  const attachments: VoucherAttachment[] = auditable.map((a) => ({
    id: a.id,
    kind: a.kind ?? "image",
    purpose: a.purpose,
    href: a.kind === "link" ? a.url : (signed.get(a.id) ?? null),
  }));

  const header: VoucherHeader = {
    id: pr.id,
    supplierLabel: supplierRow?.name ?? pr.supplier ?? "ไม่ระบุผู้ขาย",
    projectLabel: projectRow?.name ?? projectRow?.code ?? "—",
    wpLabel: wpRow ? `${wpRow.code} ${wpRow.name}` : null,
    gross: Number(pr.amount ?? 0),
    vatRate: Number(pr.vat_rate ?? 0),
    status: pr.status,
    purchasedAt: pr.purchased_at,
    requestedAt: pr.requested_at,
    requesterName: pr.requested_by ? (names.get(pr.requested_by) ?? null) : null,
    approverName: pr.approved_by ? (names.get(pr.approved_by) ?? null) : null,
    poNumber: poRow?.po_number ?? null,
    poId: pr.purchase_order_id,
  };

  return { header, attachments, glLines };
}

// The journal lines this PR posted (source_table='purchase_requests', this id),
// each with its GL account — the doc → ledger tie.
async function loadVoucherGlLines(admin: Admin, id: string): Promise<VoucherGlLine[]> {
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id")
    .eq("source_table", "purchase_requests")
    .eq("source_id", id)
    .eq("status", "posted");
  const entryIds = (entries ?? []).map((e) => e.id);
  if (entryIds.length === 0) return [];

  const { data: lines } = await admin
    .from("journal_lines")
    .select("account_id, debit, credit, line_no")
    .in("entry_id", entryIds)
    .order("line_no", { ascending: true });
  const rows = lines ?? [];

  const accountIds = [...new Set(rows.map((l) => l.account_id))];
  const accounts = new Map<string, { code: string; name: string }>();
  if (accountIds.length > 0) {
    const { data: acctRows } = await admin
      .from("gl_accounts")
      .select("id, code, name_th")
      .in("id", accountIds);
    for (const a of acctRows ?? []) accounts.set(a.id, { code: a.code, name: a.name_th });
  }

  return rows.map((l) => {
    const acct = accounts.get(l.account_id);
    return {
      accountCode: acct?.code ?? "—",
      accountName: acct?.name ?? "—",
      debit: Number(l.debit),
      credit: Number(l.credit),
    };
  });
}
