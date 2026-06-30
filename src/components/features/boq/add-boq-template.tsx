"use client";

// Spec 237 (ADR 0066 / S10-U2) — "add BOQ template" on the /catalog/boq-templates
// manage screen. Thin sheet: the back-office enters a unique code, a name, and an
// optional description; create_boq_template carries the role gate + code
// uniqueness. boq_template has no INSERT grant.
//
// 'use client' justification: owns the sheet open state, the field inputs, a
// useTransition pending state, and an inline error — transient client-only state.
// Mirrors AddSubcategory.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { createBoqTemplate } from "@/app/catalog/boq-templates/actions";
import { BOQ_TEMPLATES_LABEL } from "@/lib/i18n/labels";

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function AddBoqTemplate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function reset() {
    setCode("");
    setName("");
    setDescription("");
    setError(null);
  }

  function close() {
    reset();
    setOpen(false);
  }

  const canSubmit = code.trim() !== "" && name.trim() !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createBoqTemplate({
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        เพิ่ม{BOQ_TEMPLATES_LABEL}
      </button>

      <BottomSheet open={open} title={`เพิ่ม${BOQ_TEMPLATES_LABEL}`} onClose={close}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bt-code" className={LABEL}>
              รหัสแม่แบบ
            </label>
            <input
              id="bt-code"
              type="text"
              value={code}
              maxLength={40}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น BOQ-HOUSE-A"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bt-name" className={LABEL}>
              ชื่อแม่แบบ
            </label>
            <input
              id="bt-name"
              type="text"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น บ้านมาตรฐาน 2 ชั้น"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="bt-desc" className={LABEL}>
              รายละเอียด (ถ้ามี)
            </label>
            <input
              id="bt-desc"
              type="text"
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={close} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
