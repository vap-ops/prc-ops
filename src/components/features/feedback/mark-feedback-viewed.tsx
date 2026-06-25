"use client";

// Spec 201 A2 — when the reporter opens a feedback thread, record it as viewed so the
// "new reply" dot on /feedback/mine clears. Best-effort network island (same posture
// as the SelfCountBadge head-counts): it fires once on mount via the browser client
// (RLS context) and swallows any failure — a missed view just leaves the dot until the
// next open. Marking runs AFTER render (a mount effect), never during it, so the dot
// only clears once the reporter has actually loaded the thread. Renders nothing.

import { useEffect } from "react";
import { createClient } from "@/lib/db/browser";

export function MarkFeedbackViewed({ feedbackId }: { feedbackId: string }) {
  useEffect(() => {
    void createClient()
      .rpc("mark_feedback_viewed", { p_feedback_id: feedbackId })
      .then(() => {
        // best-effort: nothing to do on success; the dot clears on next list load
      });
  }, [feedbackId]);
  return null;
}
