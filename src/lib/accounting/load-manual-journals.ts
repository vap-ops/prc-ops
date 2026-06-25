// Spec G8 — load the manual general-journal surface: the postable account list
// for the entry form's picker, and the recent manual entries (source_table =
// 'manual') with their lines + whether each is already reversed (so the UI can
// gate the กลับรายการ control via canReverseJournalEntry).
//
// Read via the admin (service-role) client only — journal_entries / journal_lines /
// gl_accounts are zero-grant under RLS; the page gate (PM_ROLES) is the guard.
// Fetches are parallelised (specs 147/148): the account list is independent of the
// entries, and once the entry ids are known the lines + reversal lookups run
// together. The single postable-accounts map resolves BOTH the picker labels and
// each line's account code — no per-line account query (N+1 avoided).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type Admin = SupabaseClient<Database>;

export interface PostableAccount {
  code: string;
  nameTh: string;
}

export interface ManualJournalLineView {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface ManualJournalEntryView {
  id: string;
  entryNo: number;
  entryDate: string;
  memo: string | null;
  status: string;
  postedAt: string | null;
  lines: ManualJournalLineView[];
  alreadyReversed: boolean;
}

export interface ManualJournalData {
  accounts: PostableAccount[];
  entries: ManualJournalEntryView[];
}

export async function loadManualJournalData(admin: Admin, limit = 30): Promise<ManualJournalData> {
  const [accountsRes, entriesRes] = await Promise.all([
    admin
      .from("gl_accounts")
      .select("id, code, name_th")
      .eq("is_postable", true)
      .eq("active", true)
      .order("sort_order")
      .order("code"),
    admin
      .from("journal_entries")
      .select("id, entry_no, entry_date, memo, status, posted_at")
      .eq("source_table", "manual")
      .order("entry_no", { ascending: false })
      .limit(limit),
  ]);

  const accountRows = accountsRes.data ?? [];
  // id → {code, name} resolves each line's account_id; code/name feeds the picker.
  const byId = new Map(accountRows.map((a) => [a.id, { code: a.code, nameTh: a.name_th }]));
  const accounts: PostableAccount[] = accountRows.map((a) => ({ code: a.code, nameTh: a.name_th }));

  const entryRows = entriesRes.data ?? [];
  const ids = entryRows.map((e) => e.id);

  if (ids.length === 0) return { accounts, entries: [] };

  const [linesRes, reversalsRes] = await Promise.all([
    admin
      .from("journal_lines")
      .select("entry_id, line_no, debit, credit, account_id")
      .in("entry_id", ids)
      .order("line_no"),
    admin.from("journal_entries").select("reversal_of").in("reversal_of", ids),
  ]);

  const linesByEntry = new Map<string, ManualJournalLineView[]>();
  for (const l of linesRes.data ?? []) {
    const acc = byId.get(l.account_id);
    const view: ManualJournalLineView = {
      accountCode: acc?.code ?? "—",
      accountName: acc?.nameTh ?? "—",
      debit: Number(l.debit),
      credit: Number(l.credit),
    };
    const arr = linesByEntry.get(l.entry_id);
    if (arr) arr.push(view);
    else linesByEntry.set(l.entry_id, [view]);
  }

  const reversedIds = new Set(
    (reversalsRes.data ?? []).map((r) => r.reversal_of).filter((id): id is string => id !== null),
  );

  const entries: ManualJournalEntryView[] = entryRows.map((e) => ({
    id: e.id,
    entryNo: e.entry_no,
    entryDate: e.entry_date,
    memo: e.memo,
    status: e.status,
    postedAt: e.posted_at,
    lines: linesByEntry.get(e.id) ?? [],
    alreadyReversed: reversedIds.has(e.id),
  }));

  return { accounts, entries };
}
