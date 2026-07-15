"use client";

// Spec 268 / 323 U1c — the /equipment/rentals + /projects/[id]/rentals read-only
// deals list (BACK_OFFICE money audience only; the page gate keeps a site_admin
// session out entirely, so rate figures may render here). Recording a new deal moved
// into AddRentalFab + a bottom sheet (operator 2026-07-15: forms off the list); this
// component now only lists recorded deals. Each card's per-deal actions — ผูกโครงการ
// (allocate an existing deal to a project) and ยกเลิกการเช่า (void, spec 312) — open
// in a bottom sheet instead of an inline disclosure, so the list stays read-only.
// Writes go through the SECURITY DEFINER RPCs via the server actions.
//
// 'use client' justification: per-card sheet-hosted forms with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  BUTTON_DANGER_OUTLINE_COMPACT,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import { createRentalAllocation, voidRentalBatch } from "@/app/equipment/rentals/actions";
import type { RentalCard } from "@/lib/equipment/rental-view";
import { EQUIPMENT_RENTAL_ALLOCATE_LABEL } from "@/lib/i18n/labels";

// Spec 312 — the confirm button for voiding a rental (destructive: reverses GL +
// cancels the batch). Field-First danger tokens, not raw palette.
const BUTTON_DANGER_COMPACT =
  "inline-flex min-h-11 items-center justify-center rounded-control border border-danger-edge bg-danger-soft px-4 py-2 text-body font-medium text-danger-ink transition-colors hover:opacity-90 disabled:opacity-50";

const VOID_LABEL = "ยกเลิกการเช่า";

interface NamedRow {
  id: string;
  name: string;
}

export function RentalManager({
  projects,
  rentals,
  defaultDate,
  lockedProject,
}: {
  projects: NamedRow[];
  rentals: RentalCard[];
  defaultDate: string;
  // Spec 275 U5: on the /projects/[id]/rentals surface the deal is fixed to this
  // project, so the per-card re-allocate control is hidden. Unset (the settings
  // /equipment/rentals overview) keeps the cross-project behaviour.
  lockedProject?: { id: string; name: string };
}) {
  const router = useRouter();
  return (
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
              // Spec 275 U5: the locked project surface fixes the binding — no
              // cross-project re-allocation from a card here.
              allowAllocate={!lockedProject}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}
    </section>
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
  // Spec 323 U1c — allocate + void each open in their own bottom sheet.
  const [allocateOpen, setAllocateOpen] = useState(false);
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
      setAllocateOpen(false);
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

      <div className="mt-3 flex flex-wrap gap-2">
        {allowAllocate && (
          <button
            type="button"
            onClick={() => setAllocateOpen(true)}
            className={BUTTON_SECONDARY_COMPACT}
          >
            {EQUIPMENT_RENTAL_ALLOCATE_LABEL}
          </button>
        )}
        {/* Spec 312 — void (cancel) an active, erroneous / test rental. Reverses the
            GL + hides the card. Only shown when the batch is voidable (active). */}
        {card.voidable && (
          <button
            type="button"
            onClick={() => setVoidOpen(true)}
            className={BUTTON_DANGER_OUTLINE_COMPACT}
          >
            {VOID_LABEL}
          </button>
        )}
      </div>

      {allowAllocate && (
        <BottomSheet
          open={allocateOpen}
          title={EQUIPMENT_RENTAL_ALLOCATE_LABEL}
          onClose={() => setAllocateOpen(false)}
        >
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
          <div className="mt-3 flex flex-wrap gap-2">
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
              onClick={() => setAllocateOpen(false)}
              className={BUTTON_SECONDARY_COMPACT}
            >
              ยกเลิก
            </button>
          </div>
        </BottomSheet>
      )}

      {card.voidable && (
        <BottomSheet open={voidOpen} title={VOID_LABEL} onClose={() => setVoidOpen(false)}>
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
          <div className="mt-3 flex flex-wrap gap-2">
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
        </BottomSheet>
      )}
    </li>
  );
}
