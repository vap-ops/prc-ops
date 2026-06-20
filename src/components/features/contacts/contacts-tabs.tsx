"use client";

// Spec 87 — Contacts v2 list-first shell. Spec 99 split the five types into
// three GROUP screens (customers / vendors / crews, see lib/contacts/groups);
// this shell renders one group's tabs (ผู้รับเหมา and DC are the ONE contractors
// table split by contractor_category). Each tab is a list with an Add button
// that opens the form in a BottomSheet (spec 78); statused tabs (contractor/dc/
// service) carry a chip and a status sub-filter. Actions are injected per tab
// (the tab sets the category for contractor/dc creates).
//
// 'use client' justification: tab + status-filter state; binding the actions.

import { useMemo, useState } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  CONTACT_GROUP_TABS,
  STATUS_TABS,
  type ContactGroup,
  type ContactTab,
} from "@/lib/contacts/groups";
import {
  RecordManager,
  type RecordBadge,
  type RecordFieldDef,
  type RecordRow,
} from "@/components/features/purchasing/record-manager";
import { SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";
import {
  createClientRecord,
  updateClientRecord,
  createSupplierRecord,
  updateSupplierRecord,
  createContractorRecord,
  updateContractorRecord,
  createServiceProviderRecord,
  updateServiceProviderRecord,
} from "@/app/contacts/actions";

const STATUS_OPTIONS = [
  { value: "active", label: "ปกติ" },
  { value: "probation", label: "ทดลองงาน" },
  { value: "blacklisted", label: "บัญชีดำ" },
];

const DC_SUBTYPE_OPTIONS = [
  { value: "dc_company", label: "DC บริษัท" },
  { value: "dc_regular", label: "DC ประจำ" },
  { value: "dc_temporary", label: "DC ชั่วคราว" },
];

const CLIENT_FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อลูกค้า", type: "text", maxLength: 120 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const SUPPLIER_FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อผู้ขาย", type: "text", maxLength: 200 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "taxId", label: "เลขผู้เสียภาษี", type: "text", maxLength: 50 },
  { key: "paymentTerms", label: "เงื่อนไขการชำระเงิน", type: "text", maxLength: 200 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const CONTRACTOR_FIELDS: RecordFieldDef[] = [
  { key: "name", label: `ชื่อ${SUBCONTRACTOR_LABEL}`, type: "text", maxLength: 200 },
  { key: "status", label: "สถานะ", type: "select", options: STATUS_OPTIONS },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "taxId", label: "เลขผู้เสียภาษี", type: "text", maxLength: 50 },
  { key: "specialty", label: "งานที่รับ", type: "text", maxLength: 200 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const DC_FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อ DC", type: "text", maxLength: 200 },
  { key: "contractorSubtype", label: "ประเภท DC", type: "select", options: DC_SUBTYPE_OPTIONS },
  { key: "status", label: "สถานะ", type: "select", options: STATUS_OPTIONS },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "taxId", label: "เลขผู้เสียภาษี", type: "text", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const SERVICE_FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อผู้ให้บริการ", type: "text", maxLength: 200 },
  { key: "status", label: "สถานะ", type: "select", options: STATUS_OPTIONS },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "vehicleType", label: "ประเภทรถ", type: "text", maxLength: 100 },
  { key: "plateNo", label: "ทะเบียนรถ", type: "text", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

// Forward only the keys present in the field-record into the typed action input.
function pick<K extends string>(
  values: Record<string, string>,
  key: K,
): Record<K, string> | object {
  return values[key] !== undefined ? ({ [key]: values[key] } as Record<K, string>) : {};
}

// ── clients ──
function clientCreate(v: Record<string, string>) {
  return createClientRecord({
    name: v.name ?? "",
    ...pick(v, "contactPerson"),
    ...pick(v, "phone"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "note"),
  });
}
function clientUpdate(id: string, v: Record<string, string>) {
  return updateClientRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "contactPerson"),
    ...pick(v, "phone"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "note"),
  });
}

// ── suppliers ──
function supplierCreate(v: Record<string, string>) {
  return createSupplierRecord({
    name: v.name ?? "",
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "paymentTerms"),
    ...pick(v, "note"),
  });
}
function supplierUpdate(id: string, v: Record<string, string>) {
  return updateSupplierRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "paymentTerms"),
    ...pick(v, "note"),
  });
}

// ── contractors (category injected by the tab) ──
function contractorCreate(v: Record<string, string>) {
  return createContractorRecord({
    name: v.name ?? "",
    contractorCategory: "contractor",
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "specialty"),
    ...pick(v, "note"),
  });
}
function contractorUpdate(id: string, v: Record<string, string>) {
  return updateContractorRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "specialty"),
    ...pick(v, "note"),
  });
}

// ── DC (same contractors table, category=dc) ──
function dcCreate(v: Record<string, string>) {
  return createContractorRecord({
    name: v.name ?? "",
    contractorCategory: "dc",
    ...pick(v, "contractorSubtype"),
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "note"),
  });
}
function dcUpdate(id: string, v: Record<string, string>) {
  return updateContractorRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "contractorSubtype"),
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "taxId"),
    ...pick(v, "note"),
  });
}

// ── service providers ──
function serviceCreate(v: Record<string, string>) {
  return createServiceProviderRecord({
    name: v.name ?? "",
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "vehicleType"),
    ...pick(v, "plateNo"),
    ...pick(v, "note"),
  });
}
function serviceUpdate(id: string, v: Record<string, string>) {
  return updateServiceProviderRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "status"),
    ...pick(v, "phone"),
    ...pick(v, "contactPerson"),
    ...pick(v, "email"),
    ...pick(v, "mailingAddress"),
    ...pick(v, "vehicleType"),
    ...pick(v, "plateNo"),
    ...pick(v, "note"),
  });
}

