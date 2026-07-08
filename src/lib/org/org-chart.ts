// Spec 284 U2 / ADR 0080 — pure builder for the org-chart read surface.
// Departments are OPEN, non-gating org data (U0); each login sits in one primary
// department via users.department_id, and a dept's head is a field (head_user_id).
// This groups users under their active department, resolves the head, and orders
// by sort_order. Read-only: no assignment here (that's set_user_department /
// set_department_head, super_admin RPCs).

export type OrgChartDeptInput = {
  id: string;
  key: string;
  name_th: string;
  is_active: boolean;
  head_user_id: string | null;
  sort_order: number;
};

export type OrgChartUserInput = {
  id: string;
  full_name: string | null;
  department_id: string | null;
};

export type OrgChartPerson = { id: string; name: string };

export type OrgChartDept = {
  key: string;
  nameTh: string;
  head?: OrgChartPerson;
  members: OrgChartPerson[];
};

const nameFor = (full: string | null): string => full?.trim() || "(ไม่มีชื่อ)";

export function buildOrgChart(
  departments: readonly OrgChartDeptInput[],
  users: readonly OrgChartUserInput[],
): OrgChartDept[] {
  return [...departments]
    .filter((d) => d.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => {
      const members: OrgChartPerson[] = users
        .filter((u) => u.department_id === d.id)
        .map((u) => ({ id: u.id, name: nameFor(u.full_name) }));
      const headUser = d.head_user_id ? users.find((u) => u.id === d.head_user_id) : undefined;
      return {
        key: d.key,
        nameTh: d.name_th,
        // exactOptionalPropertyTypes: only set `head` when there is one.
        ...(headUser ? { head: { id: headUser.id, name: nameFor(headUser.full_name) } } : {}),
        members,
      };
    });
}
