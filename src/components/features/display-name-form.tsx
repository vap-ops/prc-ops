"use client";

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

interface DisplayNameFormProps {
  initialName: string;
}

export function DisplayNameForm({ initialName }: DisplayNameFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, startSubmit] = useTransition();

  const trimmed = value.trim();
  const unchanged = trimmed === initialName.trim();
  const localValidation = validateDisplayName(value);
  const canSubmit = !submitting && !unchanged && localValidation.ok;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSavedAt(null);
    startSubmit(async () => {
      const result = await updateDisplayName(value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Pessimistic confirmation: only after the server-action round-
      // trip succeeded. The router.refresh() re-runs the Server
      // Component above us so the greeting picks up the new name.
      setValue(result.value);
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  const inlineError =
    error ?? (!localValidation.ok && value.length > 0 ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
    >
      <label htmlFor="display-name" className="text-sm font-medium text-zinc-200">
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
          setSavedAt(null);
        }}
        disabled={submitting}
        className="h-9 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
        placeholder="ชื่อของคุณ"
      />

      {inlineError ? (
        <div
          role="alert"
          className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200"
        >
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {savedAt !== null && !submitting ? (
          <span className="text-xs text-emerald-400" role="status">
            บันทึกแล้ว
          </span>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 bg-zinc-100 px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </form>
  );
}
