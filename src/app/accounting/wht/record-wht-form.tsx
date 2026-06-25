"use client";

// Spec 206 — record a WHT certificate (ใบ ภ.ง.ด.3/53/1). 'use client' justified:
// controlled inputs, sheet open state, submit pending, inline error, the income-type
// → rate auto-fill (resolveWhtRate), and the LIVE wht_amount preview
// (validateWhtCertificate — the same pure math the record RPC mirrors). The
// recordWhtCertificate server action + the SECURITY DEFINER RPC beneath it are the
// load-bearing validators; this form is the convenience gate.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { baht } from "@/lib/i18n/labels";
import {
  validateWhtCertificate,
  resolveWhtRate,
  type WhtDirection,
  type WhtForm,
} from "@/lib/accounting/wht-certificate";
import type { WhtFormData } from "@/lib/accounting/load-registers";
import { recordWhtCertificate } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const RATE =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink text-right tabular-nums shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

const DIRECTIONS: { value: WhtDirection; label: string }[] = [
  { value: "deducted", label: "เราหัก (ค้างนำส่งสรรพากร)" },
  { value: "suffered", label: "ถูกหัก (เครดิตภาษีของเรา)" },
];
const FORMS: { value: WhtForm; label: string }[] = [
  { value: "pnd53", label: "ภ.ง.ด.53 (นิติบุคคล)" },
  { value: "pnd3", label: "ภ.ง.ด.3 (บุคคลธรรมดา)" },
  { value: "pnd1", label: "ภ.ง.ด.1 (เงินเดือน/ค่าจ้าง)" },
];

export function RecordWhtForm({ data }: { data: WhtFormData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<WhtDirection>("deducted");
  const [taxForm, setTaxForm] = useState<WhtForm>("pnd53");
  const [incomeType, setIncomeType] = useState("");
  const [whtRate, setWhtRate] = useState("");
  const [taxId, setTaxId] = useState("");
  const [base, setBase] = useState("");
  const [payeeType, setPayeeType] = useState<"supplier" | "contractor">("supplier");
  const [supplierId, setSupplierId] = useState("");
  const [contractorId, setContractorId] = useState("");
  const [clientId, setClientId] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const rateOptions = data.incomeTypes.map((t) => ({
    incomeType: t.value,
    defaultRate: t.defaultRate,
  }));

  function handleIncomeType(v: string) {
    setIncomeType(v);
    const r = resolveWhtRate(v, null, rateOptions);
    if (r !== null) setWhtRate(String(r));
  }

  const preview = validateWhtCertificate({
    direction,
    taxForm,
    taxId,
    baseAmount: Number(base),
    whtRate: Number(whtRate),
  });
  const partyOk =
    direction === "deducted"
      ? payeeType === "supplier"
        ? supplierId !== ""
        : contractorId !== ""
      : true;
  const canSubmit = preview.ok && incomeType !== "" && partyOk && !submitting;

  function reset() {
    setDirection("deducted");
    setTaxForm("pnd53");
    setIncomeType("");
    setWhtRate("");
    setTaxId("");
    setBase("");
    setPayeeType("supplier");
    setSupplierId("");
    setContractorId("");
    setClientId("");
    setIssuedDate("");
    setNote("");
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await recordWhtCertificate({
        direction,
        taxForm,
        incomeType,
        taxId,
        baseAmount: Number(base),
        whtRate: Number(whtRate),
        supplierId: direction === "deducted" && payeeType === "supplier" ? supplierId : null,
        contractorId: direction === "deducted" && payeeType === "contractor" ? contractorId : null,
        clientId: direction === "suffered" ? clientId || null : null,
        issuedDate: issuedDate || null,
        note: note || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${BUTTON_PRIMARY} mb-4 self-start`}
      >
        + บันทึกใบหักภาษี
      </button>

      <BottomSheet open={open} title="บันทึกใบหักภาษี ณ ที่จ่าย" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wht-direction" className={LABEL}>
              ทิศทาง
            </label>
            <select
              id="wht-direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as WhtDirection)}
              disabled={submitting}
              className={FIELD}
            >
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wht-form" className={LABEL}>
              แบบยื่น
            </label>
            <select
              id="wht-form"
              value={taxForm}
              onChange={(e) => setTaxForm(e.target.value as WhtForm)}
              disabled={submitting}
              className={FIELD}
            >
              {FORMS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wht-income" className={LABEL}>
                ประเภทเงินได้
              </label>
              <select
                id="wht-income"
                value={incomeType}
                onChange={(e) => handleIncomeType(e.target.value)}
                disabled={submitting}
                className={FIELD}
              >
                <option value="">— เลือกประเภท —</option>
                {data.incomeTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} ({t.defaultRate}%)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex w-20 flex-col gap-1.5">
              <label htmlFor="wht-rate" className={LABEL}>
                อัตรา %
              </label>
              <input
                id="wht-rate"
                inputMode="decimal"
                value={whtRate}
                onChange={(e) => setWhtRate(e.target.value)}
                disabled={submitting}
                className={RATE}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wht-taxid" className={LABEL}>
              เลขประจำตัวผู้เสียภาษี (13 หลัก)
            </label>
            <Input
              id="wht-taxid"
              inputMode="numeric"
              value={taxId}
              maxLength={13}
              onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 tabular-nums"
              placeholder="0105556000123"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="wht-base" className={LABEL}>
              ฐานภาษี (บาท)
            </label>
            <Input
              id="wht-base"
              inputMode="decimal"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 text-right tabular-nums"
              placeholder="0.00"
            />
          </div>

          {direction === "deducted" ? (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>ผู้รับเงิน (ที่เราหักภาษี)</span>
              <div className="flex gap-2">
                <select
                  aria-label="ประเภทผู้รับเงิน"
                  value={payeeType}
                  onChange={(e) => setPayeeType(e.target.value as "supplier" | "contractor")}
                  disabled={submitting}
                  className={`${FIELD} w-32 shrink-0`}
                >
                  <option value="supplier">ผู้ขาย</option>
                  <option value="contractor">ผู้รับเหมา</option>
                </select>
                {payeeType === "supplier" ? (
                  <select
                    aria-label="ผู้ขาย"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    disabled={submitting}
                    className={FIELD}
                  >
                    <option value="">— เลือกผู้ขาย —</option>
                    {data.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    aria-label="ผู้รับเหมา"
                    value={contractorId}
                    onChange={(e) => setContractorId(e.target.value)}
                    disabled={submitting}
                    className={FIELD}
                  >
                    <option value="">— เลือกผู้รับเหมา —</option>
                    {data.contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wht-client" className={LABEL}>
                ลูกค้า (ผู้หักภาษีเรา) — ไม่บังคับ
              </label>
              <select
                id="wht-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={submitting}
                className={FIELD}
              >
                <option value="">— ไม่ระบุ —</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wht-date" className={LABEL}>
                วันที่ออก (ไม่บังคับ)
              </label>
              <Input
                id="wht-date"
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wht-note" className={LABEL}>
                หมายเหตุ (ไม่บังคับ)
              </label>
              <Input
                id="wht-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>

          {preview.ok ? (
            <dl className="rounded-control bg-sunk text-ink-secondary flex justify-between px-4 py-3 text-sm">
              <dt className="font-medium">ภาษีหัก ณ ที่จ่าย</dt>
              <dd className="text-ink font-semibold tabular-nums">
                {baht(preview.value.whtAmount)}
              </dd>
            </dl>
          ) : null}

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังบันทึก…" : "บันทึกใบหักภาษี"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
