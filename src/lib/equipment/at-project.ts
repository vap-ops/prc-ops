// Spec 368 U1 — the set of equipment currently at a project's site/store.
//
// Reuses the existing append-only movement log rather than introducing a new
// location field: `currentEquipmentLocation` already derives "latest movement
// wins", and the DB CHECK guarantees `(project_id IS NOT NULL) = (kind =
// 'deployed')`, so a project-bound location can only ever be a deployment.
//
// WHY NOT STOCK ROWS: the operator's tools are meant to live in the project
// store, but store stock is per-project and the schema has **no
// project-to-project transfer** — every stock routine was enumerated
// (`record_stock_in`, `issue_stock`, `return_stock_to_store`,
// `reverse_stock_receipt`, `record_stock_count`, …) and none moves stock between
// projects. With โพธิ์ทอง closing and everything moving to a new site, stock-shaped
// tools would have to be reversed out and re-received to move — fabricating
// ledger and GL events for something that is neither a purchase nor a disposal.
// A movement is the honest representation, and the site move is one more of them.

import { currentEquipmentLocation, type EquipmentMovementRecord } from "./current-location";

/** Item ids whose CURRENT location is a deployment to `projectId`. */
export function equipmentAtProject(
  movements: EquipmentMovementRecord[],
  projectId: string,
): Set<string> {
  const at = new Set<string>();
  for (const [itemId, loc] of currentEquipmentLocation(movements)) {
    if (loc.kind === "deployed" && loc.projectId === projectId) at.add(itemId);
  }
  return at;
}
