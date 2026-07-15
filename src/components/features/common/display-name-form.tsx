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
  // Spec 321 U5 — when hosted inside a BottomSheet (the edit-in-modal rule), drop
  // the standalone card chrome (the sheet already supplies it) and notify the host
  // to close on a successful save.
  bare?: boolean;
  onSaved?: () => void;
}

export function DisplayNameForm({ initialName, bare = false, onSaved }: DisplayNameFormProps) {
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
      onSaved?.();
    });
  }

  const inlineError =
    error ?? (!localValidation.ok && value.length > 0 ? localValidation.error : null);

  return (
    <form
      onSubmit={handleSubmit}
      className={
        bare
          ? "flex flex-col gap-3"
          : "rounded-card border-edge bg-card shadow-card flex flex-col gap-3 border p-4"
      }
    >
      <label htmlFor="display-name" className="text-ink text-sm font-medium">
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
        className="rounded-control border-edge-strong bg-card text-ink placeholder:text-ink-muted focus-visible:ring-action h-11 border px-3 text-sm shadow-xs focus:outline-none focus-visible:ring-2"
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
