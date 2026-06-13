"use client";

// Spec 81 — the /pm/contacts segmented-control shell. Holds the active contact
// type (RadioChip group) and renders one generic RecordManager for it, binding
// that entity's field schema + the field-record → typed-action mappers. Rows for
// all three contact types are fetched server-side and passed in as props.
//
// 'use client' justification: the tab state + binding the injected actions.

import { useState } from "react";
import { RadioChip } from "@/components/features/radio-chip";
import {
  RecordManager,
  type RecordFieldDef,
  type RecordRow,
} from "@/components/features/record-manager";
import {
  createClientRecord,
  updateClientRecord,
  createSupplierRecord,
  updateSupplierRecord,
  createContractorRecord,
  updateContractorRecord,
} from "@/app/pm/contacts/actions";

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
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const CONTRACTOR_FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อผู้รับเหมา", type: "text", maxLength: 200 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

// Map a generic field-record (keyed by RecordFieldDef.key) into a typed action
// input. Only keys present in the record are forwarded — on update that means
// only changed fields; on create the record carries every field.
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
  return createSupplierRecord({ name: v.name ?? "", ...pick(v, "phone"), ...pick(v, "note") });
}
function supplierUpdate(id: string, v: Record<string, string>) {
  return updateSupplierRecord({ id, ...pick(v, "name"), ...pick(v, "phone"), ...pick(v, "note") });
}

// ── contractors ──
function contractorCreate(v: Record<string, string>) {
  return createContractorRecord({ name: v.name ?? "", ...pick(v, "phone"), ...pick(v, "note") });
}
function contractorUpdate(id: string, v: Record<string, string>) {
  return updateContractorRecord({
    id,
    ...pick(v, "name"),
    ...pick(v, "phone"),
    ...pick(v, "note"),
  });
}

type Tab = "clients" | "suppliers" | "contractors";

const TABS = [
  { value: "clients", label: "ลูกค้า" },
  { value: "suppliers", label: "ผู้ขาย" },
  { value: "contractors", label: "ผู้รับเหมา" },
] as const;

export function ContactsTabs({
  clients,
  suppliers,
  contractors,
}: {
  clients: RecordRow[];
  suppliers: RecordRow[];
  contractors: RecordRow[];
}) {
  const [tab, setTab] = useState<Tab>("clients");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="ประเภทผู้ติดต่อ">
        {TABS.map((t) => (
          <RadioChip
            key={t.value}
            name="contact-tab"
            label={t.label}
            checked={tab === t.value}
            onSelect={() => setTab(t.value)}
          />
        ))}
      </div>
      {tab === "clients" ? (
        <RecordManager
          addLabel="เพิ่มลูกค้า"
          fields={CLIENT_FIELDS}
          rows={clients}
          onCreate={clientCreate}
          onUpdate={clientUpdate}
        />
      ) : null}
      {tab === "suppliers" ? (
        <RecordManager
          addLabel="เพิ่มผู้ขาย"
          fields={SUPPLIER_FIELDS}
          rows={suppliers}
          onCreate={supplierCreate}
          onUpdate={supplierUpdate}
        />
      ) : null}
      {tab === "contractors" ? (
        <RecordManager
          addLabel="เพิ่มผู้รับเหมา"
          fields={CONTRACTOR_FIELDS}
          rows={contractors}
          onCreate={contractorCreate}
          onUpdate={contractorUpdate}
        />
      ) : null}
    </div>
  );
}
