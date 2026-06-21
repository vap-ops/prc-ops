// Writing failing test first.
//
// Spec 94: the project detail header is slimmed to code + name; its context
// metadata (client / lead / team / type / site) moves into a bottom sheet opened
// by an ⓘ chip. ProjectInfoButton owns the chip + the sheet (spec-78 BottomSheet,
// caller-owns-open-state).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectInfoButton } from "@/components/features/work-packages/project-info-button";

const PROPS = {
  clientName: "บจก. ลูกค้า ก",
  leadName: "สมชาย ผู้นำ",
  memberNames: ["สมหญิง", "สมศักดิ์"],
  typeLabel: "อาคารสำนักงาน",
  siteAddress: "123 ถนนสุขุมวิท",
  // Spec 173 U4: status + schedule dates + a Google-Maps link.
  statusLabel: "กำลังดำเนินการ",
  startDate: "2026-01-15",
  plannedCompletionDate: "2026-12-31",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=123%20%E0%B8%96%E0%B8%99%E0%B8%99",
};

describe("ProjectInfoButton", () => {
  it("renders the ⓘ trigger and keeps the metadata hidden until opened", () => {
    render(<ProjectInfoButton {...PROPS} />);
    expect(screen.getByRole("button", { name: "ข้อมูลโครงการ" })).toBeInTheDocument();
    expect(screen.queryByText("บจก. ลูกค้า ก")).not.toBeInTheDocument();
    expect(screen.queryByText("กำลังดำเนินการ")).not.toBeInTheDocument();
  });

  it("opens the sheet with every present metadata row", () => {
    render(<ProjectInfoButton {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลโครงการ" }));
    expect(screen.getByText("บจก. ลูกค้า ก")).toBeInTheDocument();
    expect(screen.getByText("สมชาย ผู้นำ")).toBeInTheDocument();
    expect(screen.getByText("สมหญิง, สมศักดิ์")).toBeInTheDocument();
    expect(screen.getByText("อาคารสำนักงาน")).toBeInTheDocument();
    expect(screen.getByText("123 ถนนสุขุมวิท")).toBeInTheDocument();
  });

  // Spec 173 U4: status (always shown), the date line, and the Google-Maps link.
  it("shows status, the schedule dates, and a Google-Maps link", () => {
    render(<ProjectInfoButton {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลโครงการ" }));
    expect(screen.getByText("กำลังดำเนินการ")).toBeInTheDocument();
    // The date row carries both endpoints (Thai-formatted) under the กำหนดการ label.
    expect(screen.getByText("กำหนดการ")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Google Maps/ });
    expect(link).toHaveAttribute("href", PROPS.mapsUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("omits the date row and the maps link when those fields are null", () => {
    render(
      <ProjectInfoButton
        {...PROPS}
        startDate={null}
        plannedCompletionDate={null}
        mapsUrl={null}
        siteAddress={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ข้อมูลโครงการ" }));
    expect(screen.getByText("กำลังดำเนินการ")).toBeInTheDocument();
    expect(screen.queryByText("กำหนดการ")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Google Maps/ })).not.toBeInTheDocument();
  });
});
