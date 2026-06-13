// Spec 88 — Contacts v2 Unit 5: contact detail page. PM/super only. Read-only
// field display (editing stays inline on the list, spec 87) + the money-isolated
// bank block (admin-read here, behind the requireRole gate; written via the RPC).
// Documents (U7) and crew (U8) sections attach to this page in their units.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/detail-header";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { CARD } from "@/lib/ui/classes";
import { ContactBankBlock } from "@/components/features/contact-bank-block";
import { getContactBank, type ContactKind } from "@/lib/contacts/bank";

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
  const bank = kind ? await getContactBank(createAdminSupabase(), kind, id) : null;

  return (
    <PageShell>
      <DetailHeader backHref="/contacts" backLabel="กลับไปรายชื่อติดต่อ">
        <p className="text-xs font-medium text-zinc-500">{cfg.label}</p>
        <h1 className={DETAIL_TITLE}>{name}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} space-y-4 px-5 py-6`}>
        <section className={CARD}>
          <p className="text-sm font-semibold text-zinc-900">ข้อมูลติดต่อ</p>
          {fields.length > 0 ? (
            <dl className="mt-2 flex flex-col gap-2">
              {fields.map((f) => (
                <div key={f.label} className="flex flex-col">
                  <dt className="text-xs text-zinc-500">{f.label}</dt>
                  <dd className="text-sm whitespace-pre-wrap text-zinc-900">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              ยังไม่มีข้อมูลเพิ่มเติม — แก้ไขได้ที่หน้ารายการ
            </p>
          )}
        </section>

        {kind ? <ContactBankBlock kind={kind} id={id} initial={bank} /> : null}
      </div>
    </PageShell>
  );
}
