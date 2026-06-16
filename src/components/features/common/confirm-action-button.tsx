"use client";

// Spec 67 — a destructive action button guarded by the themed
// ConfirmDialog. Replaces the native window.confirm that the cancel / ship
// / attachment-remove buttons each hand-rolled (§7 forbids window.confirm;
// in the installed PWA the native sheet shows a raw origin string — the
// least app-like moment, on the most irreversible actions). Button →
// dialog → onConfirm runs the action in a transition; success refreshes.
//
// 'use client' justified: dialog open state + pending state + the action.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/features/common/confirm-dialog";
import { INLINE_ALERT_TEXT } from "@/lib/ui/classes";

interface ConfirmActionButtonProps {
  idleLabel: string;
  pendingLabel: string;
  confirmMessage: string;
  confirmLabel: string;
  /** The trigger button's own classes (each call keeps its current look). */
  buttonClassName: string;
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function ConfirmActionButton({
  idleLabel,
  pendingLabel,
  confirmMessage,
  confirmLabel,
  buttonClassName,
  action,
}: ConfirmActionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={pending}
        className={buttonClassName}
      >
        {pending ? pendingLabel : idleLabel}
      </button>
      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={open}
        message={confirmMessage}
        confirmLabel={confirmLabel}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
