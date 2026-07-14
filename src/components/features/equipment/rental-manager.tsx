"use client";

// Spec 268 — the /equipment/rentals recorder (BACK_OFFICE money audience only;
// the page gate keeps a site_admin session out entirely, so rate figures may
// render here). One form records the inbound deal the procurement team asked
// for: owner · rate priced ต่อเดือน/ต่อวัน · duration ตลอดโครงการ (open-ended)
// or กำหนดช่วงเอง (custom dates) · an optional project binding that allocates
// in the same submit. Cards list recorded deals; ผูกโครงการ allocates an
// existing deal to a project. Writes go through the two SECURITY DEFINER RPCs
// via the server actions (the real gate + audit live in the DB).
//
// 'use client' justification: a multi-field form + per-card disclosure with
// busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import {
  createRentalAllocation,
  createRentalBatch,
  voidRentalBatch,
} from "@/app/equipment/rentals/actions";
import type { RentalCard, RentalRatePeriod } from "@/lib/equipment/rental-view";
import { splitSupplierOptions } from "@/lib/purchasing/vendor-suggestion";
import {
  EQUIPMENT_RATE_PERIOD_LABEL,
  EQUIPMENT_RENTAL_ALLOCATE_LABEL,
  EQUIPMENT_RENTAL_CUSTOM_PERIOD_LABEL,
  EQUIPMENT_RENTAL_DEPOSIT_LABEL,
  EQUIPMENT_RENTAL_LABEL,
  EQUIPMENT_RENTAL_MIN_DAYS_LABEL,
  EQUIPMENT_RENTAL_RECORD_LABEL,
  EQUIPMENT_RENTAL_WHOLE_PROJECT_LABEL,
} from "@/lib/i18n/labels";

// Spec 275 U5 follow-up — the partial-outcome recovery hint for the
// project-LOCKED recorder. createRentalBatch's default error tells the user to
// re-allocate from the per-card ผูกโครงการ control, but that control (and the
// unallocated batch's card) is hidden on the locked surface — recovery there
// lives on the settings cross-project overview (ตั้งค่า › เช่าอุปกรณ์) instead.
export const EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE = `บันทึกการเช่าแล้ว แต่ผูกโครงการไม่สำเร็จ — ไปที่ ตั้งค่า › ${EQUIPMENT_RENTAL_LABEL} เพื่อผูกโครงการอีกครั้ง`;

// Spec 312 — the confirm button for voiding a rental (destructive: reverses GL +
// cancels the batch). Field-First danger tokens, not raw palette.
const BUTTON_DANGER_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-danger-edge bg-danger-soft px-4 py-2 text-body font-medium text-danger-ink transition-colors hover:opacity-90 disabled:opacity-50";

interface NamedRow {
  id: string;
  name: string;
}

