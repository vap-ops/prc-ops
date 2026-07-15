"use client";

// Spec 323 U1c — the record-a-rental-deal form, extracted from RentalManager so it
// can be hosted in a bottom sheet (operator 2026-07-15: forms off the list, into
// sheets; one uniform record pattern mirroring /expenses). The deal fields are
// unchanged from spec 268/275/280/312 (owner · rate priced ต่อเดือน/ต่อวัน ·
// duration ตลอดโครงการ / กำหนดช่วงเอง · deposit · min-days · optional project ·
// note); on a clean save the form calls createRentalBatch, refreshes, then
// onDone() to close the sheet. The project-LOCKED variant (the /projects/[id]/rentals
// surface) fixes the binding: the โครงการ pick is hidden and every recorded rental
// auto-allocates to lockedProject. Writes still go through the SECURITY DEFINER RPCs
// via the server actions (the real gate + audit live in the DB).
//
// 'use client' justification: a multi-field form with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  BUTTON_PRIMARY_COMPACT,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
} from "@/lib/ui/classes";
import { createRentalBatch } from "@/app/equipment/rentals/actions";
import type { RentalRatePeriod } from "@/lib/equipment/rental-view";
import { splitSupplierOptions } from "@/lib/purchasing/vendor-suggestion";
import {
  EQUIPMENT_RATE_PERIOD_LABEL,
  EQUIPMENT_RENTAL_CUSTOM_PERIOD_LABEL,
  EQUIPMENT_RENTAL_DEPOSIT_LABEL,
  EQUIPMENT_RENTAL_LABEL,
  EQUIPMENT_RENTAL_MIN_DAYS_LABEL,
  EQUIPMENT_RENTAL_RECORD_LABEL,
  EQUIPMENT_RENTAL_WHOLE_PROJECT_LABEL,
} from "@/lib/i18n/labels";

// Spec 275 U5 follow-up — the partial-outcome recovery hint for the project-LOCKED
// recorder. createRentalBatch's default error tells the user to re-allocate from the
// per-card ผูกโครงการ control, but that control (and the unallocated batch's card) is
// hidden on the locked surface — recovery there lives on the settings cross-project
// overview (ตั้งค่า › เช่าอุปกรณ์) instead.
export const EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE = `บันทึกการเช่าแล้ว แต่ผูกโครงการไม่สำเร็จ — ไปที่ ตั้งค่า › ${EQUIPMENT_RENTAL_LABEL} เพื่อผูกโครงการอีกครั้ง`;

interface NamedRow {
  id: string;
  name: string;
}

