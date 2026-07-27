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
        {/* States the two refusals up front so the operator does not discover
            them only after assembling a file offline. */}
        <p className="text-ink-secondary mt-1 text-xs">
          เว้น &quot;รหัสอ้างอิง&quot; ว่างไว้ = เพิ่มรายการใหม่ · ใส่รหัสเดิม = แก้ไขรายการนั้น ·
          หมวดหมู่และเจ้าของต้องมีอยู่ในระบบแล้ว · ช่องราคายังนำเข้าไม่ได้
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
            พร้อมนำเข้า: เพิ่ม {preview.inserts} รายการ · แก้ไข {preview.updates} รายการ
          </p>
        )}

        {done && (
          <p className="text-ink mt-3 text-sm font-medium">
            {done.ok
              ? `นำเข้าสำเร็จ: เพิ่ม ${done.inserts} รายการ · แก้ไข ${done.updates} รายการ`
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
