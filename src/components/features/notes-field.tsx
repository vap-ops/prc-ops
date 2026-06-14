"use client";

// Spec 72 — the shared notes textarea (generalization of WorkPackageNotes).
// Presentational: it owns the controlled textarea + dirty/save/error/saved
// state + router.refresh, and takes the write as an injected onSave callback.
// Each entity keeps a thin 'use client' wrapper that imports its own
// "use server" action and binds onSave — so no server function crosses the
// RSC boundary, and the 42501→Thai mapping stays in each action.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BUTTON_PRIMARY_COMPACT, INLINE_ALERT_TEXT } from "@/lib/ui/classes";
import { NOTES_MAX } from "@/lib/notes/validate";
import { useToast } from "@/lib/ui/use-toast";

export type NotesSaveResult = { ok: true } | { ok: false; error: string };

interface NotesFieldProps {
  notes: string | null;
  onSave: (value: string) => Promise<NotesSaveResult>;
  /** Stable id for the label/textarea pair — several notes fields can share a page. */
  fieldId: string;
  label?: string;
  placeholder?: string;
  maxLength?: number;
}

export function NotesField({
  notes,
  onSave,
  fieldId,
  label = "หมายเหตุ",
  placeholder = "ข้อมูลเพิ่มเติมที่ไม่มีช่องให้กรอกโดยตรง",
  maxLength = NOTES_MAX,
}: NotesFieldProps) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<string>(notes ?? "");
  const [savedValue, setSavedValue] = useState<string>(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = value !== savedValue;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await onSave(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedValue(value);
      // Spec 76: success → transient toast (survives the refresh).
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-ink text-sm font-medium">
        {label}
      </label>
      <textarea
        id={fieldId}
        value={value}
        maxLength={maxLength}
        rows={3}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        disabled={pending}
        className="rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
        placeholder={placeholder}
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
      </div>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
