"use client";

// 'use client' justification (spec 23): window.confirm + pending state
// around the tombstone server action (photo-remove precedent).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removePurchaseRequestAttachment } from "@/app/requests/actions";

interface AttachmentRemoveButtonProps {
  attachmentId: string;
}

export function AttachmentRemoveButton({ attachmentId }: AttachmentRemoveButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    if (!window.confirm("ลบรายการแนบนี้หรือไม่?")) return;
    setError(null);
    startTransition(async () => {
      const result = await removePurchaseRequestAttachment({ attachmentId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={handleRemove}
        disabled={pending}
        className="text-xs font-medium text-red-700 underline-offset-2 hover:underline focus:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "กำลังลบ…" : "ลบ"}
      </button>
      {error ? (
        <span role="alert" className="text-[10px] text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
