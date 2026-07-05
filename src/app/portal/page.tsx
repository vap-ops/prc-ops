// Spec 130 U3 / ADR 0051 / spec 266 U7 — the external self-service portal
// landing, shared by two tiers and branched on binding: a bound ช่าง (role
// `technician`, workers.user_id) sees the worker view (own profile + wage
// payments + coins); a subcontractor (role `contractor`, contractor_users) sees
// the firm view (crew + packet). requireRole(["technician","contractor"]) is the
// boundary (a staffer → roleHome bounces them to their home; a visitor →
// /coming-soon). Reads go through the RLS-respecting server client — NOT the
// admin client — so the row-level policies are the enforcement (self-scoped on
// the workers.user_id binding, never on the role). Money comes from
// get_my_wage_payments(); rate columns are never selected (column-grant-blocked).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { BankChangeForm } from "@/components/features/portal/bank-change-form";
import { WorkerBankChangeForm } from "@/components/features/portal/worker-bank-change-form";
import { PortalSelfEdit, type PortalConsent } from "@/components/features/portal/portal-self-edit";
import { PortalDocuments } from "@/components/features/portal/portal-documents";
import { PortalContactInfo } from "@/components/features/portal/portal-contact-info";
import { WorkerProfileEdit } from "@/components/features/portal/worker-profile-edit";
import { WorkerConsents } from "@/components/features/portal/worker-consents";
import { PortalReceipts, type PortalReceipt } from "@/components/features/portal/portal-receipts";
import { loadPortalData } from "@/lib/portal/load-portal-data";
import { contractorPacketStatus, dcTypeOfSubtype, type DcPacket } from "@/lib/contacts/packet";
import { bahtUnit as baht } from "@/lib/format";

// Neutral title: the page serves both a ช่าง (technician) and a subcontractor
// (contractor), so it must not label itself "ผู้รับเหมา" for the ช่าง (spec 266 U7).
export const metadata = { title: "พอร์ทัล" };

export default async function PortalPage() {
  // Spec 266 U7: admit the ช่าง's `technician` role alongside the subcontractor's
  // `contractor`; the body branches on the workers.user_id binding below.
  await requireRole(["technician", "contractor"]);
  const supabase = await createClient();

  // ADR 0062 U4b / spec 266 U7 — a ช่าง binds on workers.user_id. If this session
  // is a bound worker (role `technician`), render the worker portal (own profile +
  // wage payments + coins); otherwise fall through to the subcontractor-firm
  // portal below (role `contractor`).
  const { data: workerProfileRows } = await supabase.rpc("get_my_worker_profile");
  const wp = workerProfileRows?.[0];
  if (wp) {
    const [
      { data: workerPayments },
      { data: workerConsentRows },
      { data: receiptRows },
      { data: pendingBankRows },
    ] = await Promise.all([
      supabase.rpc("get_my_wage_payments"),
      // RLS scopes this to the bound worker's own consents (U4b-2 read-arm).
      supabase
        .from("contractor_consents")
        .select("id, kind, consented_at, revoked_at")
        .order("created_at", { ascending: false }),
      // Spec 177 U8: items issued TO this worker, still pending receipt. The
      // U6 receiver-read RLS arm scopes this to the bound worker's own issues.
      supabase
        .from("stock_issues")
        .select(
          "id, qty, unit, catalog_items ( base_item, spec_attrs ), work_packages ( code, name )",
        )
        .is("received_at", null)
        .order("issued_at", { ascending: false }),
      // Spec 170 U4c-2: an own pending bank-change request gates the form below
      // (one pending at a time). RLS scopes to the bound worker.
      supabase.from("worker_bank_change_requests").select("id").eq("status", "pending").limit(1),
    ]);
    const hasPendingWorkerBank = (pendingBankRows?.length ?? 0) > 0;
    const sortedWorkerPayments = [...(workerPayments ?? [])].sort((a, b) =>
      b.period_to.localeCompare(a.period_to),
    );
    const workerConsents = (workerConsentRows ?? []) as PortalConsent[];
    const receipts: PortalReceipt[] = (receiptRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.unit,
      qty: Number(r.qty),
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
    }));
    return (
      <PageShell>
        <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
          <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
            <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
              {wp.name}
            </h1>
            <LogoutButton />
          </div>
        </header>

        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
          {/* Spec 177 U8: items to confirm receipt — the actionable surface first. */}
          <h2 className={SECTION_HEADING}>รายการรอรับ</h2>
          <div className="mb-6">
            <PortalReceipts receipts={receipts} />
          </div>

          <h2 className={SECTION_HEADING}>ข้อมูลของฉัน</h2>
          <div className="mb-3">
            <WorkerProfileEdit
              initial={{
                phone: wp.phone ?? "",
                email: wp.email ?? "",
                emergencyName: wp.emergency_contact_name ?? "",
                emergencyRelation: wp.emergency_contact_relation ?? "",
                emergencyPhone: wp.emergency_contact_phone ?? "",
                dob: wp.date_of_birth ?? "",
              }}
            />
          </div>
          {/* tax_id is PM-entered from the ID card — read-only to the worker. */}
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
            <WorkerConsents consents={workerConsents} />
          </div>

          {/* Bank — display + self-service staged change → PM approval (U4c-2,
              the ADR-0051 §6 anti-fraud gate). The PM may also enter/edit it on
              /workers. */}
          <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
          {wp.bank_name || wp.bank_account_number || wp.bank_account_name ? (
            <div className={`${CARD} mb-3`}>
              <p className="text-ink text-sm font-medium">{wp.bank_name}</p>
              <p className="text-ink text-sm">
                {wp.bank_account_number}
                {wp.bank_account_name ? ` · ${wp.bank_account_name}` : ""}
              </p>
            </div>
          ) : (
            <div className="mb-3">
              <EmptyNotice>ยังไม่มีบัญชีธนาคาร</EmptyNotice>
            </div>
          )}
          <div className="mb-6">
            <WorkerBankChangeForm hasPending={hasPendingWorkerBank} />
          </div>

          <h2 className={SECTION_HEADING}>ประวัติการจ่ายเงิน</h2>
          {sortedWorkerPayments.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {sortedWorkerPayments.map((p) => (
                <li key={p.id} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-ink-secondary text-xs">
                      {formatThaiDate(p.period_from)} – {formatThaiDate(p.period_to)}
                    </p>
                    <p className="text-ink shrink-0 text-sm font-bold">
                      {baht(p.paid_amount ?? 0)}
                    </p>
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
        {/* Completeness — what's still missing from the DC's onboarding file */}
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
            <PortalContactInfo
              initial={{
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

        {/* Documents — DC uploads their own onboarding documents (U2c) */}
        {profile?.id && docs ? (
          <div className="mt-6">
            <PortalDocuments contractorId={profile.id} urls={docs.urls} />
          </div>
        ) : null}

        {/* Bank — self-service change request (staged → PM approval) */}
        <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
        <div className="mb-6">
          <BankChangeForm hasPending={!!pendingChange} />
        </div>

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
