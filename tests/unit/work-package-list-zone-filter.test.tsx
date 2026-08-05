// Spec 392 U3a — filtering the project work-list by zone.
//
// This surface ALREADY has filters (a lens radiogroup, a search box, and an
// action-band filter inside the action lens), and the last unit that added one
// to a filtered surface shipped four blank-page bugs (spec 395 U4). So the
// tests here are deliberately about the COMBINATIONS, not about the new control
// on its own:
//
//   zone × lens        — a งาน group must survive while a child does, and the
//                        lens OPTIONS must not appear/disappear as you filter.
//   zone × search      — the hit list is the zone's rows, not the project's.
//   zone × empty       — "no งาน in this zone" is NOT "this project has no งาน",
//                        and the control that got you here must still be there
//                        to get you out. That is the completion path that
//                        stranded users in 395 U4.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkPackageList,
  type WorkPackageListItem,
} from "@/app/projects/[projectId]/work-package-list";
import {
  WP_LEAF_LABEL,
  ZONE_FILTER_ALL_LABEL,
  ZONE_LABEL,
  ZONE_UNSET_LABEL,
} from "@/lib/i18n/labels";

const PROJECT_ID = "proj-1";

const ZONES = [
  { id: "z1", code: "A", name: "พื้นลานด้านซ้าย" },
  { id: "z2", code: "B", name: "ห้องถังน้ำดี" },
];

const base = {
  deliverableId: null,
  hasContractor: true,
  priority: "normal" as const,
  priorityRank: 2,
  isCritical: false,
  categoryCode: null,
  zoneId: null,
};

// One งาน group with two children in DIFFERENT zones, plus one ungrouped leaf
// with no zone at all — the three shapes the filter has to keep straight.
const ROSTER: WorkPackageListItem[] = [
  {
    ...base,
    id: "g-1",
    code: "WP-05",
    name: "งานหลังคา",
    status: "in_progress",
    isGroup: true,
    parentId: null,
    hasContractor: false,
  },
  {
    ...base,
    id: "c-1",
    code: "WP-05-01",
    name: "งานมุงกระเบื้อง",
    status: "in_progress",
    isGroup: false,
    parentId: "g-1",
    zoneId: "z1",
  },
  {
    ...base,
    id: "c-2",
    code: "WP-05-02",
    name: "งานทาสีเชิงชาย",
    status: "in_progress",
    isGroup: false,
    parentId: "g-1",
    zoneId: "z2",
  },
  {
    ...base,
    id: "loose",
    code: "WP-09",
    name: "งานรั้ว",
    status: "in_progress",
    isGroup: false,
    parentId: null,
    zoneId: null,
  },
];

function renderList(over: Partial<Parameters<typeof WorkPackageList>[0]> = {}) {
  return render(
    <WorkPackageList
      projectId={PROJECT_ID}
      role="site_admin"
      workPackages={ROSTER}
      deliverables={[]}
      zones={ZONES}
      {...over}
    />,
  );
}

const zoneFilter = () => screen.getByRole("radiogroup", { name: /โซน/ });
const pickZone = (name: string | RegExp) =>
  fireEvent.click(within(zoneFilter()).getByRole("radio", { name }));

