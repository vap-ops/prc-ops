// Spec 88 — Contacts v2 Unit 5: contact detail page. PM/super only. Read-only
// field display (editing stays inline on the list, spec 87) + the money-isolated
// bank block (admin-read here, behind the requireRole gate; written via the RPC).
// Documents (U7) and crew (U8) sections attach to this page in their units.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { CARD } from "@/lib/ui/classes";
import { ContactBankBlock } from "@/components/features/contacts/contact-bank-block";
import { ContactCrewSection } from "@/components/features/contacts/contact-crew-section";
import { ContactDocumentsBlock } from "@/components/features/contacts/contact-documents-block";
import { getContactBank, type ContactKind } from "@/lib/contacts/bank";
import { getContactDocuments } from "@/lib/contacts/documents";
import { BankChangeDecision } from "@/components/features/portal/bank-change-decision";
import { ContractorInviteBlock } from "@/components/features/portal/contractor-invite-block";
import {
  ContactConsentBlock,
  type ConsentRow,
} from "@/components/features/contacts/contact-consent-block";
import { contractorPacketStatus, dcTypeOfSubtype, type DcPacket } from "@/lib/contacts/packet";

const TYPE_CONFIG = {
  clients: { table: "clients", kind: null, label: "ลูกค้า" },
  suppliers: { table: "suppliers", kind: "supplier", label: "ผู้ขาย" },
  contractors: { table: "contractors", kind: "contractor", label: "ผู้รับเหมา / DC" },
  "service-providers": {
    table: "service_providers",
    kind: "service_provider",
    label: "ผู้ให้บริการ",
  },
} as const;

const LABELS: Record<string, string> = {
  contact_person: "ผู้ติดต่อ",
  phone: "เบอร์โทร",
  email: "อีเมล",
  mailing_address: "ที่อยู่",
  tax_id: "เลขผู้เสียภาษี",
  payment_terms: "เงื่อนไขการชำระเงิน",
  specialty: "งานที่รับ",
  date_of_birth: "วันเกิด",
  emergency_contact_name: "ผู้ติดต่อฉุกเฉิน",
  emergency_contact_relation: "ความสัมพันธ์",
  emergency_contact_phone: "เบอร์ฉุกเฉิน",
  vehicle_type: "ประเภทรถ",
  plate_no: "ทะเบียนรถ",
  contractor_subtype: "ประเภท DC",
  status: "สถานะ",
  note: "หมายเหตุ",
};

const STATUS_LABEL: Record<string, string> = {
  active: "ปกติ",
  probation: "ทดลองงาน",
  blacklisted: "บัญชีดำ",
};
const SUBTYPE_LABEL: Record<string, string> = {
  regular: "ประจำ",
  dc_company: "DC บริษัท",
  dc_regular: "DC ประจำ",
  dc_temporary: "DC ชั่วคราว",
};

