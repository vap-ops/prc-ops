import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayIssuesSection } from "@/components/features/sa/today-issues-section";
import type { TodayIssueView } from "@/lib/site-issues/load-today-issues";

const issue = (over: Partial<TodayIssueView> = {}): TodayIssueView => ({
  id: "11111111-1111-1111-1111-111111111111",
  issueType: "equipment",
  status: "open",
  note: "เครื่องผสมปูนเสีย",
  projectName: "โครงการ ก",
  thumbnailUrls: [],
  ...over,
});

describe("TodayIssuesSection", () => {
  it("renders nothing when there are no issues (conditional-section idiom)", () => {
    const { container } = render(<TodayIssuesSection issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the type label, note and a thumbnail for each issue", () => {
    render(
      <TodayIssuesSection issues={[issue({ thumbnailUrls: ["https://signed.example/a.jpg"] })]} />,
    );
    // Thai label for the 'equipment' type.
    expect(screen.getByText("เครื่องจักร/อุปกรณ์เสีย")).toBeInTheDocument();
    expect(screen.getByText("เครื่องผสมปูนเสีย")).toBeInTheDocument();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://signed.example/a.jpg");
  });

  it("marks a resolved issue distinctly from an open one", () => {
    render(<TodayIssuesSection issues={[issue({ status: "resolved", note: null })]} />);
    expect(screen.getByText("แก้ไขแล้ว")).toBeInTheDocument();
  });
});
