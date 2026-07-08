// Spec 282 U2 (approach A) — the SA site team board view. Total on-site headcount +
// team-nature buckets (ทีมภายใน / ทีมภายนอก / ฝ่ายไซต์ / ยังไม่ได้จัดทีม); crew cards
// collapse (glance = name + lead + count + งาน; tap → members with level +
// cross-charge exception badges). VIEW-ONLY. RED-first.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SiteTeamBoard } from "@/components/features/sa/site-team-board";
import type { SiteTeamBoard as SiteTeamBoardData } from "@/lib/sa/site-team-board";

const BOARD: SiteTeamBoardData = {
  total: 5,
  internal: [
    {
      id: "C1",
      name: "ทีมเอ",
      leadName: "หัวหน้าเอ",
      members: [
        { id: "w1", name: "ช่างหนึ่ง", level: null },
        { id: "w2", name: "ช่างสอง", level: null, exception: "subcon_internal" },
      ],
      workPackages: [{ id: "wp1", code: "P-1", name: "งานหนึ่ง", categoryCode: "W01" }],
    },
  ],
  external: [
    {
      id: "C2",
      name: "ทีมรับเหมา",
      leadName: null,
      members: [{ id: "w3", name: "ช่างสาม", level: null, exception: "our_tech_external" }],
    },
  ],
  siteAccess: [{ userId: "u1", name: "เอสเอ ประจำไซต์" }],
  unassigned: [{ id: "w9", name: "ช่างลอย", level: null }],
};

describe("SiteTeamBoard", () => {
  it("shows the total on-site headcount", () => {
    render(<SiteTeamBoard board={BOARD} />);
    expect(screen.getByText(/คนหน้างาน/)).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders the four buckets with their headings", () => {
    render(<SiteTeamBoard board={BOARD} />);
    expect(screen.getByText("ทีมภายใน")).toBeInTheDocument();
    expect(screen.getByText("ทีมภายนอก")).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายไซต์")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่ได้จัดทีม")).toBeInTheDocument();
  });

  it("collapses a crew card by default — name + lead + งาน show, members hidden", () => {
    render(<SiteTeamBoard board={BOARD} />);
    expect(screen.getByText("ทีมเอ")).toBeInTheDocument();
    expect(screen.getByText(/หัวหน้าเอ/)).toBeInTheDocument();
    expect(screen.getByText("งานหนึ่ง")).toBeInTheDocument();
    // members are behind the collapse
    expect(screen.queryByText("ช่างหนึ่ง")).not.toBeInTheDocument();
  });

  it("expands a crew card on tap to reveal members with the cross-charge badge", () => {
    render(<SiteTeamBoard board={BOARD} />);
    fireEvent.click(screen.getByRole("button", { name: /ทีมเอ/ }));
    expect(screen.getByText("ช่างหนึ่ง")).toBeInTheDocument();
    expect(screen.getByText("ช่างสอง")).toBeInTheDocument();
    // w2 is a subcontractor's worker on our internal team.
    expect(screen.getByText("ช่างนอกในทีมเรา")).toBeInTheDocument();
  });

  it("flags our tech placed on an external team", () => {
    render(<SiteTeamBoard board={BOARD} />);
    fireEvent.click(screen.getByRole("button", { name: /ทีมรับเหมา/ }));
    expect(screen.getByText("ช่างเราในทีมนอก")).toBeInTheDocument();
  });

  it("lists the ฝ่ายไซต์ members and the loose workers", () => {
    render(<SiteTeamBoard board={BOARD} />);
    expect(screen.getByText("เอสเอ ประจำไซต์")).toBeInTheDocument();
    expect(screen.getByText("ช่างลอย")).toBeInTheDocument();
  });

  it("shows an empty notice when nobody is on site", () => {
    render(
      <SiteTeamBoard
        board={{ total: 0, internal: [], external: [], siteAccess: [], unassigned: [] }}
      />,
    );
    expect(screen.getByText(/ยังไม่มี/)).toBeInTheDocument();
  });
});
