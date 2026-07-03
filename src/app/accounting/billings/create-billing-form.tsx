"use client";

// Spec 204 — create a งวด (progress claim). 'use client' justified: controlled
// inputs, sheet open state, submit pending, inline error, and the LIVE breakdown
// preview (computeBillingBreakdown — the same pure math the certify RPC mirrors).
// The createClientBilling server action + the SECURITY DEFINER RPC beneath it are
// the load-bearing validators; this form is the convenience gate.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { computeBillingBreakdown } from "@/lib/accounting/client-billing";
import { baht } from "@/lib/format";
import { createClientBilling } from "./actions";

const FIELD =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const RATE =
  "h-11 w-full min-w-0 rounded-control border border-edge-strong bg-card px-2 text-sm text-ink text-right tabular-nums shadow-input focus:outline-none focus-visible:ring-2 focus-visible:ring-action";
const LABEL = "text-sm font-medium text-ink";

export interface ProjectOption {
  id: string;
  label: string;
}

// Spec 250 U2 — the chosen project's contract งวด rows (optional claim target).
export interface InstallmentOption {
  id: string;
  label: string;
  amount: number;
}

export function CreateBillingForm({
  projects,
  installmentsByProject = {},
}: {
  projects: ProjectOption[];
  installmentsByProject?: Record<string, InstallmentOption[]>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [installmentId, setInstallmentId] = useState("");
  const [gross, setGross] = useState("");
  const [retentionRate, setRetentionRate] = useState("5");
  const [vatRate, setVatRate] = useState("7");
  const [whtRate, setWhtRate] = useState("3");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const grossNum = Number(gross);
  const installmentOptions = projectId ? (installmentsByProject[projectId] ?? []) : [];
  const breakdown = computeBillingBreakdown({
    grossAmount: grossNum,
    retentionRate: Number(retentionRate),
    vatRate: Number(vatRate),
    whtRate: Number(whtRate),
  });
  const canSubmit = projectId !== "" && breakdown.ok && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createClientBilling({
        projectId,
        grossAmount: grossNum,
        retentionRate: Number(retentionRate),
        vatRate: Number(vatRate),
        whtRate: Number(whtRate),
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        note: note || null,
        installmentId: installmentId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      // Reset to a clean draft — including the rates (else custom rates leak into
      // the next claim the user opens).
      setProjectId("");
      setInstallmentId("");
      setGross("");
      setRetentionRate("5");
      setVatRate("7");
      setWhtRate("3");
      setNote("");
      setPeriodFrom("");
      setPeriodTo("");
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
        + สร้างงวด
      </button>

      <BottomSheet open={open} title="สร้างงวดวางบิล" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="billing-project" className={LABEL}>
              โครงการ
            </label>
            <select
              id="billing-project"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                // A งวด belongs to ONE project's contract — never carry a pick across.
                setInstallmentId("");
              }}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">— เลือกโครงการ —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {installmentOptions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-installment" className={LABEL}>
                งวดตามสัญญา (ไม่บังคับ)
              </label>
              <select
                id="billing-installment"
                value={installmentId}
                onChange={(e) => setInstallmentId(e.target.value)}
                disabled={submitting}
                className={FIELD}
              >
                <option value="">— ไม่ระบุ —</option>
                {installmentOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label} · {baht(i.amount)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="billing-gross" className={LABEL}>
              มูลค่างานในงวด (บาท)
            </label>
            <Input
              id="billing-gross"
              inputMode="decimal"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11 text-right tabular-nums"
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-ret" className={LABEL}>
                ประกัน %
              </label>
              <input
                id="billing-ret"
                inputMode="decimal"
                value={retentionRate}
                onChange={(e) => setRetentionRate(e.target.value)}
                disabled={submitting}
                className={RATE}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-vat" className={LABEL}>
                VAT %
              </label>
              <input
                id="billing-vat"
                inputMode="decimal"
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
                disabled={submitting}
                className={RATE}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-wht" className={LABEL}>
                หัก ณ ที่จ่าย %
              </label>
              <input
                id="billing-wht"
                inputMode="decimal"
                value={whtRate}
                onChange={(e) => setWhtRate(e.target.value)}
                disabled={submitting}
                className={RATE}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-from" className={LABEL}>
                ตั้งแต่ (ไม่บังคับ)
              </label>
              <Input
                id="billing-from"
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="billing-to" className={LABEL}>
                ถึง (ไม่บังคับ)
              </label>
              <Input
                id="billing-to"
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                disabled={submitting}
                className="border-edge-strong bg-card text-ink h-11"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="billing-note" className={LABEL}>
              หมายเหตุ (ไม่บังคับ)
            </label>
            <Input
              id="billing-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              className="border-edge-strong bg-card text-ink h-11"
            />
          </div>

          {breakdown.ok ? (
            <dl className="rounded-control bg-sunk text-ink-secondary flex flex-col gap-1 px-4 py-3 text-xs">
              <div className="flex justify-between">
                <dt>หักเงินประกันผลงาน</dt>
                <dd className="tabular-nums">{baht(breakdown.value.retentionAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>ภาษีมูลค่าเพิ่ม</dt>
                <dd className="tabular-nums">{baht(breakdown.value.vatAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>หัก ณ ที่จ่าย</dt>
                <dd className="tabular-nums">{baht(breakdown.value.whtSuffered)}</dd>
              </div>
              <div className="text-ink border-edge mt-1 flex justify-between border-t pt-1 font-semibold">
                <dt>รับสุทธิ</dt>
                <dd className="tabular-nums">{baht(breakdown.value.netReceivable)}</dd>
              </div>
            </dl>
          ) : null}

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end">
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังสร้าง…" : "สร้างงวด (ร่าง)"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
