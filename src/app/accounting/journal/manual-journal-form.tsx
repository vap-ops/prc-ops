"use client";

// Spec G8 — the manual general-journal entry form. 'use client' justified:
// controlled multi-line grid (add/remove rows), per-line one-sided enforcement,
// the LIVE double-entry balance preview (validateJournalLines — the same pure gate
// the post_journal_internal RPC re-asserts), submit pending, and inline error. The
// postManualJournal server action + the SECURITY DEFINER RPC beneath it are the
// load-bearing validators; this form is the convenience gate.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { baht } from "@/lib/i18n/labels";
import { validateJournalLines } from "@/lib/accounting/journal";
import type { PostableAccount } from "@/lib/accounting/load-manual-journals";
import { postManualJournal } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const AMOUNT =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-right text-sm tabular-nums text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";
const META = "text-ink-secondary text-xs";

interface Row {
  accountCode: string;
  debit: string;
  credit: string;
}

const emptyRow = (): Row => ({ accountCode: "", debit: "", credit: "" });

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function ManualJournalForm({
  accounts,
  today,
}: {
  accounts: PostableAccount[];
  today: string;
}) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(today);
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const lines = useMemo(
    () =>
      rows.map((r) => ({ accountCode: r.accountCode, debit: num(r.debit), credit: num(r.credit) })),
    [rows],
  );
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const check = validateJournalLines(lines);
  const canSubmit = entryDate !== "" && check.ok && !submitting;

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  // One-sided at input time: typing a debit clears the credit and vice versa, so
  // the most common double-entry mistake can't be made. (Uses the updater arg, not
  // the render closure, so rapid edits never read stale state.)
  function setDebit(i: number, v: string) {
    setRows((prev) =>
      prev.map((r, j) => (j === i ? { ...r, debit: v, credit: v ? "" : r.credit } : r)),
    );
  }
  function setCredit(i: number, v: string) {
    setRows((prev) =>
      prev.map((r, j) => (j === i ? { ...r, credit: v, debit: v ? "" : r.debit } : r)),
    );
  }
  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await postManualJournal({
        entryDate,
        memo: memo || null,
        lines,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEntryDate(today);
      setMemo("");
      setRows([emptyRow(), emptyRow()]);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="je-date" className={LABEL}>
            วันที่
          </label>
          <Input
            id="je-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            disabled={submitting}
            className="border-edge-strong bg-card text-ink h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="je-memo" className={LABEL}>
            คำอธิบาย (ไม่บังคับ)
          </label>
          <Input
            id="je-memo"
            value={memo}
            maxLength={500}
            onChange={(e) => setMemo(e.target.value)}
            disabled={submitting}
            className="border-edge-strong bg-card text-ink h-11"
          />
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={i} className="bg-sunk rounded-control flex flex-col gap-2 p-3">
            <select
              aria-label={`บัญชีบรรทัดที่ ${i + 1}`}
              value={r.accountCode}
              onChange={(e) => setRow(i, { accountCode: e.target.value })}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">— เลือกบัญชี —</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.nameTh}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className={META}>เดบิต</span>
                <input
                  aria-label={`เดบิตบรรทัดที่ ${i + 1}`}
                  inputMode="decimal"
                  value={r.debit}
                  onChange={(e) => setDebit(i, e.target.value)}
                  disabled={submitting}
                  className={AMOUNT}
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className={META}>เครดิต</span>
                <input
                  aria-label={`เครดิตบรรทัดที่ ${i + 1}`}
                  inputMode="decimal"
                  value={r.credit}
                  onChange={(e) => setCredit(i, e.target.value)}
                  disabled={submitting}
                  className={AMOUNT}
                  placeholder="0.00"
                />
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={submitting || rows.length <= 2}
                className="text-ink-secondary hover:text-attn-ink disabled:text-ink-muted h-11 px-2 text-sm disabled:opacity-40"
                aria-label={`ลบบรรทัดที่ ${i + 1}`}
              >
                ลบ
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addRow}
        disabled={submitting}
        className="text-action self-start text-sm font-medium"
      >
        + เพิ่มบรรทัด
      </button>

      <dl className="rounded-control bg-sunk flex flex-col gap-1 px-4 py-3 text-sm">
        <div className="text-ink-secondary flex justify-between">
          <dt>เดบิตรวม</dt>
          <dd className="tabular-nums">{baht(totalDebit)}</dd>
        </div>
        <div className="text-ink-secondary flex justify-between">
          <dt>เครดิตรวม</dt>
          <dd className="tabular-nums">{baht(totalCredit)}</dd>
        </div>
        <div className="border-edge mt-1 flex justify-between border-t pt-1 font-semibold">
          <dt className="text-ink">สถานะ</dt>
          <dd className={check.ok ? "text-done-strong" : "text-attn-ink"}>
            {check.ok ? "✓ สมดุล" : "ไม่สมดุล"}
          </dd>
        </div>
      </dl>

      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : "บันทึกรายการ"}
        </button>
      </div>
    </form>
  );
}
