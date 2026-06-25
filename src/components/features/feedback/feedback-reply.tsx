"use client";

// Spec 201 U2/U3 — the reply composer on a feedback thread. A textarea + send; on
// send it relays to postFeedbackMessage, clears, and refreshes the thread. A blank
// reply is a no-op. The same composer serves both ends of the conversation — the
// super_admin operator and the report's own submitter — because the RPC derives the
// author voice (operator vs reporter) from the caller (U3); the page decides who
// sees it (canReply = super_admin || submitter).

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
        ตอบกลับ
        <textarea
          value={body}
          maxLength={4000}
          rows={3}
          disabled={pending}
          onChange={(e) => setBody(e.target.value)}
          placeholder="พิมพ์ข้อความ…"
          className={`${FIELD_STACKED} resize-y`}
        />
      </label>
      <button type="button" disabled={pending} onClick={send} className={`w-fit ${BUTTON_PRIMARY}`}>
        {pending ? "กำลังส่ง…" : "ส่ง"}
      </button>
    </div>
  );
}
