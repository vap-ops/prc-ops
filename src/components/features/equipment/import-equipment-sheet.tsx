"use client";

// Spec 367 U3b — the bulk-import door on /equipment.
//
// Two steps on purpose: ตรวจสอบ (dry run) reports what WOULD happen and writes
// nothing, then นำเข้า commits. At 64 rows an import that only tells you what it
// did after the fact is not reviewable, and the operator is pasting data they
// assembled offline over hours.
//
// A textarea rather than a file picker: the operator works from a cloud PC and
// the fastest path is selecting cells in Google Sheets and pasting — which
// arrives TAB-delimited and needs no file round trip. A pasted CSV works too;
// the parser sniffs the delimiter.
//
// 'use client': paste state, the two-step preview/commit state machine, and the
// error list.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_COMPACT, FIELD_INPUT } from "@/lib/ui/classes";
import { importEquipmentCsv, type ImportEquipmentResult } from "@/app/equipment/actions";
import { EQUIPMENT_IMPORT_LABEL } from "@/lib/i18n/labels";

export function ImportEquipmentSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportEquipmentResult | null>(null);
  const [done, setDone] = useState<ImportEquipmentResult | null>(null);

  const reset = (): void => {
    setText("");
    setPreview(null);
    setDone(null);
  };

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(true);
    try {
      const result = await importEquipmentCsv(text, { dryRun });
      if (dryRun) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
        if (result.ok) router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-action inline-flex min-h-11 items-center text-sm font-medium"
      >
        {EQUIPMENT_IMPORT_LABEL}
      </button>

      <BottomSheet
        open={open}
        title={EQUIPMENT_IMPORT_LABEL}
        onClose={() => {
          setOpen(false);
          reset();
        }}
      >
        <p className="text-ink-secondary text-sm">
          ดาวน์โหลด CSV ก่อน แล้วกรอกข้อมูลที่ว่างไว้ จากนั้นวางทั้งตาราง (รวมหัวตาราง)
          ลงในช่องด้านล่าง
        </p>
        {/* Spec 385 U4 — the INSERT arm is retired: this file EDITS existing
            rows only. States the refusals up front so the operator does not
            discover them only after assembling a file offline. */}
        {/* Spec 367 §10.4 — "ช่องราคายังนำเข้าไม่ได้" was TRUE until the DEFINER
            seams landed and is now false; leaving it would send the operator
            back to editing 60 prices by hand. The blank-cell asymmetry is
            stated here because it is the only place it can be read BEFORE the
            file is assembled: the two RPCs genuinely differ (acquisition accepts
            null and clears, the rate RPC refuses null). */}
        <p className="text-ink-secondary mt-1 text-xs">
          ไฟล์นี้ใช้แก้ไขรายการเดิมเท่านั้น (ทุกแถวต้องมีรหัสอ้างอิง) ·
          เพิ่มเครื่องใหม่ผ่านทะเบียนบนหน้าอุปกรณ์ · หมวดหมู่และเจ้าของต้องมีอยู่ในระบบแล้ว ·
          เว้นช่องราคาทุน/วันที่ได้มาว่างไว้ = ล้างค่าเดิม · เว้นช่องค่าเช่าว่างไว้ = คงค่าเดิม
        </p>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setDone(null);
          }}
          rows={8}
          spellCheck={false}
          aria-label="ข้อมูล CSV"
          className={`${FIELD_INPUT} mt-3 w-full font-mono text-xs`}
        />

        {preview && preview.errors.length === 0 && (
          <p className="text-ink mt-3 text-sm font-medium">
            พร้อมนำเข้า: แก้ไข {preview.updates} รายการ
          </p>
        )}

        {done && (
          <p className="text-ink mt-3 text-sm font-medium">
            {done.ok
              ? // The money count is reported SEPARATELY: it takes a different
                // path (two DEFINER RPCs) and it is the number the operator
                // pricing a fleet actually came for.
                `นำเข้าสำเร็จ: แก้ไข ${done.updates} รายการ${
                  done.moneyUpdates > 0 ? ` · อัปเดตราคา ${done.moneyUpdates} รายการ` : ""
                }`
              : `นำเข้าไม่สำเร็จ`}
          </p>
        )}

        {/* Every bad row, not just the first — the operator is fixing a file
            offline and wants one complete list. */}
        {preview?.errors.length || done?.errors.length ? (
          <ul className="text-danger mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
            {(preview?.errors ?? done?.errors ?? []).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || text.trim() === ""}
            onClick={() => void run(true)}
            className={BUTTON_SECONDARY_COMPACT}
          >
            ตรวจสอบ
          </button>
          <button
            type="button"
            // Commit is unreachable until a dry run came back clean: no writing
            // a file nobody has reviewed.
            disabled={busy || !preview || preview.errors.length > 0}
            onClick={() => void run(false)}
            className={`${BUTTON_PRIMARY} flex-1`}
          >
            นำเข้า
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
