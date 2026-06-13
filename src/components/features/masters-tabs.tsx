"use client";

// Spec 81 — the /pm/masters segmented-control shell. Holds the active master
// (RadioChip group) and renders one generic MasterManager for it, binding that
// entity's field schema + the field-record → typed-action mappers. Rows for all
// three masters are fetched server-side and passed in as props.
//
// 'use client' justification: the tab state + binding the injected actions.

import { useState } from "react";
import { RadioChip } from "@/components/features/radio-chip";
import {
  MasterManager,
  type MasterFieldDef,
  type MasterRow,
} from "@/components/features/master-manager";
import {
  createClientRecord,
  updateClientRecord,
  createSupplierRecord,
  updateSupplierRecord,
  createContractorRecord,
  updateContractorRecord,
} from "@/app/pm/masters/actions";

const CLIENT_FIELDS: MasterFieldDef[] = [
  { key: "name", label: "ชื่อลูกค้า", type: "text", maxLength: 120 },
  { key: "contactPerson", label: "ผู้ติดต่อ", type: "text", maxLength: 120 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "email", label: "อีเมล", type: "email", maxLength: 200 },
  { key: "mailingAddress", label: "ที่อยู่", type: "textarea", maxLength: 500 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const SUPPLIER_FIELDS: MasterFieldDef[] = [
  { key: "name", label: "ชื่อผู้ขาย", type: "text", maxLength: 200 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const CONTRACTOR_FIELDS: MasterFieldDef[] = [
  { key: "name", label: "ชื่อผู้รับเหมา", type: "text", maxLength: 200 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

// Map a generic field-record (keyed by MasterFieldDef.key) into a typed action
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

export function MastersTabs({
  clients,
  suppliers,
  contractors,
}: {
  clients: MasterRow[];
  suppliers: MasterRow[];
  contractors: MasterRow[];
}) {
  const [tab, setTab] = useState<Tab>("clients");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="ประเภทข้อมูลหลัก">
        {TABS.map((t) => (
          <RadioChip
            key={t.value}
            name="master-tab"
            label={t.label}
            checked={tab === t.value}
            onSelect={() => setTab(t.value)}
          />
        ))}
      </div>
      {tab === "clients" ? (
        <MasterManager
          addLabel="เพิ่มลูกค้า"
          fields={CLIENT_FIELDS}
          rows={clients}
          onCreate={clientCreate}
          onUpdate={clientUpdate}
        />
      ) : null}
      {tab === "suppliers" ? (
        <MasterManager
          addLabel="เพิ่มผู้ขาย"
          fields={SUPPLIER_FIELDS}
          rows={suppliers}
          onCreate={supplierCreate}
          onUpdate={supplierUpdate}
        />
      ) : null}
      {tab === "contractors" ? (
        <MasterManager
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
