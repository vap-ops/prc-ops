// Feedback bc6df601 — the single guard against leaking a raw id/UUID into the UI.
//
// Screen code resolves a display name from an id via a lookup that can miss —
// the row is RLS-hidden from the current role, the name is null, or the id is
// stale. The old shape `map.get(id) ?? id` then rendered the raw UUID as if it
// were the name (a procurement user saw "2aba1b52-73ec-…" where a client name
// belonged). displayName() collapses every such site onto one neutral fallback,
// so an unresolved lookup shows a human label and NEVER the id.
//
// Use `displayName(lookup.get(id))` in place of `lookup.get(id) ?? id`.

import { UNKNOWN_NAME_LABEL } from "@/lib/i18n/labels";

/** The resolved name, trimmed — or {@link UNKNOWN_NAME_LABEL} when absent/blank.
 *  Never returns the caller's id. */
export function displayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed === "" ? UNKNOWN_NAME_LABEL : trimmed;
}
