// Spec 262 U2 register drill — the /requests/reports/register page's
// ?dim=/?key=/?unassigned= parse, extracted pure so the uuid guard is
// unit-testable. key="" (or unassigned=1) means the report's unassigned/
// is-null bucket and passes through; loadPurchaseRegister applies the keys
// as uuid-typed DB predicates.

import { isValidUuid } from "@/lib/validate/uuid";

import type { RegisterDimensionFilter } from "@/lib/accounting/load-purchases";

export interface RegisterSliceQuery {
  projectId?: string;
  slice?: RegisterDimensionFilter;
}

export function parseRegisterSlice(sp: {
  dim?: string;
  key?: string;
  unassigned?: string;
}): RegisterSliceQuery {
  const unassigned = sp.unassigned === "1";
  const key = unassigned ? "" : (sp.key ?? "");
  // A non-UUID non-empty key (hand-typed URL) means no filter — raw garbage
  // would 22P02 the uuid-typed predicates and 500 the page (the /expenses
  // spec-323-U4 posture; app-built drill links only carry DB group keys).
  if (key !== "" && !isValidUuid(key)) {
    return {};
  }
  if (sp.dim === "project") {
    return key ? { projectId: key } : {};
  }
  if (sp.dim === "supplier" || sp.dim === "category" || sp.dim === "purchaser") {
    return { slice: { dimension: sp.dim, key } };
  }
  return {};
}
