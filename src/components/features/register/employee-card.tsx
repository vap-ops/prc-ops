// Spec 263 U2 — the e-employee card: a render of live registration data, NEVER
// stored state. Fields: profile photo (or a placeholder), the minted employee_id
// (PRC-YY-NNNN), full_name, and a status badge (pending/approved/rejected, read
// from technician_registrations.status). Reusable — the parent page renders it
// both while pending and once approved (post-approval the same fields still
// resolve from the registration row).

import { User } from "lucide-react";
import { CARD } from "@/lib/ui/classes";
import { registrationStatusBadge, type BadgeTone } from "@/lib/register/card-view";
import type { Database } from "@/lib/db/database.types";

type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  pending: "border-attn-edge bg-attn-soft text-attn-ink",
  approved: "border-done-edge bg-done-soft text-done-ink",
  rejected: "border-danger-edge bg-danger-soft text-danger-ink",
};

export interface EmployeeCardProps {
  employeeId: string;
  fullName: string | null;
  status: RegistrationStatus;
  photoUrl: string | null;
}

export function EmployeeCard({ employeeId, fullName, status, photoUrl }: EmployeeCardProps) {
  const badge = registrationStatusBadge(status);
  return (
    <div className={`${CARD} flex items-center gap-4`}>
      <div className="border-edge bg-page h-16 w-16 shrink-0 overflow-hidden rounded-full border">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={fullName ?? "รูปโปรไฟล์"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-ink-muted flex h-full w-full items-center justify-center">
            <User aria-hidden className="h-8 w-8" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-ink truncate text-sm font-semibold">{fullName || "ยังไม่ได้ระบุชื่อ"}</p>
        <p className="text-ink-secondary font-mono text-xs">{employeeId}</p>
        <span
          className={`text-meta mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${BADGE_TONE_CLASSES[badge.tone]}`}
        >
          {badge.tone === "pending" ? "⏳" : badge.tone === "approved" ? "✅" : "✕"} {badge.label}
        </span>
      </div>
    </div>
  );
}
