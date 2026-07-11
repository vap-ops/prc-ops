import { describe, expect, it } from "vitest";
import { projectPmRecipients } from "@/lib/notifications/site-issue-recipients";
import type { UserRole } from "@/lib/db/enums";

const LEAD = "aaaaaaaa-0000-4000-8000-000000000001";
const PM_MEMBER = "aaaaaaaa-0000-4000-8000-000000000002";
const SA_MEMBER = "bbbbbbbb-0000-4000-8000-000000000001";
const DIRECTOR = "dddddddd-0000-4000-8000-000000000001";

const roles = (entries: ReadonlyArray<[string, UserRole]>): Map<string, UserRole> =>
  new Map(entries);

describe("projectPmRecipients (spec 277 P1a — the issue's project PMs)", () => {
  it("includes a PM-tier project member", () => {
    expect(
      projectPmRecipients({
        leadId: null,
        memberIds: [PM_MEMBER],
        roleById: roles([[PM_MEMBER, "project_manager"]]),
      }),
    ).toEqual([PM_MEMBER]);
  });

  it("includes the project lead when the lead is PM-tier, even with no PM members (lead-only)", () => {
    expect(
      projectPmRecipients({
        leadId: LEAD,
        memberIds: [SA_MEMBER],
        roleById: roles([
          [LEAD, "project_manager"],
          [SA_MEMBER, "site_admin"],
        ]),
      }),
    ).toEqual([LEAD]);
  });

  it("includes a project_director lead (PD is PM-tier)", () => {
    expect(
      projectPmRecipients({
        leadId: LEAD,
        memberIds: [],
        roleById: roles([[LEAD, "project_director"]]),
      }),
    ).toEqual([LEAD]);
  });

  it("filters out non-PM members (a site_admin on the team is not a project PM)", () => {
    expect(
      projectPmRecipients({
        leadId: null,
        memberIds: [PM_MEMBER, SA_MEMBER],
        roleById: roles([
          [PM_MEMBER, "project_manager"],
          [SA_MEMBER, "site_admin"],
        ]),
      }),
    ).toEqual([PM_MEMBER]);
  });

  it("returns no project PM when the lead is non-PM and there are no PM members (zero-PM)", () => {
    expect(
      projectPmRecipients({
        leadId: LEAD,
        memberIds: [SA_MEMBER],
        roleById: roles([
          [LEAD, "site_admin"],
          [SA_MEMBER, "site_admin"],
        ]),
      }),
    ).toEqual([]);
  });

  it("dedupes a lead who is also listed as a member", () => {
    expect(
      projectPmRecipients({
        leadId: LEAD,
        memberIds: [LEAD, PM_MEMBER],
        roleById: roles([
          [LEAD, "project_manager"],
          [PM_MEMBER, "project_manager"],
        ]),
      }),
    ).toEqual([LEAD, PM_MEMBER]);
  });

  it("ignores an unknown lead id absent from the role map", () => {
    expect(
      projectPmRecipients({
        leadId: DIRECTOR,
        memberIds: [],
        roleById: roles([]),
      }),
    ).toEqual([]);
  });
});
