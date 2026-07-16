// Spec 130 U3 / ADR 0051 / spec 266 U7 (C) — the subcontractor (ผู้รับเหมาช่วง)
// self-service portal. `contractor` tier ONLY: requireRole(["contractor"]) is the
// boundary (a staffer → roleHome bounces them to their home; a visitor →
// /coming-soon). A ช่าง logs in as `technician` and gets their OWN portal at
// /technician — the worker view no longer lives here. Reads go through the
// RLS-respecting server client — NOT the admin client — so the row-level policies
// (self-scoped to the caller's contractor) are the enforcement; rate columns are
// never selected (column-grant-blocked anyway).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { ProfileBankSection } from "@/components/features/profile/profile-bank-section";
import { PortalSelfEdit, type PortalConsent } from "@/components/features/portal/portal-self-edit";
import { PortalDocuments } from "@/components/features/portal/portal-documents";
import { ProfileContactSection } from "@/components/features/profile/profile-contact-section";
import { loadPortalData } from "@/lib/portal/load-portal-data";
import { ViewAsEmptyNote } from "@/components/features/chrome/view-as-empty-note";
import { contractorPacketStatus, dcTypeOfSubtype, type DcPacket } from "@/lib/contacts/packet";
import { bahtUnit as baht } from "@/lib/format";

export const metadata = { title: "พอร์ทัลผู้รับเหมา" };

export default async function PortalPage() {
  await requireRole(["contractor"]);
  const supabase = await createClient();

  // Spec 147 U4: one loader batches the RLS-self-scoped reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  // (spec 131 U2c — own docs + bank-present feed the completeness checklist.)
  const { profile, consentRows, crew, payments, pendingChange, bankPresent, docs } =
    await loadPortalData(supabase);

  const consentActive = (kind: "pdpa_data" | "background_check"): boolean =>
    (consentRows ?? []).some((c) => c.kind === kind && c.revoked_at === null);

  const packet: DcPacket = {
    idCard: docs?.present.has("id_card") ?? false,
    bankBook: docs?.present.has("bank_book") ?? false,
    bank: bankPresent ?? false,
    phone: !!profile?.phone,
    emergencyContact: !!profile?.emergency_contact_phone,
    consentPdpa: consentActive("pdpa_data"),
    consentBackgroundCheck: consentActive("background_check"),
    companyCert: docs?.present.has("company_cert") ?? false,
    vatCert: docs?.present.has("vat_cert") ?? false,
  };
  const packetStatus = profile?.id
    ? contractorPacketStatus(packet, dcTypeOfSubtype(profile.contractor_subtype ?? null))
    : null;

  const sortedPayments = [...(payments ?? [])].sort((a, b) =>
    b.period_to.localeCompare(a.period_to),
  );

  const detail = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex justify-between gap-3 py-1">
        <dt className="text-ink-secondary text-sm">{label}</dt>
        <dd className="text-ink min-w-0 truncate text-sm font-medium">{value}</dd>
      </div>
    ) : null;

  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
            {profile?.name ?? "พอร์ทัลผู้รับเหมา"}
          </h1>
          <LogoutButton />
        </div>
      </header>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <ViewAsEmptyNote />
        {/* Completeness — what's still missing from the ผู้รับเหมา's onboarding file */}
        {packetStatus ? (
          <section
            className={
              packetStatus.complete
                ? `${CARD} mb-6`
                : `${CARD} border-attn bg-attn-soft mb-6 border-l-4`
            }
          >
            <p className="text-ink text-sm font-semibold">สถานะเอกสาร</p>
            {packetStatus.complete ? (
              <p className="text-done-strong mt-1 text-sm font-medium">เอกสารครบถ้วน</p>
            ) : (
              <p className="text-attn-ink mt-1 text-sm">ขาด: {packetStatus.missing.join(" · ")}</p>
            )}
          </section>
        ) : null}

        {/* Profile — contactability is self-editable; tax_id (PM-only, from the
            ID card) + specialty are read-only. Spec 132 U1. */}
        <h2 className={SECTION_HEADING}>ข้อมูลของฉัน</h2>
        {profile?.id ? (
          <div className="mb-3">
            <ProfileContactSection
              audience="contractor"
              current={{
                phone: profile.phone ?? "",
                email: profile.email ?? "",
                contactPerson: profile.contact_person ?? "",
                mailingAddress: profile.mailing_address ?? "",
              }}
            />
          </div>
        ) : null}
        {profile?.tax_id || profile?.specialty ? (
          <dl className={`${CARD} mb-6`}>
            {detail("เลขผู้เสียภาษี", profile?.tax_id)}
            {detail("งานที่ถนัด", profile?.specialty)}
          </dl>
        ) : (
          <div className="mb-6" />
        )}

        {/* Self-service: emergency contact + PDPA/background-check consent */}
        {profile?.id ? (
          <PortalSelfEdit
            contractorId={profile.id}
            ec={{
              name: profile.emergency_contact_name ?? "",
              relation: profile.emergency_contact_relation ?? "",
              phone: profile.emergency_contact_phone ?? "",
              dob: profile.date_of_birth ?? "",
            }}
            consents={(consentRows ?? []) as PortalConsent[]}
          />
        ) : null}

        {/* Documents — the ผู้รับเหมา uploads their own onboarding documents (U2c) */}
        {profile?.id && docs ? (
          <div className="mt-6">
            <PortalDocuments contractorId={profile.id} urls={docs.urls} />
          </div>
        ) : null}

        {/* Bank — self-service change request (staged → PM approval). Needs the
            bound contractor id for the passbook upload path (spec 317 U5). */}
        {profile?.id ? (
          <>
            <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
            <div className="mb-6">
              <ProfileBankSection
                audience="contractor"
                ownerId={profile.id}
                current={null}
                hasPending={!!pendingChange}
              />
            </div>
          </>
        ) : null}

        {/* Crew */}
        <h2 className={SECTION_HEADING}>ทีมช่าง</h2>
        {crew && crew.length > 0 ? (
          <ul className={`${CARD} divide-edge mb-6 flex flex-col divide-y`}>
            {crew.map((w) => (
              <li key={w.worker_id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-ink block truncate text-sm font-medium">{w.name}</span>
                  {/* Spec 160 U3: where this crew member is currently deployed. */}
                  <span className="text-ink-secondary block truncate text-xs">
                    {w.project_name ? (
                      <>
                        {w.project_name}{" "}
                        <span className="text-ink-muted font-mono">{w.project_code}</span>
                      </>
                    ) : (
                      "ยังไม่ได้กำหนดโครงการ"
                    )}
                  </span>
                </div>
                {!w.active ? (
                  <span className="text-ink-muted shrink-0 text-xs">ปิดใช้งาน</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mb-6">
            <EmptyNotice>ยังไม่มีรายชื่อทีมช่าง</EmptyNotice>
          </div>
        )}

        {/* Payment history */}
        <h2 className={SECTION_HEADING}>ประวัติการจ่ายเงิน</h2>
        {sortedPayments.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sortedPayments.map((p) => (
              <li key={p.id} className={CARD}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-ink-secondary text-xs">
                    {formatThaiDate(p.period_from)} – {formatThaiDate(p.period_to)}
                  </p>
                  <p className="text-ink shrink-0 text-sm font-bold">{baht(p.paid_amount ?? 0)}</p>
                </div>
                <p className="text-ink-secondary mt-1 text-xs">
                  จ่ายเมื่อ {formatThaiDate(p.paid_at)} · {WAGE_PAYMENT_METHOD_LABELS[p.method]}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNotice>ยังไม่มีประวัติการจ่ายเงิน</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
