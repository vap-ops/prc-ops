"use client";

// Spec 367 §13 — เพิ่มหลายเครื่อง, the bulk add door on /equipment.
//
// The add sheet creates ONE machine per trip and the registry is filled by hand;
// at the last physical count that is ~68 trips. This takes a pasted table
// (`ทะเบียน · จำนวน · เจ้าของ · ที่ตั้ง`) and creates the rows in one press.
//
// Two steps, and the second is unreachable until the first comes back clean —
// same contract as the §6 importer, but load-bearing for a different reason here:
// `จำนวน` means "how many machines" for a unit SKU and "the row's quantity" for a
// bulk one, so the PREVIEW is the only place the operator learns which reading
// their file got. Editing the paste re-locks the commit, so reviewed-file ≠
// committed-file cannot happen.
//
// A textarea rather than a file picker: the operator works from a cloud PC and
// pastes straight out of Google Sheets (TAB-delimited, no file round trip).
//
// 'use client': the paste text, the preview/commit state machine, and the
// result/error lists.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_COMPACT, FIELD_INPUT } from "@/lib/ui/classes";
import { bulkAddEquipmentFromCatalog, type BulkAddEquipmentResult } from "@/app/equipment/actions";

const TRIGGER_LABEL = "เพิ่มหลายเครื่อง";

export function BulkAddEquipmentSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BulkAddEquipmentResult | null>(null);
  const [done, setDone] = useState<BulkAddEquipmentResult | null>(null);

  const reset = (): void => {
    setText("");
    setPreview(null);
    setDone(null);
  };

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(true);
    try {
      const result = await bulkAddEquipmentFromCatalog(text, { dryRun });
      if (dryRun) setPreview(result);
      else {
        setDone(result);
        setPreview(null);
        // Even a partial commit changed the registry, so refresh either way.
        if (result.created > 0) router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const errors = preview?.errors.length ? preview.errors : (done?.errors ?? []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-action inline-flex min-h-11 items-center text-sm font-medium"
      >
        {TRIGGER_LABEL}
      </button>

      <BottomSheet
        open={open}
        title={TRIGGER_LABEL}
        onClose={() => {
          setOpen(false);
          reset();
        }}
      >
        <p className="text-ink-secondary text-sm">
          วางตารางจากชีต (รวมหัวตาราง) — คอลัมน์ ทะเบียน · จำนวน · เจ้าของ · ที่ตั้ง
        </p>
        {/* State the refusals up front: the sheet is assembled offline, and
            discovering them only after pasting wastes the whole pass. */}
        <p className="text-ink-secondary mt-1 text-xs">
          ชื่อในคอลัมน์ ทะเบียน ต้องมีอยู่ในทะเบียนเครื่องมือแล้ว · เว้น เจ้าของ ว่างไว้ = PRI ·
          เว้น ที่ตั้ง ว่างไว้ = อยู่ที่คลัง · รหัสครุภัณฑ์ หมายเลขเครื่อง และรูป
          เพิ่มทีหลังที่แถวรายการ
        </p>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Re-lock: a preview belongs to the text it was run on.
            setPreview(null);
            setDone(null);
          }}
          rows={8}
          spellCheck={false}
          aria-label="ตารางที่วาง"
          className={`${FIELD_INPUT} mt-3 w-full font-mono text-xs`}
        />

        {preview?.preview?.length ? (
          <>
            <p className="text-ink mt-3 text-sm font-medium">
              พร้อมเพิ่ม {preview.created} เครื่อง
            </p>
            <ul className="text-ink-secondary mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
              {preview.preview.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        ) : null}

        {done ? (
          <div className="mt-3">
            <p className="text-ink text-sm font-medium">
              {done.ok ? `เพิ่มสำเร็จ ${done.created} เครื่อง` : `เพิ่มได้ ${done.created} เครื่อง`}
            </p>
            {/* Saved-with-a-gap: name every owed follow-up rather than closing on
                a silence the operator would only find months later. */}
            {done.rateWarnings > 0 ? (
              <p className="text-ink-secondary mt-1 text-xs">
                คัดลอกค่าเช่าไม่สำเร็จ {done.rateWarnings} เครื่อง — ตั้งค่าเช่าที่แถวรายการ
              </p>
            ) : null}
            {done.locationWarnings > 0 ? (
              <p className="text-ink-secondary mt-1 text-xs">
                บันทึกที่อยู่ไม่สำเร็จ {done.locationWarnings} เครื่อง — ระบุที่ปุ่มย้ายบนแถวรายการ
              </p>
            ) : null}
          </div>
        ) : null}

        {errors.length > 0 ? (
          <ul className="text-danger mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
            {errors.map((e) => (
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
            disabled={busy || !preview || !preview.ok || preview.errors.length > 0}
            onClick={() => void run(false)}
            className={`${BUTTON_PRIMARY} flex-1`}
          >
            เพิ่มทั้งหมด
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