export function RentalDealForm({
  suppliers,
  projects,
  defaultDate,
  lockedProject,
  suggestedSupplierIds = [],
  onDone,
}: {
  suppliers: NamedRow[];
  projects: NamedRow[];
  defaultDate: string;
  // Spec 280: ids of suppliers PRC has rented from before (ranked), surfaced in a
  // "เคยให้เช่า" group above the full list. Empty → plain flat list (show-all).
  suggestedSupplierIds?: string[];
  // Spec 275 U5: when set (the /projects/[id]/rentals surface), the recorder is
  // fixed to this project — the โครงการ pick is hidden and every recorded rental
  // auto-allocates here. Unset (the settings /equipment/rentals overview) keeps the
  // cross-project behaviour.
  lockedProject?: { id: string; name: string };
  // Spec 323 U1c: called after a clean save so the hosting sheet can close.
  onDone?: () => void;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [rate, setRate] = useState("");
  const [ratePeriod, setRatePeriod] = useState<RentalRatePeriod>("monthly");
  const [deposit, setDeposit] = useState("");
  const [minDays, setMinDays] = useState("");
  const [wholeProject, setWholeProject] = useState(true);
  const [startsOn, setStartsOn] = useState(defaultDate);
  const [endsOn, setEndsOn] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  // Spec 280: rented-from-before vendors rise to a "เคยให้เช่า" group; the full
  // supplier list stays below (show-all fallback). Suggestion only re-orders.
  const { suggested: suggestedSuppliers, rest: otherSuppliers } = splitSupplierOptions(
    suppliers,
    suggestedSupplierIds,
  );

  function handleRecord() {
    if (supplierId === "") {
      setError("กรุณาเลือกผู้ให้เช่า");
      return;
    }
    const rateNumber = Number(rate);
    if (rate.trim() === "" || !Number.isFinite(rateNumber) || rateNumber < 0) {
      setError("กรอกค่าเช่าเป็นตัวเลข (ไม่ติดลบ)");
      return;
    }
    const depositNumber = deposit.trim() === "" ? 0 : Number(deposit);
    if (!Number.isFinite(depositNumber) || depositNumber < 0) {
      setError("กรอกเงินมัดจำเป็นตัวเลข (ไม่ติดลบ)");
      return;
    }
    const minDaysNumber = minDays.trim() === "" ? null : Number(minDays);
    if (minDaysNumber !== null && (!Number.isInteger(minDaysNumber) || minDaysNumber <= 0)) {
      setError("กรอกจำนวนวันเช่าขั้นต่ำเป็นจำนวนเต็มบวก");
      return;
    }
    if (startsOn.trim() === "") {
      setError("กรุณาระบุวันเริ่มเช่า");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await createRentalBatch({
        supplierId,
        rate: rateNumber,
        ratePeriod,
        startsOn,
        endsOn: wholeProject || endsOn.trim() === "" ? null : endsOn,
        note,
        // Spec 275 U5: a locked project forces the binding (auto-allocate here);
        // otherwise the form's optional โครงการ pick decides.
        projectId: lockedProject ? lockedProject.id : projectId === "" ? null : projectId,
        depositAmount: depositNumber,
        minRentalDays: minDaysNumber,
      });
      if (!result.ok) {
        // Spec 275 U5 follow-up: on the locked surface the default "re-allocate from
        // the card" hint is unreachable (card + control hidden) — point at the
        // settings overview instead. Only for the partial-outcome result; every
        // other error shows verbatim.
        setError(
          lockedProject && result.code === "allocation_failed"
            ? EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE
            : result.error,
        );
        return;
      }
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div aria-label={EQUIPMENT_RENTAL_RECORD_LABEL}>
      <label className="text-ink-secondary block text-sm">
        เช่าจาก
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className={`${FIELD_SELECT} mt-1`}
        >
          <option value="">— เลือกผู้ให้เช่า —</option>
          {suggestedSuppliers.length > 0 ? (
            <>
              <optgroup label="เคยให้เช่า">
                {suggestedSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="ผู้ให้เช่าทั้งหมด">
                {otherSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            otherSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </select>
      </label>

      <label className="text-ink-secondary mt-2 block text-sm">
        ค่าเช่า (บาท)
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="หน่วยราคา">
        {(["monthly", "daily"] as const).map((p) => (
          <RadioChip
            key={p}
            name="rate-period"
            label={EQUIPMENT_RATE_PERIOD_LABEL[p]}
            checked={ratePeriod === p}
            onSelect={() => setRatePeriod(p)}
          />
        ))}
      </div>

      <label className="text-ink-secondary mt-2 block text-sm">
        {EQUIPMENT_RENTAL_DEPOSIT_LABEL}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <label className="text-ink-secondary mt-2 block text-sm">
        {EQUIPMENT_RENTAL_MIN_DAYS_LABEL}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step="1"
          value={minDays}
          onChange={(e) => setMinDays(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="ระยะเวลาเช่า">
        <RadioChip
          name="rental-duration"
          label={EQUIPMENT_RENTAL_WHOLE_PROJECT_LABEL}
          checked={wholeProject}
          onSelect={() => setWholeProject(true)}
        />
        <RadioChip
          name="rental-duration"
          label={EQUIPMENT_RENTAL_CUSTOM_PERIOD_LABEL}
          checked={!wholeProject}
          onSelect={() => setWholeProject(false)}
        />
      </div>

      <label className="text-ink-secondary mt-2 block text-sm">
        วันเริ่ม
        <input
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>
      {!wholeProject && (
        <label className="text-ink-secondary mt-2 block text-sm">
          วันสิ้นสุด
          <input
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
      )}

      {/* Spec 275 U5: on the project surface the binding is fixed — hide the pick;
          handleRecord forces projectId = lockedProject.id. */}
      {!lockedProject && (
        <label className="text-ink-secondary mt-2 block text-sm">
          โครงการ
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={`${FIELD_SELECT} mt-1`}
          >
            <option value="">— ยังไม่ผูกโครงการ —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="text-ink-secondary mt-2 block text-sm">
        หมายเหตุ
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={FIELD_STACKED}
        />
      </label>

      {error && (
        <span role="alert" className={`${INLINE_ERROR} mt-2 block`}>
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={handleRecord}
        disabled={saving}
        className={`${BUTTON_PRIMARY_COMPACT} mt-3`}
      >
        {saving ? "กำลังบันทึก…" : EQUIPMENT_RENTAL_RECORD_LABEL}
      </button>
    </div>
  );
}
