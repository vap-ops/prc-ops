// Spec 149 U9b — read-only register loaders for /accounting. Read the zero-grant
// money tables via the ADMIN client (the payroll pattern: requireRole gates the
// page, then admin reads server-side; money never reaches a non-cleared client).
// Names/labels are resolved with batch lookups (the fetchDisplayNames idiom).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type Admin = SupabaseClient<Database>;

async function projectLabels(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from("projects").select("id, code, name").in("id", unique);
  for (const p of data ?? []) map.set(p.id, p.name ?? p.code);
  return map;
}

export interface RetentionRegisterRow {
  id: string;
  projectLabel: string;
  amountWithheld: number;
  status: string;
  dueDate: string | null;
  releasedAt: string | null;
}

export async function loadRetentionRegister(admin: Admin): Promise<RetentionRegisterRow[]> {
  const { data, error } = await admin
    .from("retention_receivables")
    .select("id, project_id, amount_withheld, status, due_date, released_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`retention_receivables: ${error.message}`);
  const rows = data ?? [];
  const labels = await projectLabels(
    admin,
    rows.map((r) => r.project_id),
  );
  return rows.map((r) => ({
    id: r.id,
    projectLabel: labels.get(r.project_id) ?? "—",
    amountWithheld: Number(r.amount_withheld),
    status: r.status,
    dueDate: r.due_date,
    releasedAt: r.released_at,
  }));
}

export interface BillingRegisterRow {
  id: string;
  billingNo: number;
  projectLabel: string;
  grossAmount: number;
  retentionAmount: number | null;
  netReceivable: number | null;
  status: string;
  certifiedAt: string | null;
}

export async function loadBillingRegister(admin: Admin): Promise<BillingRegisterRow[]> {
  const { data, error } = await admin
    .from("client_billings")
    .select(
      "id, billing_no, project_id, gross_amount, retention_amount, net_receivable, status, certified_at",
    )
    .order("billing_no", { ascending: false });
  if (error) throw new Error(`client_billings: ${error.message}`);
  const rows = data ?? [];
  const labels = await projectLabels(
    admin,
    rows.map((r) => r.project_id),
  );
  return rows.map((r) => ({
    id: r.id,
    billingNo: r.billing_no,
    projectLabel: labels.get(r.project_id) ?? "—",
    grossAmount: Number(r.gross_amount),
    retentionAmount: r.retention_amount === null ? null : Number(r.retention_amount),
    netReceivable: r.net_receivable === null ? null : Number(r.net_receivable),
    status: r.status,
    certifiedAt: r.certified_at,
  }));
}

export interface WhtRegisterRow {
  id: string;
  certNo: number;
  direction: string;
  taxForm: string;
  partyLabel: string;
  incomeType: string;
  baseAmount: number;
  whtRate: number;
  whtAmount: number;
  issuedDate: string;
}

export async function loadWhtRegister(admin: Admin): Promise<WhtRegisterRow[]> {
  const { data, error } = await admin
    .from("wht_certificates")
    .select(
      "id, cert_no, direction, tax_form, supplier_id, contractor_id, client_id, income_type, base_amount, wht_rate, wht_amount, issued_date",
    )
    .order("cert_no", { ascending: false });
  if (error) throw new Error(`wht_certificates: ${error.message}`);
  const rows = data ?? [];

  // Resolve party names across the three party tables in one batch each.
  const supplierIds = rows.map((r) => r.supplier_id).filter((v): v is string => v !== null);
  const contractorIds = rows.map((r) => r.contractor_id).filter((v): v is string => v !== null);
  const clientIds = rows.map((r) => r.client_id).filter((v): v is string => v !== null);
  const [suppliers, contractors, clients] = await Promise.all([
    nameMap(admin, "suppliers", supplierIds),
    nameMap(admin, "contractors", contractorIds),
    nameMap(admin, "clients", clientIds),
  ]);

  return rows.map((r) => ({
    id: r.id,
    certNo: r.cert_no,
    direction: r.direction,
    taxForm: r.tax_form,
    partyLabel:
      (r.supplier_id && suppliers.get(r.supplier_id)) ||
      (r.contractor_id && contractors.get(r.contractor_id)) ||
      (r.client_id && clients.get(r.client_id)) ||
      "—",
    incomeType: r.income_type,
    baseAmount: Number(r.base_amount),
    whtRate: Number(r.wht_rate),
    whtAmount: Number(r.wht_amount),
    issuedDate: r.issued_date,
  }));
}

async function nameMap(
  admin: Admin,
  table: "suppliers" | "contractors" | "clients",
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from(table).select("id, name").in("id", unique);
  for (const row of data ?? []) map.set(row.id, row.name);
  return map;
}
