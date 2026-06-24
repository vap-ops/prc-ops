// Spec 193 — in-app feedback (bug report / feature request). Pure shape/UX
// validation. Length caps mirror the feedback table CHECKs; the submit_feedback
// RPC re-guards. Thai, user-facing. `screen` (the user-named screen/menu) is
// optional — every other signal CC needs (role, version, device) is auto-captured.

export type FeedbackType = "bug" | "feature";

// Spec 193 U3 — the triage lifecycle (mirrors the feedback_status enum).
export type FeedbackStatus = "open" | "in_progress" | "done" | "declined";

export const FEEDBACK_TITLE_MAX = 200;
export const FEEDBACK_BODY_MAX = 4000;
export const FEEDBACK_SCREEN_MAX = 200;

export function isFeedbackType(v: string): v is FeedbackType {
  return v === "bug" || v === "feature";
}

export function isFeedbackStatus(v: string): v is FeedbackStatus {
  return v === "open" || v === "in_progress" || v === "done" || v === "declined";
}

export function validateFeedback(input: {
  type: string;
  title: string;
  body: string;
  screen?: string;
}): string | null {
  if (!isFeedbackType(input.type)) return "ประเภทไม่ถูกต้อง";

  const title = input.title.trim();
  if (!title) return "กรุณาใส่หัวข้อ";
  if (title.length > FEEDBACK_TITLE_MAX) return "หัวข้อยาวเกินไป";

  const body = input.body.trim();
  if (!body) return "กรุณาใส่รายละเอียด";
  if (body.length > FEEDBACK_BODY_MAX) return "รายละเอียดยาวเกินไป";

  const screen = (input.screen ?? "").trim();
  if (screen.length > FEEDBACK_SCREEN_MAX) return "ชื่อหน้าจอยาวเกินไป";

  return null;
}
