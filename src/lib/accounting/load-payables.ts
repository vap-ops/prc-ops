// Spec 196 Tier 2 — loader for the AP subledger (เจ้าหนี้การค้า). Reads the
// account-2100 (AP - trade) journal lines via the admin client behind
// requireRole(ACCOUNTING_ROLES) and rolls them up per supplier into the
// outstanding balance owed. Current balance (all posted entries; reversals net
// out) — the live "who do we owe" register that sits behind the 2100 control
// total on the trial balance.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { aggregatePayables } from "@/lib/accounting/payables-view";

type Admin = SupabaseClient<Database>;

// AP - trade control account (post_purchase_to_gl credits 2100, gross).
export const AP_ACCOUNT_CODE = "2100";

export interface PayablesRow {
  supplierId: string | null;
  supplierLabel: string;
  balance: number;
}

export interface PayablesRegister {
  rows: PayablesRow[];
  total: number;
}

export async function loadPayables(admin: Admin): Promise<PayablesRegister> {
  const { data: acct } = await admin
    .from("gl_accounts")
    .select("id")
    .eq("code", AP_ACCOUNT_CODE)
    .maybeSingle();
  if (!acct) return { rows: [], total: 0 };

  const { data: lines, error } = await admin
    .from("journal_lines")
    .select("supplier_id, debit, credit")
    .eq("account_id", acct.id);
  if (error) throw new Error(`journal_lines: ${error.message}`);

  const agg = aggregatePayables(
    (lines ?? []).map((l) => ({
      supplierId: l.supplier_id,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  );

  const supplierIds = agg.rows.map((r) => r.supplierId).filter((id): id is string => id !== null);
  const names = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data } = await admin.from("suppliers").select("id, name").in("id", supplierIds);
    for (const s of data ?? []) names.set(s.id, s.name);
  }

  const rows: PayablesRow[] = agg.rows.map((r) => ({
    supplierId: r.supplierId,
    supplierLabel: r.supplierId ? (names.get(r.supplierId) ?? "ผู้ขายที่ถูกลบ") : "ไม่ระบุผู้ขาย",
    balance: r.balance,
  }));

  return { rows, total: agg.total };
}
