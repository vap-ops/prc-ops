// Spec 99 — Contacts split into three groups (operator: "ติดต่อ is packed").
// The pure tab-map: ContactsTabs renders from it and the group pages fetch per
// group. Clients are office orgs (no status). Contractors/service — and, since
// spec 275 U0 gave suppliers a contact_status, suppliers too (spec 280 P2) —
// carry status/blacklist; STATUS_TABS marks them.

// Spec 101: "suppliers" is a procurement-only subset of the vendors group —
// procurement curates suppliers but cannot read service providers.
// Spec 168: the crews group split into separate subcontractors + dc pages.
// ADR 0062 U5: a DC is a WORKER (no DC firm) managed under ทีมงาน (/workers), so
// the /contacts/dc party group is removed — contractors are ONLY ผู้รับเหมาช่วง now.
export type ContactGroup = "customers" | "vendors" | "subcontractors" | "suppliers";

export type ContactTab = "clients" | "suppliers" | "service" | "contractors";

// Group → its ordered tabs. A single-tab group renders no chip row.
export const CONTACT_GROUP_TABS: Record<ContactGroup, readonly ContactTab[]> = {
  customers: ["clients"],
  vendors: ["suppliers", "service"],
  // Spec 168: one type per group → each is its own page, no tab hop.
  subcontractors: ["contractors"],
  // Procurement's suppliers-only view (spec 101) — overlaps vendors' suppliers
  // tab; service providers stay PM-only.
  suppliers: ["suppliers"],
};

// The tabs that carry a status (active/probation/blacklist) and thus the status
// sub-filter. Clients stay a plain business org.
export const STATUS_TABS: ReadonlySet<ContactTab> = new Set<ContactTab>([
  "contractors",
  "service",
  "suppliers",
]);
