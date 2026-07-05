// Spec 264 G2 — pure view-model for the one-page self-service form: which of
// the approve_staff_registration DB floor's three requirements (spec doc
// §"Role-parametric approve", step 4 — full_name + a live id_card attachment +
// a live PDPA consent record) are still missing, so the page can show a plain
// "required for approval" checklist. `profile_photo` is intentionally never
// part of the floor — it's optional (the e-card falls back to the LINE avatar).
// Pure — no RPC/DB access, mirrors registration-profile.ts's shape.

export type ApprovalRequirement = "full_name" | "id_card" | "consent";

export interface ApprovalFloorInput {
  fullName: string | null;
  hasIdCard: boolean;
  hasConsent: boolean;
}

export interface ApprovalFloor {
  met: boolean;
  missing: ApprovalRequirement[];
}

export function registrationApprovalFloor(input: ApprovalFloorInput): ApprovalFloor {
  const missing: ApprovalRequirement[] = [];
  if (!(input.fullName ?? "").trim()) missing.push("full_name");
  if (!input.hasIdCard) missing.push("id_card");
  if (!input.hasConsent) missing.push("consent");
  return { met: missing.length === 0, missing };
}