export function RentalManager({
  suppliers,
  projects,
  rentals,
  defaultDate,
  lockedProject,
  suggestedSupplierIds = [],
}: {
  suppliers: NamedRow[];
  projects: NamedRow[];
  rentals: RentalCard[];
  defaultDate: string;
  // Spec 280: ids of suppliers PRC has rented from before (ranked), surfaced in a
  // "เคยให้เช่า" group above the full list. Empty → plain flat list (show-all).
  suggestedSupplierIds?: string[];
  // Spec 275 U5: when set (the /projects/[id]/rentals surface), the recorder is
  // fixed to this project — the โครงการ pick is hidden and every recorded rental
  // auto-allocates here; the per-card re-allocate control is hidden. Unset (the
  // settings /equipment/rentals overview) keeps the cross-project behaviour.
  lockedProject?: { id: string; name: string };
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

  function resetForm() {
    setSupplierId("");
    setRate("");
    setRatePeriod("monthly");
    setDeposit("");
    setMinDays("");
    setWholeProject(true);
    setStartsOn(defaultDate);
    setEndsOn("");
    setProjectId("");
    setNote("");
  }

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
        // Spec 275 U5 follow-up: on the locked surface the default "re-allocate
        // from the card" hint is unreachable (card + control hidden) — point at
        // the settings overview instead. Only for the partial-outcome result;
        // every other error shows verbatim.
        setError(
          lockedProject && result.code === "allocation_failed"
            ? EQUIPMENT_RENTAL_PARTIAL_LOCKED_MESSAGE
            : result.error,
        );
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={EQUIPMENT_RENTAL_RECORD_LABEL}>
        <h2 className={SECTION_HEADING}>{EQUIPMENT_RENTAL_RECORD_LABEL}</h2>
        <div className={CARD}>
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

          {/* Spec 275 U5: on the project surface the binding is fixed — hide the
              pick; handleRecord forces projectId = lockedProject.id. */}
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
      </section>

      <section aria-label="รายการเช่า">
        <h2 className={SECTION_HEADING}>รายการเช่า</h2>
        {rentals.length === 0 ? (
          <p className="text-ink-muted text-sm">ยังไม่มีการเช่าที่บันทึกไว้</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rentals.map((card) => (
              <RentalCardRow
                key={card.id}
                card={card}
                projects={projects}
                defaultDate={defaultDate}
                // Spec 275 U5: the locked project surface fixes the binding —
                // no cross-project re-allocation from a card here.
                allowAllocate={!lockedProject}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RentalCardRow({
  card,
  projects,
  defaultDate,
  allowAllocate,
  onChanged,
}: {
  card: RentalCard;
  projects: NamedRow[];
  defaultDate: string;
  allowAllocate: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [startsOn, setStartsOn] = useState(defaultDate);
  const [endsOn, setEndsOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  // Spec 312 — the per-card void (cancel an erroneous / test rental).
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voiding, startVoid] = useTransition();

  function handleVoid() {
    const reason = voidReason.trim();
    if (reason === "") {
      setVoidError("กรุณาระบุเหตุผลการยกเลิก");
      return;
    }
    setVoidError(null);
    startVoid(async () => {
      const result = await voidRentalBatch({ batchId: card.id, reason });
      if (!result.ok) {
        setVoidError(result.error);
        return;
      }
      setVoidOpen(false);
      setVoidReason("");
      onChanged();
    });
  }

  function handleAllocate() {
    if (projectId === "") {
      setError("กรุณาเลือกโครงการ");
      return;
    }
    if (startsOn.trim() === "") {
      setError("กรุณาระบุวันเริ่ม");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await createRentalAllocation({
        batchId: card.id,
        projectId,
        startsOn,
        endsOn: endsOn.trim() === "" ? null : endsOn,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setProjectId("");
      setStartsOn(defaultDate);
      setEndsOn("");
      onChanged();
    });
  }

  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-ink font-semibold break-words">{card.supplierName}</span>
        <span className="text-ink shrink-0 font-semibold">{card.rateLabel}</span>
      </div>
      <p className="text-ink-secondary mt-1 text-sm">{card.periodLabel}</p>
      {card.note && <p className="text-ink-muted mt-1 text-sm break-words">{card.note}</p>}

      {card.allocations.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {card.allocations.map((a) => (
            <li key={a.id} className="text-ink-secondary text-sm">
              {`${a.projectName} · ${a.periodLabel}`}
            </li>
          ))}
        </ul>
      )}

      {allowAllocate &&
        (open ? (
          <div className="border-edge mt-3 border-t pt-3">
            <label className="text-ink-secondary block text-sm">
              โครงการที่ผูก
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={`${FIELD_SELECT} mt-1`}
              >
                <option value="">— เลือกโครงการ —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-ink-secondary mt-2 block text-sm">
              วันเริ่มผูก
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className={FIELD_STACKED}
              />
            </label>
            <label className="text-ink-secondary mt-2 block text-sm">
              วันสิ้นสุดผูก (เว้นว่าง = ตลอดโครงการ)
              <input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                className={FIELD_STACKED}
              />
            </label>
            {error && (
              <span role="alert" className={`${INLINE_ERROR} mt-2 block`}>
                {error}
              </span>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAllocate}
                disabled={saving}
                className={BUTTON_PRIMARY_COMPACT}
              >
                {saving ? "กำลังบันทึก…" : "ยืนยันผูกโครงการ"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={BUTTON_SECONDARY_COMPACT}
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${BUTTON_SECONDARY_COMPACT} mt-3`}
          >
            {EQUIPMENT_RENTAL_ALLOCATE_LABEL}
          </button>
        ))}

      {/* Spec 312 — void (cancel) an active, erroneous / test rental. Reverses the
          GL + hides the card. Only shown when the batch is voidable (active). */}
      {card.voidable &&
        (voidOpen ? (
          <div className="border-edge mt-3 border-t pt-3">
            <p className="text-ink-secondary text-sm">
              ยกเลิกรายการเช่านี้? ระบบจะกลับรายการบัญชีที่เกี่ยวข้องให้อัตโนมัติ
            </p>
            <label className="text-ink-secondary mt-2 block text-sm">
              เหตุผลการยกเลิก
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={2}
                className={FIELD_STACKED}
              />
            </label>
            {voidError && (
              <span role="alert" className={`${INLINE_ERROR} mt-2 block`}>
                {voidError}
              </span>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleVoid}
                disabled={voiding || voidReason.trim() === ""}
                className={BUTTON_DANGER_COMPACT}
              >
                {voiding ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoidOpen(false);
                  setVoidError(null);
                }}
                className={BUTTON_SECONDARY_COMPACT}
              >
                ไม่ใช่
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setVoidOpen(true)}
            className="text-danger mt-3 block text-sm font-medium hover:underline"
          >
            ยกเลิกการเช่า
          </button>
        ))}
    </li>
  );
}
