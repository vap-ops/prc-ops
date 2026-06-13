"use client";

// Spec 71 — work-package notes (backup capture). 'use client' justified:
// a controlled textarea + dirty/save/error state around the
// setWorkPackageNotes action. Rendered in the ข้อมูลงาน zone of the WP
// detail page (sa/pm/super reach it; the RPC re-gates server-side). The
// note is the catch-all for anything the structured fields don't cover.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BUTTON_PRIMARY_COMPACT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { WORK_PACKAGE_NOTES_MAX } from "@/lib/work-packages/validate-notes";
import { setWorkPackageNotes } from "@/app/sa/projects/[projectId]/work-packages/[workPackageId]/notes-actions";

interface WorkPackageNotesProps {
  projectId: string;
  workPackageId: string;
  notes: string | null;
}

export function WorkPackageNotes({ projectId, workPackageId, notes }: WorkPackageNotesProps) {
  const router = useRouter();
  const [value, setValue] = useState<string>(notes ?? "");
  const [savedValue, setSavedValue] = useState<string>(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = value !== savedValue;

  function save() {
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      const result = await setWorkPackageNotes({ projectId, workPackageId, notes: value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedValue(value);
      setJustSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="wp-notes" className="text-sm font-medium text-zinc-900">
        หมายเหตุ
      </label>
      <textarea
        id="wp-notes"
        value={value}
        maxLength={WORK_PACKAGE_NOTES_MAX}
        rows={3}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
          setJustSaved(false);
        }}
        disabled={pending}
        className="w-full min-w-0 rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        placeholder="ข้อมูลเพิ่มเติมเกี่ยวกับงานนี้ที่ไม่มีช่องให้กรอกโดยตรง"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={BUTTON_PRIMARY_COMPACT}
        >
          {pending ? "กำลังบันทึก…" : "บันทึกหมายเหตุ"}
        </button>
        {justSaved && !dirty ? (
          <span className="text-xs font-medium text-emerald-700">บันทึกแล้ว</span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
