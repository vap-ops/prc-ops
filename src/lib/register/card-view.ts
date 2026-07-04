// Spec 263 U2 — the e-employee card's status badge, a pure render of
// technician_registrations.status (never stored state — the spec doc: "a
// render, not stored state"). One mapper, every card state.

import type { Database } from "@/lib/db/database.types";

type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

export type BadgeTone = "pending" | "approved" | "rejected";

export interface StatusBadge {
  label: string;
  tone: BadgeTone;
}

const BADGES: Record<RegistrationStatus, StatusBadge> = {
  pending: { label: "รออนุมัติ", tone: "pending" },
  approved: { label: "อนุมัติแล้ว", tone: "approved" },
  rejected: { label: "ถูกปฏิเสธ", tone: "rejected" },
};

export function registrationStatusBadge(status: RegistrationStatus): StatusBadge {
  return BADGES[status];
}

// Spec 263 follow-up — operator: the e-card's default image should be the
// user's LINE profile photo, not a blank placeholder, until they upload their
// own. Pure resolution order: uploaded profile_photo (signed URL) wins → else
// users.line_avatar_url (an external LINE-CDN URL, live display fallback
// only — never copied into storage) → else null, and the card renders its
// existing placeholder on null.
export function resolveCardPhoto(
  profilePhotoUrl: string | null,
  lineAvatarUrl: string | null,
): string | null {
  return profilePhotoUrl ?? lineAvatarUrl ?? null;
}
