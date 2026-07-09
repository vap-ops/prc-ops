// Spec 288 U1 — the server read backing the GL journal CSV export. journal_entries
// / journal_lines are RLS zero-grant (ERD audit M5, pgTAP-locked), so this reads
// them via the ADMIN client — the only sanctioned journal read path, same as
// load-ledger / load-manual-journals. The caller (the export route) MUST gate on
// requireRole(ACCOUNTING_ROLES) first; this file is registered FIRM-WIDE in
// money-read-policy.ts (the accountant audits the whole firm — no project filter).
//
// Only status='posted' entries in the window: reversing inserts a NEW posted
// entry with the opposite legs (reverse_journal_internal), the original stays
// posted, so a posted-only journal is balanced (both legs of a correction present)
// and excludes not-yet-posted drafts. Mirrors load-ledger's bound-then-fetch:
// entries in the date window first, then their lines, then the referenced
// accounts resolved to code/name via one id→account map (no per-line N+1).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { JournalExportEntry, JournalRange } from "./journal-export";

type Admin = SupabaseClient<Database>;

// PostgREST caps a single response at its "Max rows" setting (Supabase default
// 1000). This is a firm-wide, all-accounts dump (a wide window is 900+ lines
// today) — so a plain .select() would SILENTLY truncate and hand the accountant
// an incomplete, unbalanced journal. Page every read to exhaustion. PAGE ≤ the
// server cap so a short page reliably signals "done".
const PAGE = 1000;

type EntryRow = {
  id: string;
  entry_no: number;
  entry_date: string;
  source_table: string;
  source_id: string | null;
  memo: string | null;
};

async function fetchPostedEntries(admin: Admin, range: JournalRange): Promise<EntryRow[]> {
  const out: EntryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("journal_entries")
      .select("id, entry_no, entry_date, source_table, source_id, memo")
      .eq("status", "posted")
      .gte("entry_date", range.from)
      .lte("entry_date", range.to)
      .order("entry_no")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`journal_entries: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type LineRow = {
  entry_id: string;
  line_no: number;
  account_id: string;
  debit: number;
  credit: number;
};

async function fetchLines(admin: Admin, entryIds: string[]): Promise<LineRow[]> {
  const out: LineRow[] = [];
  // Batch the id list so a long .in(...) never trips a URL-length limit (414),
  // then page each batch to exhaustion. Ordered entry_id→line_no so a batch's
  // pages keep each entry's lines contiguous and in line_no order.
  const ID_BATCH = 300;
  for (let i = 0; i < entryIds.length; i += ID_BATCH) {
    const batch = entryIds.slice(i, i + ID_BATCH);
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("journal_lines")
        .select("entry_id, line_no, account_id, debit, credit")
        .in("entry_id", batch)
        .order("entry_id")
        .order("line_no")
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`journal_lines: ${error.message}`);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

export async function loadJournalExportRows(
  admin: Admin,
  range: JournalRange,
): Promise<JournalExportEntry[]> {
  const entries = await fetchPostedEntries(admin, range);
  if (entries.length === 0) return [];

  const entryIds = entries.map((e) => e.id);
  const lines = await fetchLines(admin, entryIds);

  const accountIds = [...new Set(lines.map((l) => l.account_id))];
  const { data: accounts, error: acctErr } = accountIds.length
    ? await admin.from("gl_accounts").select("id, code, name_th").in("id", accountIds)
    : { data: [], error: null };
  if (acctErr) throw new Error(`gl_accounts: ${acctErr.message}`);
  const accountById = new Map(
    (accounts ?? []).map((a) => [a.id, { code: a.code, nameTh: a.name_th }]),
  );

  // entry_id → its lines (already line_no-ordered by the query), resolving each
  // account to code/name. A line whose account somehow can't be resolved falls
  // back to "—" rather than dropping the posting (the ledger's convention).
  const linesByEntry = new Map<string, JournalExportEntry["lines"]>();
  for (const l of lines) {
    const acct = accountById.get(l.account_id);
    const view = {
      accountCode: acct?.code ?? "—",
      accountName: acct?.nameTh ?? "—",
      debit: Number(l.debit),
      credit: Number(l.credit),
    };
    const arr = linesByEntry.get(l.entry_id);
    if (arr) arr.push(view);
    else linesByEntry.set(l.entry_id, [view]);
  }

  return entries.map((e) => ({
    entryNo: e.entry_no,
    entryDate: e.entry_date,
    sourceTable: e.source_table,
    sourceId: e.source_id,
    memo: e.memo,
    lines: linesByEntry.get(e.id) ?? [],
  }));
}
