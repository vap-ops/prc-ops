"use client";

// Spec 253 U1 — drill revenue write affordances (PM tier only; the page hides
// this whole strip for accounting). 'use client' justified: sheet open state,
// controlled inputs, submit pending, inline errors. The server actions + the
// SECURITY DEFINER RPCs beneath are the load-bearing validators.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_SECONDARY_COMPACT, INLINE_ERROR, BUTTON_PRIMARY } from "@/lib/ui/classes";
import { RECEIPT_METHOD_LABEL } from "@/lib/i18n/labels";
import {
  createQuotation,
  createClientPo,
  upsertContract,
  addInstallment,
  recordAdvanceReceipt,
} from "./actions";
import type { AccountingActionResult } from "@/lib/accounting/billing-actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";
const NUM = "border-edge-strong bg-card text-ink h-11 text-right tabular-nums";

interface SheetFormProps {
  title: string;
  buttonLabel: string;
  children: (helpers: {
    submitting: boolean;
    error: string | null;
    submit: (fn: () => Promise<AccountingActionResult>, reset: () => void) => void;
  }) => React.ReactNode;
}

// One tiny shell all five sheets share: open state + pending + error + refresh.
function SheetForm({ title, buttonLabel, children }: SheetFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function submit(fn: () => Promise<AccountingActionResult>, reset: () => void) {
    setError(null);
    startSubmit(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY_COMPACT}>
        {buttonLabel}
      </button>
      <BottomSheet open={open} title={title} onClose={() => setOpen(false)}>
        {children({ submitting, error, submit })}
      </BottomSheet>
    </>
  );
}

export function QuotationSheet({ projectId }: { projectId: string }) {
  const [no, setNo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  return (
    <SheetForm title="เพิ่มใบเสนอราคา" buttonLabel="+ ใบเสนอราคา">
      {({ submitting, error, submit }) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                createQuotation({
                  projectId,
                  quotationNo: no,
                  amount: Number(amount),
                  quoteDate: date,
                }),
              () => {
                setNo("");
                setAmount("");
                setDate("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="qt-no" className={LABEL}>
              เลขที่ใบเสนอราคา
            </label>
            <Input id="qt-no" value={no} onChange={(e) => setNo(e.target.value)} className={NUM} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qt-amount" className={LABEL}>
                มูลค่า (บาท)
              </label>
              <Input
                id="qt-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qt-date" className={LABEL}>
                วันที่เสนอ
              </label>
              <Input
                id="qt-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>
          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !no.trim() || !(Number(amount) > 0) || !date}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "บันทึกใบเสนอราคา"}
            </button>
          </div>
        </form>
      )}
    </SheetForm>
  );
}

