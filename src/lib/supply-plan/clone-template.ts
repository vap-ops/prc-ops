// Spec 245 U2 — pure mapping helper: a template's plan lines → the payload
// shape add_supply_plan_lines (the bulk RPC) expects. Cloned lines always land
// whole-project (workPackageId: null, D5) — WP allocation happens afterward via
// the existing multi-WP fan-out (spec 222).

export type TemplateLine = {
  catalogItemId: string;
  qty: number;
  note: string | null;
};

export type ClonePayloadLine = {
  catalogItemId: string;
  workPackageId: null;
  qty: number;
  note: string;
};

export function mapTemplateLinesToClonePayload(lines: TemplateLine[]): ClonePayloadLine[] {
  return lines.map((l) => ({
    catalogItemId: l.catalogItemId,
    workPackageId: null,
    qty: l.qty,
    note: l.note ?? "",
  }));
}
