// Spec 266 U7 (option C) — the ช่าง's own portal content, hosted on /technician
// (a ช่าง logs in as `technician` and gets a dedicated home; the subcontractor
// /portal no longer carries the worker view). Extracted verbatim from the old
// /portal worker branch so the two surfaces don't drift. Pure render from loaded
// data — no I/O; the caller fetches on the RLS server client (self-scoped by the
// workers.user_id binding). Server Component (the interactive bits are the
// already-'use client' children).
//
// Spec 376 U3 (D3): this is now the IDENTITY half only — ข้อมูลของฉัน (contact +
// the PM-entered tax id) and ความยินยอม. The money half (รายการรอรับ, wage
// history, bank) moved to WorkerHistorySections on the ประวัติ route when the
// technician's one scroll page became a three-tab surface. `uid` left with it:
// its only reader was the bank form's upload path.

import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { ProfileContactSection } from "@/components/features/profile/profile-contact-section";
import { WorkerConsents } from "@/components/features/portal/worker-consents";
import type { PortalConsent } from "@/components/features/portal/portal-self-edit";
import type { Database } from "@/lib/db/database.types";

type WorkerProfile = Database["public"]["Functions"]["get_my_worker_profile"]["Returns"][number];

export function WorkerPortalSections({
  wp,
  consents,
}: {
  wp: WorkerProfile;
  consents: PortalConsent[];
}) {
  return (
    <>
      <h2 className={SECTION_HEADING}>ข้อมูลของฉัน</h2>
      <div className="mb-3">
        <ProfileContactSection
          audience="worker"
          current={{
            phone: wp.phone ?? "",
            email: wp.email ?? "",
            emergencyName: wp.emergency_contact_name ?? "",
            emergencyRelation: wp.emergency_contact_relation ?? "",
            emergencyPhone: wp.emergency_contact_phone ?? "",
          }}
        />
      </div>
      {/* tax_id is PM-entered from the ID card — read-only to the ช่าง. */}
      {wp.tax_id ? (
        <dl className={`${CARD} mb-6`}>
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-secondary text-sm">เลขผู้เสียภาษี</dt>
            <dd className="text-ink min-w-0 truncate text-sm font-medium">{wp.tax_id}</dd>
          </div>
        </dl>
      ) : (
        <div className="mb-6" />
      )}

      <h2 className={SECTION_HEADING}>ความยินยอม</h2>
      <div className="mb-6">
        <WorkerConsents consents={consents} />
      </div>
    </>
  );
}