// Status chip for contractor/dc/service rows.
function statusBadge(row: RecordRow): RecordBadge | null {
  const s = row.values.status;
  if (s === "probation") return { label: "ทดลองงาน", tone: "amber" };
  if (s === "blacklisted") return { label: "บัญชีดำ", tone: "red" };
  return null;
}

// Spec 99: the menu name is the group; the tab list comes from CONTACT_GROUP_TABS.
const TAB_LABEL: Record<ContactTab, string> = {
  clients: "ลูกค้า",
  suppliers: "ผู้ขาย",
  service: "ผู้ให้บริการ",
  contractors: SUBCONTRACTOR_LABEL,
  dc: "DC",
};

const STATUS_FILTER = [
  { value: "all", label: "ทั้งหมด" },
  { value: "active", label: "ปกติ" },
  { value: "probation", label: "ทดลองงาน" },
  { value: "blacklisted", label: "บัญชีดำ" },
] as const;

export function ContactsTabs({
  group,
  clients = [],
  suppliers = [],
  contractors = [],
  dc = [],
  serviceProviders = [],
  linkDetails = true,
  supplierBadges,
}: {
  group: ContactGroup;
  clients?: RecordRow[];
  suppliers?: RecordRow[];
  contractors?: RecordRow[];
  dc?: RecordRow[];
  serviceProviders?: RecordRow[];
  // Spec 101: when false, rows don't link to the detail page (which shows the
  // money-isolated bank block). Procurement curates suppliers inline only.
  linkDetails?: boolean;
  // Spec 107: optional per-supplier spend chip (procurement buyer intelligence).
  // A SERIALIZABLE map (supplier id → badge), NOT a function — a function prop
  // throws across the Server→Client boundary (spec 109 lesson). The rowBadge
  // closure is built here, client-side.
  supplierBadges?: Record<string, RecordBadge>;
}) {
  // Spec 99: one screen per group; a single-tab group renders no chip row.
  const tabs = CONTACT_GROUP_TABS[group];
  const [tab, setTab] = useState<ContactTab>(() => tabs[0] ?? "clients");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const hasStatus = STATUS_TABS.has(tab);
  const sourceRows =
    tab === "clients"
      ? clients
      : tab === "suppliers"
        ? suppliers
        : tab === "contractors"
          ? contractors
          : tab === "dc"
            ? dc
            : serviceProviders;

  const rows = useMemo(
    () =>
      hasStatus && statusFilter !== "all"
        ? sourceRows.filter((r) => (r.values.status ?? "active") === statusFilter)
        : sourceRows,
    [hasStatus, statusFilter, sourceRows],
  );

  return (
    <div className="flex flex-col gap-4">
      {tabs.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="ประเภทผู้ติดต่อ">
          {tabs.map((t) => (
            <RadioChip
              key={t}
              name="contact-tab"
              label={TAB_LABEL[t]}
              checked={tab === t}
              onSelect={() => setTab(t)}
            />
          ))}
        </div>
      ) : null}

      {hasStatus ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="กรองตามสถานะ">
          {STATUS_FILTER.map((s) => (
            <RadioChip
              key={s.value}
              name="contact-status-filter"
              label={s.label}
              checked={statusFilter === s.value}
              onSelect={() => setStatusFilter(s.value)}
            />
          ))}
        </div>
      ) : null}

      {tab === "clients" ? (
        <RecordManager
          addLabel="เพิ่มลูกค้า"
          fields={CLIENT_FIELDS}
          rows={rows}
          onCreate={clientCreate}
          onUpdate={clientUpdate}
          addInSheet
          rowHref={(r) => `/contacts/clients/${r.id}`}
        />
      ) : null}
      {tab === "suppliers" ? (
        <RecordManager
          addLabel="เพิ่มผู้ขาย"
          fields={SUPPLIER_FIELDS}
          rows={rows}
          onCreate={supplierCreate}
          onUpdate={supplierUpdate}
          addInSheet
          {...(linkDetails ? { rowHref: (r: RecordRow) => `/contacts/suppliers/${r.id}` } : {})}
          {...(supplierBadges ? { rowBadge: (r: RecordRow) => supplierBadges[r.id] ?? null } : {})}
        />
      ) : null}
      {tab === "contractors" ? (
        <RecordManager
          addLabel={`เพิ่ม${SUBCONTRACTOR_LABEL}`}
          fields={CONTRACTOR_FIELDS}
          rows={rows}
          onCreate={contractorCreate}
          onUpdate={contractorUpdate}
          addInSheet
          rowBadge={statusBadge}
          rowHref={(r) => `/contacts/contractors/${r.id}`}
        />
      ) : null}
      {tab === "dc" ? (
        <RecordManager
          addLabel="เพิ่ม DC"
          fields={DC_FIELDS}
          rows={rows}
          onCreate={dcCreate}
          onUpdate={dcUpdate}
          addInSheet
          rowBadge={statusBadge}
          rowHref={(r) => `/contacts/contractors/${r.id}`}
        />
      ) : null}
      {tab === "service" ? (
        <RecordManager
          addLabel="เพิ่มผู้ให้บริการ"
          fields={SERVICE_FIELDS}
          rows={rows}
          onCreate={serviceCreate}
          onUpdate={serviceUpdate}
          addInSheet
          rowBadge={statusBadge}
          rowHref={(r) => `/contacts/service-providers/${r.id}`}
        />
      ) : null}
    </div>
  );
}
