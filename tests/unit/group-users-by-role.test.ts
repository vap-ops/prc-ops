// Feedback d00c3d0e — "the list is getting longer, we should find a way to
// organize better." The role-admin list groups by ROLE: visitors first (the
// promotion queue — the screen's common task), then internal roles in tier
// order, external audiences last. Pure helper; the page renders one section
// per non-empty group.
import { describe, expect, it } from "vitest";

import { groupUsersByRole, ROLE_GROUP_ORDER } from "@/lib/roles/group-users";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

const u = (name: string, role: UserRole) => ({ id: `id-${name}`, name, role, isSelf: false });

describe("groupUsersByRole (feedback d00c3d0e)", () => {
  it("orders groups: visitor first, internal tiers, external last — empty groups omitted", () => {
    const groups = groupUsersByRole([
      u("คนงาน", "contractor"),
      u("บอส", "super_admin"),
      u("ใหม่", "visitor"),
      u("บัญชี", "accounting"),
    ]);
    expect(groups.map((g) => g.role)).toEqual([
      "visitor",
      "super_admin",
      "accounting",
      "contractor",
    ]);
  });

  it("covers every user exactly once and sorts names Thai-aware within a group", () => {
    const users = [u("ข", "site_admin"), u("ก", "site_admin"), u("ค", "visitor")];
    const groups = groupUsersByRole(users);
    expect(groups.flatMap((g) => g.users)).toHaveLength(users.length);
    const sa = groups.find((g) => g.role === "site_admin");
    expect(sa?.users.map((x) => x.name)).toEqual(["ก", "ข"]);
  });

  it("labels each group with the role label and count-ready users array", () => {
    const groups = groupUsersByRole([u("ใหม่", "visitor"), u("ใหม่2", "visitor")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe(USER_ROLE_LABEL.visitor);
    expect(groups[0]?.users).toHaveLength(2);
  });

  it("the canonical order covers every user_role exactly once (a new enum value fails here)", () => {
    const known = Object.keys(USER_ROLE_LABEL).sort();
    expect([...ROLE_GROUP_ORDER].sort()).toEqual(known);
    expect(new Set(ROLE_GROUP_ORDER).size).toBe(ROLE_GROUP_ORDER.length);
  });
});
