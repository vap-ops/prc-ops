// Writing failing test first.
//
// Spec 94: the project detail header is slimmed to code + name; its context
// metadata (client / lead / team / type / site) moves into a bottom sheet opened
// by an ⓘ chip. ProjectInfoButton owns the chip + the sheet (spec-78 BottomSheet,
// caller-owns-open-state).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProjectInfoButton } from "@/components/features/project-info-button";

const PROPS = {
  clientName: "บจก. ลูกค้า ก",
  leadName: "สมชาย ผู้นำ",
  memberNames: ["สมหญิง", "สมศักดิ์"],
  typeLabel: "อาคารสำนักงาน",
  siteAddress: "123 ถนนสุขุมวิท",
};

describe("ProjectInfoButton", () => {
  it("renders the ⓘ trigger and keeps the metadata hidden until opened", () => {
    render(<ProjectInfoButton {...PROPS} />);
    expect(screen.getByRole("button", { name: "ข้อมูลโครงการ" })).toBeInTheDocument();
    expect(screen.queryByText("บจก. ลูกค้า ก")).not.toBeInTheDocument();
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
});
