import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Spec 279 U7b — the /sa/crew roster grouped by CREW (team). Alongside the U7
// onboarding progress tracker, the SA sees the team structure the operator asked
// for (idea #1): each crew with its name + lead, its members grouped under it,
// plus a "ยังไม่ได้จัดทีม" bucket for workers not yet on a crew. VIEW-ONLY — the
// SA cannot move anyone here (crew moves are U5, PM-owned). Pure presentation;
// the crew reads it renders are RLS-scoped by the U7b read-grant.

import { CrewTeamRoster, type CrewTeamData } from "@/components/features/sa/crew-team-roster";

const EMPTY: CrewTeamData = { teams: [], unassigned: [] };

describe("CrewTeamRoster", () => {
  it("renders each crew with its name and lead", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [{ id: "c1", name: "ทีมช่างต้า", leadName: "หัวหน้าต้า", members: [] }],
          unassigned: [],
        }}
      />,
    );
    const team = screen.getByLabelText("ทีมช่างต้า");
    expect(within(team).getByText("ทีมช่างต้า")).toBeInTheDocument();
    expect(within(team).getByText(/หัวหน้าต้า/)).toBeInTheDocument();
  });

  it("groups a crew's members under that crew", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [
            {
              id: "c1",
              name: "ทีม A",
              leadName: "หัวหน้า A",
              members: [
                { id: "w1", name: "ลูกทีมหนึ่ง", level: null },
                { id: "w2", name: "ลูกทีมสอง", level: "mid" },
              ],
            },
          ],
          unassigned: [],
        }}
      />,
    );
    const team = screen.getByLabelText("ทีม A");
    expect(within(team).getByText("ลูกทีมหนึ่ง")).toBeInTheDocument();
    expect(within(team).getByText("ลูกทีมสอง")).toBeInTheDocument();
  });

  it("shows the level badge for a member who has a level", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [
            {
              id: "c1",
              name: "ทีม A",
              leadName: "หัวหน้า A",
              members: [{ id: "w2", name: "สมชาย", level: "senior" }],
            },
          ],
          unassigned: [],
        }}
      />,
    );
    expect(within(screen.getByLabelText("ทีม A")).getByText("อาวุโส")).toBeInTheDocument();
  });

  it("shows a per-crew member count", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [
            {
              id: "c1",
              name: "ทีม A",
              leadName: "หัวหน้า A",
              members: [
                { id: "w1", name: "ก", level: null },
                { id: "w2", name: "ข", level: null },
              ],
            },
          ],
          unassigned: [],
        }}
      />,
    );
    expect(within(screen.getByLabelText("ทีม A")).getByText("2")).toBeInTheDocument();
  });

  it("marks a crew with no lead assigned", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [{ id: "c1", name: "ทีมไร้หัว", leadName: null, members: [] }],
          unassigned: [],
        }}
      />,
    );
    expect(
      within(screen.getByLabelText("ทีมไร้หัว")).getByText(/ยังไม่มีหัวหน้า/),
    ).toBeInTheDocument();
  });

  it("lists workers with no crew under a ยังไม่ได้จัดทีม bucket", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [],
          unassigned: [{ id: "w9", name: "ช่างเดี่ยว", level: null }],
        }}
      />,
    );
    const bucket = screen.getByLabelText("ยังไม่ได้จัดทีม");
    expect(within(bucket).getByText("ช่างเดี่ยว")).toBeInTheDocument();
  });

  it("is view-only — renders no action buttons or links", () => {
    render(
      <CrewTeamRoster
        data={{
          teams: [
            {
              id: "c1",
              name: "ทีม A",
              leadName: "หัวหน้า A",
              members: [{ id: "w1", name: "ลูกทีม", level: "junior" }],
            },
          ],
          unassigned: [{ id: "w9", name: "ช่างเดี่ยว", level: null }],
        }}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows an empty notice when there are no teams and no unassigned workers", () => {
    render(<CrewTeamRoster data={EMPTY} />);
    expect(screen.getByText(/ยังไม่มีทีม/)).toBeInTheDocument();
  });
});
