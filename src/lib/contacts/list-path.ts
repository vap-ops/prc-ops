// Back-nav sweep 2026-07-11: the one mapping from a contact detail's [type]
// route segment to the LIST PAGE that owns it. The detail page's back chip
// fell back to the hardcoded "/contacts" redirect stub (→ /contacts/customers),
// so suppliers / service-providers / contractors backed out to the wrong list.
// Used as the safeBackHref fallback on /contacts/[type]/[id] and as the
// withBackFrom source on the list rows (contacts-tabs).

const LIST_PATH: Record<string, string> = {
  clients: "/contacts/customers",
  suppliers: "/contacts/vendors",
  "service-providers": "/contacts/vendors",
  contractors: "/contacts/subcontractors",
};

/** List page owning a contact type; unknown types keep the old /contacts stub. */
export function contactListPath(type: string): string {
  return LIST_PATH[type] ?? "/contacts";
}
