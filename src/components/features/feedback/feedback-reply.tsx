"use client";

// Spec 201 U2 — the operator's reply composer on a feedback thread. A textarea +
// send; on send it relays to postFeedbackMessage (super-only RPC), clears, and
// refreshes the thread. A blank reply is a no-op. (The reporter-reply composer is
// a later unit; in U2 this renders only for the super_admin operator.)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postFeedbackMessage } from "@/app/feedback/[id]/actions";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, FIELD_STACKED } from "@/lib/ui/classes";

export function FeedbackReply({ feedbackId }: { feedbackId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");

  function send() {
    const trimmed = body.trim();
    if (trimmed.length < 1) return;
    startTransition(async () => {
      const result = await postFeedbackMessage(feedbackId, trimmed);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBody("");
      toast.success("ส่งแล้ว");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-ink-secondary block text-sm font-medium">
        ตอบกลับผู้แจ้ง
        <textarea
          value={body}
          maxLength={4000}
          rows={3}
          disabled={pending}
          onChange={(e) => setBody(e.target.value)}
          placeholder="พิมพ์ข้อความถึงผู้แจ้ง เช่น ขอรายละเอียดเพิ่ม หรือแจ้งความคืบหน้า"
          className={`${FIELD_STACKED} resize-y`}
        />
      </label>
      <button type="button" disabled={pending} onClick={send} className={`w-fit ${BUTTON_PRIMARY}`}>
        {pending ? "กำลังส่ง…" : "ส่ง"}
      </button>
    </div>
  );
}
