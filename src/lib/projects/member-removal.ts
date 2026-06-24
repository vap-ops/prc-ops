// Spec 192 U1 — pure decision for removing a project team member. Project
// visibility is membership-gated (can_see_project = a project_members row OR the
// project_lead, ADR 0056), so the project must never drop to zero members (it
// would become invisible to everyone but super_admin). Removing yourself while
// others remain is allowed but surprising — flagged for a confirm. Pure so both
// the server guard (load-bearing) and the UI consume the same rule.

export interface MemberRemovalEval {
  blocked: boolean;
  reason?: "LAST_MEMBER";
  needsConfirm: boolean;
}

export function evaluateMemberRemoval(input: {
  totalMembers: number;
  removingSelf: boolean;
}): MemberRemovalEval {
  if (input.totalMembers <= 1) {
    return { blocked: true, reason: "LAST_MEMBER", needsConfirm: false };
  }
  return { blocked: false, needsConfirm: input.removingSelf };
}