function displayValue(key: string, value: string): string {
  if (key === "status") return STATUS_LABEL[value] ?? value;
  if (key === "contractor_subtype") return SUBTYPE_LABEL[value] ?? value;
  return value;
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type, id } = await params;
  const cfg = TYPE_CONFIG[type as keyof typeof TYPE_CONFIG];
  if (!cfg) notFound();

  await requireRole(PM_ROLES);
  const supabase = await createServerSupabase();
  const { data: record } = await supabase.from(cfg.table).select("*").eq("id", id).maybeSingle();
  if (!record) notFound();

  const row = record as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name : "";

  const fields = Object.keys(LABELS)
    .filter((k) => typeof row[k] === "string" && (row[k] as string).length > 0)
    .map((k) => ({ label: LABELS[k] as string, value: displayValue(k, row[k] as string) }));

  const kind = cfg.kind as ContactKind | null;
  // One admin client for the money/PII reads (bank + documents); both are behind
  // the requireRole(PM_ROLES) gate above.
  const admin = kind ? createAdminSupabase() : null;
  const bank = kind && admin ? await getContactBank(admin, kind, id) : null;
  const documents = kind && admin ? await getContactDocuments(admin, kind, id) : null;

  // Spec 90: a contractor's crew = the DC workers parented by it (names only;
  // rates stay on /workers). Only the contractors route has crew.
  let crew: { id: string; name: string }[] = [];
  // Spec 130 U5 — is this contractor already bound to a portal user? Staff read
  // all contractor_users bindings (RLS); decides invite-vs-linked on the page.
  let alreadyBound = false;
  if (type === "contractors") {
    const { data: crewRows } = await supabase
      .from("workers")
      .select("id, name")
      .eq("contractor_id", id)
      .eq("worker_type", "dc")
      .order("name", { ascending: true });
    crew = crewRows ?? [];

    const { data: binding } = await supabase
      .from("contractor_users")
      .select("user_id")
      .eq("contractor_id", id)
      .limit(1);
    alreadyBound = (binding?.length ?? 0) > 0;
  }

  // Spec 130 U4 — pending DC bank-change requests awaiting PM approval (money;
  // admin-read behind the requireRole gate, same as the bank block).
  const pendingBankChanges =
    type === "contractors" && admin
      ? ((
          await admin
            .from("contractor_bank_change_requests")
            .select("id, bank_name, bank_account_no, bank_account_name")
            .eq("contractor_id", id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
        ).data ?? [])
      : [];

  // Spec 131 U2 — consent records + onboarding-packet completeness (contractors).
  const consents: ConsentRow[] =
    type === "contractors" && admin
      ? ((
          await admin
            .from("contractor_consents")
            .select("id, kind, consented_at, revoked_at")
            .eq("contractor_id", id)
            .order("created_at", { ascending: false })
        ).data ?? [])
      : [];
  const hasActiveConsent = (k: ConsentRow["kind"]) =>
    consents.some((c) => c.kind === k && c.revoked_at === null);
  const packet: DcPacket = {
    idCard: documents?.idCard != null,
    bankBook: documents?.bankBook != null,
    bank: bank != null && !!bank.bankAccountNo,
    phone: !!row.phone,
    emergencyContact: !!row.emergency_contact_phone,
    consentPdpa: hasActiveConsent("pdpa_data"),
    consentBackgroundCheck: hasActiveConsent("background_check"),
    // Spec 131 — company-DC papers, presence from the signed-URL read.
    companyCert: documents?.companyCert != null,
    vatCert: documents?.vatCert != null,
  };
  const packetStatus =
    type === "contractors"
      ? contractorPacketStatus(packet, dcTypeOfSubtype((row.contractor_subtype as string) ?? null))
      : null;

  return (
    <PageShell>
      <DetailHeader backHref="/contacts" backLabel="กลับไปรายชื่อติดต่อ">
        <p className="text-ink-muted text-xs font-medium">{cfg.label}</p>
        <h1 className={DETAIL_TITLE}>{name}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} space-y-4 px-5 py-6`}>
        {packetStatus ? (
          <section
            className={packetStatus.complete ? CARD : `${CARD} border-attn bg-attn-soft border-l-4`}
          >
            <p className="text-ink text-sm font-semibold">สถานะเอกสาร DC</p>
            {packetStatus.complete ? (
              <p className="text-done-strong mt-1 text-sm font-medium">เอกสารครบถ้วน</p>
            ) : (
              <p className="text-attn-ink mt-1 text-sm">ขาด: {packetStatus.missing.join(" · ")}</p>
            )}
          </section>
        ) : null}

        <section className={CARD}>
          <p className="text-ink text-sm font-semibold">ข้อมูลติดต่อ</p>
          {fields.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-2">
              {fields.map((f) => (
                <div key={f.label} className="flex flex-col">
                  <dt className="text-ink-muted text-xs">{f.label}</dt>
                  <dd className="text-ink text-sm whitespace-pre-wrap">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-ink-muted mt-2 text-sm">
              ยังไม่มีข้อมูลเพิ่มเติม — แก้ไขได้ที่หน้ารายการ
            </p>
          )}
        </section>

        {pendingBankChanges.length > 0 ? (
          <section className={`${CARD} border-attn bg-attn-soft border-l-4`}>
            <p className="text-attn-ink text-sm font-semibold">
              คำขอเปลี่ยนบัญชีธนาคาร (รออนุมัติ)
            </p>
            <ul className="mt-2 flex flex-col gap-3">
              {pendingBankChanges.map((r) => (
                <li key={r.id} className="border-edge border-t pt-3 first:border-t-0 first:pt-0">
                  <p className="text-ink text-sm font-medium">{r.bank_name}</p>
                  <p className="text-ink text-sm">
                    {r.bank_account_no}
                    {r.bank_account_name ? ` · ${r.bank_account_name}` : ""}
                  </p>
                  <div className="mt-2">
                    <BankChangeDecision requestId={r.id} revalidate={`/contacts/${type}/${id}`} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {kind ? <ContactBankBlock kind={kind} id={id} initial={bank} /> : null}
        {kind ? (
          <ContactDocumentsBlock
            kind={kind}
            id={id}
            idCardUrl={documents?.idCard ?? null}
            bankBookUrl={documents?.bankBook ?? null}
            companyCertUrl={documents?.companyCert ?? null}
            vatCertUrl={documents?.vatCert ?? null}
            showCompanyDocs={
              type === "contractors" &&
              dcTypeOfSubtype((row.contractor_subtype as string) ?? null) === "company"
            }
          />
        ) : null}
        {type === "contractors" ? (
          <ContractorInviteBlock contractorId={id} alreadyBound={alreadyBound} />
        ) : null}
        {type === "contractors" ? (
          <ContactConsentBlock contractorId={id} consents={consents} />
        ) : null}
        {type === "contractors" ? <ContactCrewSection contractorId={id} crew={crew} /> : null}
      </div>
    </PageShell>
  );
}
