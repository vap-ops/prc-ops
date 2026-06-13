"use client";

import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";

// 'use client' justification (feature spec 05, ADR 0017):
//
// This panel owns input state, inline validation, pending state, and a
// "Saved" confirmation that must appear only AFTER an actual successful
// save in this session. A Server Component cannot hold those — the
// post-save toast is a transient client-only signal, not derived from
// server-rendered props.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { validateDisplayName } from "@/lib/profile/validate-display-name";
import { updateDisplayName } from "@/app/coming-soon/actions";
import { useToast } from "@/lib/ui/use-toast";

interface DisplayNameFormProps {
  initialName: string;
}

export function DisplayNameForm({ initialName }: DisplayNameFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const trimmed = value.trim();
  const unchanged = trimmed === initialName.trim();
  const localValidation = validateDisplayName(value);
  const canSubmit = !submitting && !unchanged && localValidation.ok;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await updateDisplayName(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Spec 76: success is a transient toast (survives the refresh below);
      // the field-bound validation error stays inline. router.refresh()
      // re-runs the Server Component above so the greeting picks up the name.
      setValue(result.value);
      toast.success("บันทึกแล้ว");
      router.refresh();
    });
  }

  const inlineError =
    error ?? (!localValidation.ok && value.length > 0 ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <label htmlFor="display-name" className="text-sm font-medium text-zinc-900">
        ชื่อที่แสดง
      </label>
      <input
        id="display-name"
        type="text"
        maxLength={80}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        disabled={submitting}
        className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
        placeholder="ชื่อของคุณ"
      />

      {inlineError ? (
        <div role="alert" className={INLINE_ERROR}>
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}
