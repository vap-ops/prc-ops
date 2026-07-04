"use client";

// Spec 263 U2 — the Web Share button: the ENTIRE routing mechanism for a new
// registration (spec doc: "there is no in-app recipient picker" — the applicant
// hands the card/ID to their SA over LINE via the OS share sheet). navigator.share
// with a graceful copy-to-clipboard fallback when unavailable (desktop browsers,
// non-secure contexts). Mirrors the share/fallback shape already proven in
// reports-list.tsx (spec 60's no-window.open lesson — irrelevant here, this is
// text-only share, not a file), but this is its own small standalone control.
//
// 'use client' justified: navigator.share / navigator.clipboard are browser-only
// APIs with local pending/feedback state.

import { useState } from "react";
import { Share2 } from "lucide-react";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";

export interface ShareCardButtonProps {
  fullName: string;
  employeeId: string;
}

export function ShareCardButton({ fullName, employeeId }: ShareCardButtonProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const title = "บัตรพนักงาน PRC";
  const text = `${fullName || "ผู้สมัคร"} · รหัสพนักงาน ${employeeId} · รอการอนุมัติ`;

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
        แชร์บัตร
      </button>
      {feedback ? <p className="text-ink-muted mt-2 text-xs">{feedback}</p> : null}
    </div>
  );
}