export function ClientPoSheet({
  projectId,
  quotations,
}: {
  projectId: string;
  quotations: { id: string; label: string }[];
}) {
  const [no, setNo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [quotationId, setQuotationId] = useState("");
  return (
    <SheetForm title="บันทึก PO จากลูกค้า" buttonLabel="+ PO ลูกค้า">
      {({ submitting, error, submit }) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                createClientPo({
                  projectId,
                  poNo: no,
                  amount: Number(amount),
                  poDate: date,
                  quotationId: quotationId || null,
                }),
              () => {
                setNo("");
                setAmount("");
                setDate("");
                setQuotationId("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="po-no" className={LABEL}>
              เลขที่ PO
            </label>
            <Input id="po-no" value={no} onChange={(e) => setNo(e.target.value)} className={NUM} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="po-amount" className={LABEL}>
                มูลค่า (บาท)
              </label>
              <Input
                id="po-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="po-date" className={LABEL}>
                วันที่ PO
              </label>
              <Input
                id="po-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>
          {quotations.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="po-qt" className={LABEL}>
                อ้างอิงใบเสนอราคา (ไม่บังคับ)
              </label>
              <select
                id="po-qt"
                value={quotationId}
                onChange={(e) => setQuotationId(e.target.value)}
                className={FIELD}
              >
                <option value="">— ไม่ระบุ —</option>
                {quotations.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !no.trim() || !(Number(amount) > 0) || !date}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "บันทึก PO"}
            </button>
          </div>
        </form>
      )}
    </SheetForm>
  );
}

export function ContractSheet({
  projectId,
  existing,
}: {
  projectId: string;
  existing: { contractValue: number; retentionRate: number; contractNo: string | null } | null;
}) {
  const [value, setValue] = useState(existing ? String(existing.contractValue) : "");
  const [retention, setRetention] = useState(existing ? String(existing.retentionRate) : "5");
  const [no, setNo] = useState(existing?.contractNo ?? "");
  const [signDate, setSignDate] = useState("");
  return (
    <SheetForm
      title={existing ? "แก้ไขสัญญา" : "บันทึกสัญญา"}
      buttonLabel={existing ? "แก้ไขสัญญา" : "+ สัญญา"}
    >
      {({ submitting, error, submit }) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                upsertContract({
                  projectId,
                  contractValue: Number(value),
                  retentionRate: Number(retention),
                  contractNo: no || null,
                  signDate: signDate || null,
                }),
              () => setSignDate(""),
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-value" className={LABEL}>
                มูลค่าสัญญา (บาท)
              </label>
              <Input
                id="ct-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-ret" className={LABEL}>
                ประกันผลงาน %
              </label>
              <Input
                id="ct-ret"
                inputMode="decimal"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className={NUM}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-no" className={LABEL}>
                เลขที่สัญญา (ไม่บังคับ)
              </label>
              <Input
                id="ct-no"
                value={no}
                onChange={(e) => setNo(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-sign" className={LABEL}>
                วันที่เซ็น (ไม่บังคับ)
              </label>
              <Input
                id="ct-sign"
                type="date"
                value={signDate}
                onChange={(e) => setSignDate(e.target.value)}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>
          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !(Number(value) > 0)}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "บันทึกสัญญา"}
            </button>
          </div>
        </form>
      )}
    </SheetForm>
  );
}

export function InstallmentSheet({
  projectId,
  contractId,
  nextSeq,
}: {
  projectId: string;
  contractId: string;
  nextSeq: number;
}) {
  const [seq, setSeq] = useState(String(nextSeq));
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [planned, setPlanned] = useState("");
  return (
    <SheetForm title="เพิ่มงวดเบิก" buttonLabel="+ งวดเบิก">
      {({ submitting, error, submit }) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                addInstallment({
                  projectId,
                  contractId,
                  seq: Number(seq),
                  label,
                  amount: Number(amount),
                  plannedDate: planned || null,
                }),
              () => {
                setSeq(String(nextSeq + 1));
                setLabel("");
                setAmount("");
                setPlanned("");
              },
            );
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="in-seq" className={LABEL}>
                งวดที่
              </label>
              <Input
                id="in-seq"
                inputMode="numeric"
                value={seq}
                onChange={(e) => setSeq(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor="in-amount" className={LABEL}>
                จำนวนเงิน (บาท)
              </label>
              <Input
                id="in-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={NUM}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="in-label" className={LABEL}>
              รายละเอียดงวด
            </label>
            <Input
              id="in-label"
              value={label}
              maxLength={200}
              onChange={(e) => setLabel(e.target.value)}
              className="border-edge-strong bg-card text-ink h-11"
              placeholder="เช่น งวดที่ 1 — เซ็นสัญญา"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="in-planned" className={LABEL}>
              กำหนดเบิก (ไม่บังคับ)
            </label>
            <Input
              id="in-planned"
              type="date"
              value={planned}
              onChange={(e) => setPlanned(e.target.value)}
              className="border-edge-strong bg-card text-ink h-11"
            />
          </div>
          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !(Number(seq) > 0) || !label.trim() || !(Number(amount) > 0)}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "เพิ่มงวด"}
            </button>
          </div>
        </form>
      )}
    </SheetForm>
  );
}

export function AdvanceReceiptSheet({ projectId }: { projectId: string }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  return (
    <SheetForm title="บันทึกเงินรับล่วงหน้า" buttonLabel="+ เงินรับล่วงหน้า">
      {({ submitting, error, submit }) => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                recordAdvanceReceipt({
                  projectId,
                  amount: Number(amount),
                  receivedDate: date,
                  method,
                }),
              () => {
                setAmount("");
                setDate("");
                setMethod("bank_transfer");
              },
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="adv-amount" className={LABEL}>
                จำนวนเงิน (บาท)
              </label>
              <Input
                id="adv-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={NUM}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="adv-date" className={LABEL}>
                วันที่รับ
              </label>
              <Input
                id="adv-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="adv-method" className={LABEL}>
              วิธีรับเงิน
            </label>
            <select
              id="adv-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={FIELD}
            >
              {Object.entries(RECEIPT_METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !(Number(amount) > 0) || !date}
              className={BUTTON_PRIMARY}
            >
              {submitting ? "กำลังบันทึก…" : "บันทึกเงินรับ"}
            </button>
          </div>
        </form>
      )}
    </SheetForm>
  );
}
