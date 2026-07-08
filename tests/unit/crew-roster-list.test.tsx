import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// SA crew/onboarding page — the roster list: the SA's project workers by name,
// with an onboarding hint when empty (closes the loop with the QR below it).

import { CrewRosterList } from "@/components/features/sa/crew-roster-list";

describe("CrewRosterList", () => {
  it("lists the crew by name", () => {
    render(
      <CrewRosterList
        workers={[
          { id: "1", name: "สมชาย ใจดี" },
          { id: "2", name: "สายบัว" },
        ]}
      />,
    );
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("สายบัว")).toBeInTheDocument();
  });

  it("shows a project label per row when given one (multi-project SA)", () => {
    render(<CrewRosterList workers={[{ id: "1", name: "สมชาย", projectLabel: "TFM" }]} />);
    expect(screen.getByText(/TFM/)).toBeInTheDocument();
  });

  it("shows an onboarding hint when the roster is empty", () => {
    render(<CrewRosterList workers={[]} />);
    expect(screen.getByText(/ยังไม่มีช่าง/)).toBeInTheDocument();
  });

  it("marks an unconfirmed worker รอยืนยัน", () => {
    render(<CrewRosterList workers={[{ id: "1", name: "สมชาย", pending: true }]} />);
    expect(screen.getByText(/รอยืนยัน/)).toBeInTheDocument();
  });
});
