"use client";

// Spec 263 U2 — the Web Share button: an OPTIONAL courtesy, not the routing
// mechanism approval depends on (spec 264 follow-up correction: the
// back-office queue at /registrations already lists every pending
// registration, so approval never needs this share). navigator.share with a
// graceful copy-to-clipboard fallback when unavailable (desktop browsers,
// non-secure contexts). Mirrors the share/fallback shape already proven in
// reports-list.tsx (spec 60's no-window.open lesson — irrelevant here, this is
// text-only share, not a file), but this is its own small standalone control.
//
// Spec 264 follow-up (Handoff Unit A) — operator: the SA receiving this over
// LINE didn't know what was wanted of them. Label + shared/clipboard text
// reworded (COPY ONLY) to read as a no-action-needed notice; label demotes
// the button to "(ถ้ามี)" and the waiting card above it (page.tsx) is now the
// primary "you're done" message.
//
// 'use client' justified: navigator.share / navigator.clipboard are browser-only
// APIs with local pending/feedback state.

import { useState } from "react";
import { Share2 } from "lucide-react";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";
import { SHARE_CARD_BUTTON_LABEL, SHARE_CARD_TITLE, shareCardText } from "@/lib/i18n/labels";

export interface ShareCardButtonProps {
  fullName: string;
  employeeId: string;
}

export function ShareCardButton({ fullName, employeeId }: ShareCardButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const title = SHARE_CARD_TITLE;
  const text = shareCardText(fullName, employeeId);

  async function handleShare() {
    setFeedback(null);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text });
      } catch (err) {
        // User closed the sheet — not an error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        await copyFallback();
      }
      return;
    }
    await copyFallback();
  }

  async function copyFallback() {
    try {
      await navigator.clipboard.writeText(`${title}\n${text}`);
      setFeedback("คัดลอกแล้ว — วางเพื่อส่งต่อ");
    } catch {
      setFeedback("แชร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleShare()}
        className={`inline-flex items-center gap-2 ${BUTTON_SECONDARY}`}
      >
        <Share2 aria-hidden className="h-4 w-4" />
        {SHARE_CARD_BUTTON_LABEL}
      </button>
      {feedback ? <p className="text-ink-muted mt-2 text-xs">{feedback}</p> : null}
    </div>
  );
}