describe("WorkPackageList — zone filter", () => {
  it("does not render the control at all when the project has no zones", () => {
    // project_zones is 0 rows on every project today; an empty filter row would
    // cost every reader space to offer nothing.
    renderList({ zones: [] });
    expect(screen.queryByRole("radiogroup", { name: /โซน/ })).toBeNull();
  });

  it("shows every งาน until a zone is chosen", () => {
    renderList();
    expect(screen.getByText("งานมุงกระเบื้อง")).toBeInTheDocument();
    expect(screen.getByText("งานทาสีเชิงชาย")).toBeInTheDocument();
    expect(screen.getByText("งานรั้ว")).toBeInTheDocument();
  });

  it("narrows the list to the chosen zone", () => {
    renderList();
    pickZone(/พื้นลานด้านซ้าย/);
    expect(screen.getByText("งานมุงกระเบื้อง")).toBeInTheDocument();
    expect(screen.queryByText("งานทาสีเชิงชาย")).toBeNull();
    expect(screen.queryByText("งานรั้ว")).toBeNull();
  });

  it("selects the งาน nobody has placed yet — the fill rate is about this bucket", () => {
    renderList();
    pickZone(ZONE_UNSET_LABEL);
    expect(screen.getByText("งานรั้ว")).toBeInTheDocument();
    expect(screen.queryByText("งานมุงกระเบื้อง")).toBeNull();
  });

  it("restores the whole list when the ALL chip is chosen again", () => {
    renderList();
    pickZone(/พื้นลานด้านซ้าย/);
    pickZone(ZONE_FILTER_ALL_LABEL);
    expect(screen.getByText("งานทาสีเชิงชาย")).toBeInTheDocument();
    expect(screen.getByText("งานรั้ว")).toBeInTheDocument();
  });

  // ---- combinations --------------------------------------------------

  it("keeps a งาน section alive while one of its children is in the zone (งาน lens)", () => {
    renderList({ role: "project_manager" });
    pickZone(/ห้องถังน้ำดี/);
    // The group heads the section; only the matching child is inside it.
    expect(screen.getByText("งานหลังคา")).toBeInTheDocument();
    expect(screen.queryByText("งานมุงกระเบื้อง")).toBeNull();
  });

  it("keeps the SAME lens options while a zone is filtered", () => {
    // The งาน lens exists because the PROJECT adopted the hierarchy, not
    // because the current filter happens to leave a group behind. If the option
    // vanished under a filter the selected lens would have no control.
    renderList({ role: "project_manager" });
    const before = screen
      .getAllByRole("radio")
      .map((el) => el.textContent)
      .filter((t) => t?.includes("ตาม"));
    pickZone(ZONE_UNSET_LABEL);
    const after = screen
      .getAllByRole("radio")
      .map((el) => el.textContent)
      .filter((t) => t?.includes("ตาม"));
    expect(after).toEqual(before);
  });

  it("searches inside the chosen zone, not across the project", () => {
    renderList();
    pickZone(/พื้นลานด้านซ้าย/);
    fireEvent.change(screen.getByRole("textbox", { name: /ค้นหา/ }), {
      target: { value: "งาน" },
    });
    expect(screen.getByText("งานมุงกระเบื้อง")).toBeInTheDocument();
    expect(screen.queryByText("งานทาสีเชิงชาย")).toBeNull();
    expect(screen.queryByText("งานรั้ว")).toBeNull();
  });

  const withEmptyZone = () =>
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={ROSTER}
        deliverables={[]}
        zones={[...ZONES, { id: "z3", code: "C", name: "บ่อบำบัด" }]}
      />,
    );

  it("says the ZONE is empty, not the project — and keeps the way out", () => {
    withEmptyZone();
    pickZone(/บ่อบำบัด/);
    // The SENTENCE, not merely the absence of the project-level one: asserting
    // only that "ยังไม่มีรายการงาน" is gone passes with the whole branch deleted,
    // because the action lens renders its band chips over an empty roster and
    // names nothing. That is the fake-coverage class, one layer over.
    expect(screen.getByText(`ไม่มี${WP_LEAF_LABEL}ใน${ZONE_LABEL}นี้`)).toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีรายการงาน")).toBeNull();
    // The control that produced the empty state must still be on screen, or the
    // reader is stranded with no way back to the full list.
    expect(within(zoneFilter()).getByRole("radio", { name: ZONE_FILTER_ALL_LABEL })).toBeVisible();
  });

  it("blames the ZONE, not the query, when a search runs inside an empty zone", () => {
    // Otherwise the reader is told "nothing matches your search" about an
    // emptiness the zone caused — and clearing the query flips the message,
    // which is the tell that the first one was wrong.
    withEmptyZone();
    pickZone(/บ่อบำบัด/);
    fireEvent.change(screen.getByRole("textbox", { name: /ค้นหา/ }), { target: { value: "งาน" } });
    expect(screen.getByText(`ไม่มี${WP_LEAF_LABEL}ใน${ZONE_LABEL}นี้`)).toBeInTheDocument();
    expect(screen.queryByText(`ไม่พบ${WP_LEAF_LABEL}ที่ตรงกับคำค้น`)).toBeNull();
  });

  it("tells a reader whose unzoned bucket is empty that everything is PLACED", () => {
    // `ยังไม่ระบุโซน` is not a zone, so "there is no งานย่อย in this zone" states
    // the wrong fact about the wrong thing — and hides the one fact they were
    // checking for (spec 392 §8's fill rate is exactly this bucket reaching 0).
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={ROSTER.filter((wp) => wp.id !== "loose")}
        deliverables={[]}
        zones={ZONES}
      />,
    );
    pickZone(ZONE_UNSET_LABEL);
    expect(screen.getByText(`${WP_LEAF_LABEL}ทุกรายการระบุ${ZONE_LABEL}แล้ว`)).toBeInTheDocument();
  });

  it("still reports a genuinely empty project as empty", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={[]}
        deliverables={[]}
        zones={ZONES}
      />,
    );
    expect(screen.getByText("ยังไม่มีรายการงาน")).toBeInTheDocument();
  });
});
