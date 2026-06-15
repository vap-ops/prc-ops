// Spec 99 — Contacts split into three groups (operator: "ติดต่อ is packed").
// The pure tab-map: ContactsTabs renders from it and the group pages fetch per
// group. Clients+suppliers are office orgs (no status); contractors/dc/service
// are rated field crews (status/blacklist) — STATUS_TABS marks the latter.

// Spec 101: "suppliers" is a procurement-only subset of the vendors group —
// procurement curates suppliers but cannot read service providers.
export type ContactGroup = "customers" | "vendors" | "crews" | "suppliers";

export type ContactTab = "clients" | "suppliers" | "service" | "contractors" | "dc";

// Group → its ordered tabs. A single-tab group renders no chip row.
export const CONTACT_GROUP_TABS: Record<ContactGroup, readonly ContactTab[]> = {
  customers: ["clients"],
  vendors: ["suppliers", "service"],
  crews: ["contractors", "dc"],
  // Procurement's suppliers-only view (spec 101) — overlaps vendors' suppliers
  // tab; service providers stay PM-only.
  suppliers: ["suppliers"],
};

// The tabs that carry a status (active/probation/blacklist) and thus the status
// sub-filter. The others (clients, suppliers) are plain business orgs.
export const STATUS_TABS: ReadonlySet<ContactTab> = new Set<ContactTab>([
  "contractors",
  "dc",
  "service",
]);
