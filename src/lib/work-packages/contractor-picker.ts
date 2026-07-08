// Spec 280 P0 — pure contractor-picker scoping. A WP subcontractor picker must
// offer only real subcontractors (contractor_category = 'contractor'), never the
// day-contract (`dc`) workforce, and never a blacklisted contractor — EXCEPT the
// one currently assigned to the WP, which stays visible so an existing (possibly
// legacy dc / later-blacklisted) assignment never silently vanishes from the
// control (the ADR 0066 D8 show-current escape hatch). No I/O, no React.

import type { Database } from "@/lib/db/database.types";

type ContactStatus = Database["public"]["Enums"]["contact_status"];
type ContractorCategory = Database["public"]["Enums"]["contractor_category"];

export interface PickableContractorRow {
  id: string;
  name: string;
  phone: string | null;
  status: ContactStatus;
  contractor_category: ContractorCategory;
}

export interface ContractorOption {
  id: string;
  name: string;
  phone: string | null;
}

/**
 * Shape the full contractors list into the options offerable in a WP
 * subcontractor picker. A row is kept when it is a non-blacklisted `contractor`,
 * OR when it is the WP's currently-assigned contractor (regardless of category
 * or status). Projects each surviving row to `{ id, name, phone }`.
 */
export function pickableContractors(
  contractors: ReadonlyArray<PickableContractorRow>,
  currentContractorId: string | null,
): ContractorOption[] {
  return contractors
    .filter(
      (c) =>
        c.id === currentContractorId ||
        (c.contractor_category === "contractor" && c.status !== "blacklisted"),
    )
    .map(({ id, name, phone }) => ({ id, name, phone }));
}
