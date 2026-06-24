// Spec 196 Tier 1 — loader for the /accounting GL ledger drill. The page is gated
// to ACCOUNTING_ROLES (requireRole); this reads the zero-grant journal tables via
// the ADMIN client server-side (the register pattern in load-registers.ts — money
// never reaches a non-cleared client). Returns every posted journal LINE that hit
// one account over a period, with its source document and counterparty resolved
// to readable labels, so an auditor can vouch a trial-balance number down to the
// individual postings behind it.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { sourceDocLabel, type LedgerLine } from "@/lib/accounting/ledger-view";

type Admin = SupabaseClient<Database>;

export interface LedgerAccount {
  code: string;
  nameTh: string;
  accountType: string;
  normalSide: string;
}

export interface LedgerRow extends LedgerLine {
  entryNo: number;
  entryDate: string;
  sourceTable: string;
  sourceLabel: string;
  sourceId: string | null;
  supplierLabel: string | null;
  memo: string | null;
}

export interface AccountLedger {
  account: LedgerAccount | null;
  rows: LedgerRow[];
}

async function supplierLabels(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from("suppliers").select("id, name").in("id", unique);
  for (const s of data ?? []) map.set(s.id, s.name);
  return map;
}

export async function loadAccountLedger(
  admin: Admin,
  code: string,
  from: string,
  to: string,
  projectId?: string,
): Promise<AccountLedger> {
  const { data: acct } = await admin
    .from("gl_accounts")
    .select("id, code, name_th, account_type, normal_side")
    .eq("code", code)
    .maybeSingle();
  if (!acct) return { account: null, rows: [] };

  const account: LedgerAccount = {
    code: acct.code,
    nameTh: acct.name_th,
    accountType: acct.account_type,
    normalSide: acct.normal_side,
  };

  // Posted entries in the window first (bounds the set), then this account's lines
  // within those entries. Reversal entries are also status='posted' — included so
  // the running total nets correctly (a corrected purchase shows both legs).
  const { data: entries, error: entryErr } = await admin
    .from("journal_entries")
    .select("id, entry_no, entry_date, source_table, source_id, memo")
    .eq("status", "posted")
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (entryErr) throw new Error(`journal_entries: ${entryErr.message}`);
  const entryById = new Map((entries ?? []).map((e) => [e.id, e]));
  if (entryById.size === 0) return { account, rows: [] };

  let q = admin
    .from("journal_lines")
    .select("entry_id, debit, credit, memo, supplier_id")
    .eq("account_id", acct.id)
    .in("entry_id", [...entryById.keys()]);
  if (projectId) q = q.eq("project_id", projectId);
  const { data: lines, error: lineErr } = await q;
  if (lineErr) throw new Error(`journal_lines: ${lineErr.message}`);

  const supplierIds = (lines ?? [])
    .map((l) => l.supplier_id)
    .filter((id): id is string => id !== null);
  const suppliers = await supplierLabels(admin, supplierIds);

  const rows: LedgerRow[] = (lines ?? [])
    .map((l) => {
      const entry = entryById.get(l.entry_id)!;
      return {
        entryNo: entry.entry_no,
        entryDate: entry.entry_date,
        sourceTable: entry.source_table,
        sourceLabel: sourceDocLabel(entry.source_table),
        sourceId: entry.source_id,
        supplierLabel: l.supplier_id ? (suppliers.get(l.supplier_id) ?? null) : null,
        memo: l.memo ?? entry.memo,
        debit: Number(l.debit),
        credit: Number(l.credit),
      };
    })
    .sort((a, b) => a.entryNo - b.entryNo);

  return { account, rows };
}
