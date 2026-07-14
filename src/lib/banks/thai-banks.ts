// Spec 317 U7 — the Thai-bank SSOT behind every ชื่อธนาคาร picker (operator
// 2026-07-14: selection not free text, sorted by usage frequency, with icons).
//
// One canonical short name per bank keeps stored bank_name values consistent
// across workers.bank_*, contact_bank and staff_registration_bank — free text
// had already produced "กสิกร" vs "ธ.กสิกรไทย" style drift. The monogram
// (shortName on the brand color) stands in for a logo: self-contained, no
// trademark image assets, works offline/CSP-safe. Static order = Thai retail
// market share; live ordering comes from sortBanksByUsage over the
// bank_name_usage() aggregate.
//
// Pure module — importable from client components and tests alike.

export interface ThaiBank {
  /** Stable id (latin, for keys/tests). */
  id: string;
  /** Canonical stored value for bank_name columns. */
  name: string;
  /** Monogram text on the color chip (≤4 chars). */
  shortName: string;
  /** Brand color (bank identity — deliberate literal, like work-category colors). */
  color: string;
}

export const THAI_BANKS: readonly ThaiBank[] = [
  { id: "kbank", name: "กสิกรไทย", shortName: "K", color: "#138f2d" },
  { id: "scb", name: "ไทยพาณิชย์", shortName: "SCB", color: "#4e2e7f" },
  { id: "bbl", name: "กรุงเทพ", shortName: "BBL", color: "#1e4598" },
  { id: "ktb", name: "กรุงไทย", shortName: "KTB", color: "#1ba5e1" },
  { id: "bay", name: "กรุงศรีอยุธยา", shortName: "BAY", color: "#fec43b" },
  { id: "ttb", name: "ทหารไทยธนชาต", shortName: "ttb", color: "#0050f0" },
  { id: "gsb", name: "ออมสิน", shortName: "GSB", color: "#eb198d" },
  { id: "baac", name: "ธ.ก.ส.", shortName: "ธกส", color: "#4b9b1d" },
  { id: "ghb", name: "อาคารสงเคราะห์", shortName: "ธอส", color: "#f57d23" },
  { id: "kkp", name: "เกียรตินาคินภัทร", shortName: "KKP", color: "#635f98" },
  { id: "cimbt", name: "ซีไอเอ็มบี ไทย", shortName: "CIMB", color: "#7e2f36" },
  { id: "uobt", name: "ยูโอบี", shortName: "UOB", color: "#0b3979" },
  { id: "lhb", name: "แลนด์ แอนด์ เฮ้าส์", shortName: "LH", color: "#6d6e71" },
  { id: "tisco", name: "ทิสโก้", shortName: "TSC", color: "#12549f" },
];

const STATIC_RANK = new Map(THAI_BANKS.map((b, i) => [b.name, i]));

/** Live order: usage count desc, ties broken by the static market-share rank. */
export function sortBanksByUsage(usage: ReadonlyMap<string, number>): ThaiBank[] {
  return [...THAI_BANKS].sort((a, b) => {
    const ua = usage.get(a.name) ?? 0;
    const ub = usage.get(b.name) ?? 0;
    if (ua !== ub) return ub - ua;
    return (STATIC_RANK.get(a.name) ?? 0) - (STATIC_RANK.get(b.name) ?? 0);
  });
}

export function findBankByName(name: string): ThaiBank | null {
  return THAI_BANKS.find((b) => b.name === name) ?? null;
}
