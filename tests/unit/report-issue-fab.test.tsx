import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const reportSiteIssue = vi.fn();
const addSiteIssueAttachment = vi.fn();
vi.mock("@/app/sa/report-issue-actions", () => ({
  reportSiteIssue: (...a: unknown[]) => reportSiteIssue(...a),
  addSiteIssueAttachment: (...a: unknown[]) => addSiteIssueAttachment(...a),
}));
vi.mock("@/lib/db/browser", () => ({ createClient: () => ({ storage: { from: () => ({}) } }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ReportIssueFab } from "@/components/features/sa/report-issue-fab";

describe("ReportIssueFab", () => {
  beforeEach(() => {
    reportSiteIssue.mockReset().mockResolvedValue({ ok: true, issueId: "iss-1" });
    addSiteIssueAttachment.mockReset();
    refresh.mockReset();
  });

  it("renders nothing without a project to file against", () => {
    const { container } = render(<ReportIssueFab projectId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the report sheet from the red FAB and lists the issue types", () => {
    render(<ReportIssueFab projectId="proj-1" />);
    fireEvent.click(screen.getByRole("button", { name: "แจ้งปัญหา" }));
    // sheet open: type chips present
    expect(screen.getByRole("button", { name: "สภาพอากาศ/ฝน" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ความปลอดภัย/อุบัติเหตุ" })).toBeInTheDocument();
  });

  it("gates submit until a type is chosen, then files the issue against the project", async () => {
    render(<ReportIssueFab projectId="proj-1" />);
    fireEvent.click(screen.getByRole("button", { name: "แจ้งปัญหา" }));

    const submit = screen.getByRole("button", { name: "ส่ง" });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "สภาพอากาศ/ฝน" }));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    await waitFor(() => expect(reportSiteIssue).toHaveBeenCalledTimes(1));
    expect(reportSiteIssue).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-1", issueType: "weather" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
