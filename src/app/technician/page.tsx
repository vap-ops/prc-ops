// Spec 264 G3 / ADR 0072 §8 — the minimal /technician home. The anti-dead-end
// landing an approved technician reaches after login (roleHome('technician') →
// /technician, killing the old /coming-soon fall-through). Deliberately minimal:
// the person's e-employee card + approval status + an "assigned WPs — coming
// soon" placeholder, room to grow into the real work-package list later (the WP
// list itself is out of scope now, spec doc §"Out of scope").
//
// Data: the technician's OWN staff_registration (approved) + its documents, read
// on the RLS SESSION client (never the admin client) — the G1 own-row policy
// scopes staff_registrations / attachments / storage to auth.uid(); the same
// resolver the register workspace uses (getOwnTechnicianRegistration +
// resolveCardPhoto), so the card fields (name, employee_id, status, photo) stay a
// single source of truth. No 'use client' — this is a plain Server Component.

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { resolveCardPhoto } from "@/lib/register/card-view";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
} from "@/lib/register/own-registration";

export const metadata = { title: "หน้าหลักช่าง" };

export default async function TechnicianHomePage() {
  const { id: uid } = await requireRole(["technician"]);
  const supabase = await createClient();

  const { data: userRow } = await supabase
    .from("users")
    .select("line_avatar_url")
    .eq("id", uid)
    .maybeSingle();

  const registration = await getOwnTechnicianRegistration(supabase, uid);
  const { urls } = registration
    ? await getOwnRegistrationDocuments(supabase, registration.id)
    : { urls: {} };

  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>หน้าหลักช่าง</h1>

        {registration ? (
          <EmployeeCard
            employeeId={registration.employee_id}
            fullName={registration.full_name}
            status={registration.status}
            photoUrl={resolveCardPhoto(
              urls.profile_photo ?? null,
              userRow?.line_avatar_url ?? null,
            )}
          />
        ) : null}

        <div className={CARD}>
          <div className="flex items-center gap-2">
            <p className="text-ink text-sm font-semibold">งานที่ได้รับมอบหมาย</p>
            <ComingSoonBadge />
          </div>
          <p className="text-ink-secondary mt-1 text-sm">
            รายการงานที่คุณได้รับมอบหมายจะแสดงที่นี่ เร็ว ๆ นี้
          </p>
        </div>
      </section>
    </PageShell>
  );
}
