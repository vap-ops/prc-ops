// Spec 131 U1 — DC onboarding-packet completeness. Required items differ by DC
// type (individual day-labor vs company firm). Pure — derived, never stored
// (avoids drift); the PM contact page and the portal both render it. Labels are
// Thai. Insurance / house-registration are AVAILABLE document types but not
// required here (don't over-ask of a day laborer).

export type DcType = "individual" | "company";

// dc_company is a juristic firm; dc_regular / dc_temporary (and an untriaged
// null subtype) are individuals.
export function dcTypeOfSubtype(subtype: string | null): DcType {
  return subtype === "dc_company" ? "company" : "individual";
}

export interface DcPacket {
  idCard: boolean;
  bankBook: boolean;
  bank: boolean;
  consentPdpa: boolean;
  consentBackgroundCheck: boolean;
  emergencyContact: boolean;
  phone: boolean;
  companyCert: boolean;
  vatCert: boolean;
}

export interface Requirement {
  key: keyof DcPacket;
  label: string;
}

const COMMON: Requirement[] = [
  { key: "idCard", label: "บัตรประชาชน" },
  { key: "phone", label: "เบอร์โทร" },
  { key: "emergencyContact", label: "ผู้ติดต่อฉุกเฉิน" },
  { key: "bank", label: "ข้อมูลธนาคาร" },
  { key: "bankBook", label: "สำเนาสมุดบัญชี" },
  { key: "consentPdpa", label: "หนังสือยินยอม (PDPA)" },
  { key: "consentBackgroundCheck", label: "ยินยอมตรวจสอบประวัติ" },
];

// A company firm additionally provides its registration + VAT papers.
const COMPANY_EXTRA: Requirement[] = [
  { key: "companyCert", label: "หนังสือรับรองบริษัท" },
  { key: "vatCert", label: "ภ.พ.20" },
];

export function requiredFor(type: DcType): Requirement[] {
  return type === "company" ? [...COMMON, ...COMPANY_EXTRA] : COMMON;
}

export function contractorPacketStatus(
  packet: DcPacket,
  type: DcType,
): { missing: string[]; complete: boolean } {
  const missing = requiredFor(type)
    .filter((r) => !packet[r.key])
    .map((r) => r.label);
  return { missing, complete: missing.length === 0 };
}
