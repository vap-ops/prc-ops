// Spec 261 / ADR 0070 item 4 — the blacklist boundary is a manager-tier gate.
//
// Flipping a contact's status INTO or OUT OF `blacklisted` (blacklist /
// unblacklist) is reserved for the manager set (PM tier + procurement_manager).
// Ordinary status moves (active ↔ probation) and every other field edit stay
// open to the back-office set, incl. plain procurement. This pure predicate is
// the testable seam the server action gates on (contacts/actions.ts).

import type { Database } from "@/lib/db/database.types";

type ContactStatus = Database["public"]["Enums"]["contact_status"];

/**
 * True when a status change crosses the blacklist boundary — i.e. exactly one of
 * (current, next) is `blacklisted`. Entering blacklist and leaving it (unblacklist)
 * both count; a no-op (blacklisted→blacklisted) and non-blacklist moves do not.
 * `current` is null/undefined for a brand-new contact (create-as-blacklisted still
 * counts as entering the boundary).
 */
export function crossesBlacklistBoundary(
  current: ContactStatus | null | undefined,
  next: ContactStatus,
): boolean {
  return (current === "blacklisted") !== (next === "blacklisted");
}
