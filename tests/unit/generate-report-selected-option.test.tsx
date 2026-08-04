// Spec 394 U3 — the generate form's 4th mode + the cover note.
//
// The option must be visible-but-disabled at zero, not hidden: hiding it means
// a PD who has never selected a photo can never learn the mode exists.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const generateReport = vi.fn();
vi.mock("@/app/projects/[projectId]/reports/actions", () => ({
  generateReport: (...a: unknown[]) => generateReport(...a) as unknown,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { GenerateReportButton } from "@/app/projects/[projectId]/reports/generate-report-button";

const PROJECT = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  generateReport.mockReset().mockResolvedValue({ ok: true });
});

describe("GenerateReportButton — เฉพาะที่เลือก (spec 394 U3)", () => {
  it("shows the option with its live count when photos are selected", () => {
    render(
      <GenerateReportButton projectId={PROJECT} initiallyDisabled={false} selectedPhotoCount={7} />,
    );
    // The count must be IN the option's own label — `getByText(/7/)` alone
    // matches any 7 anywhere on the page and survives rendering it elsewhere.
    expect(screen.getByText("เฉพาะที่เลือก (7 รูป)")).toBeInTheDocument();
  });

  it("at ZERO the option is present but DISABLED, and says why", () => {
    render(
      <GenerateReportButton projectId={PROJECT} initiallyDisabled={false} selectedPhotoCount={0} />,
    );
    // present — a hidden option teaches nobody the mode exists
    const label = screen.getByText(/ยังไม่ได้เลือกรูป/);
    expect(label).toBeInTheDocument();
    const radio = screen.getByRole("radio", { name: /เฉพาะที่เลือก|ยังไม่ได้เลือกรูป/ });
    expect(radio).toBeDisabled();
  });

  it("cannot be submitted as 'selected' at zero — the radio never takes", async () => {
    const user = userEvent.setup();
    render(
      <GenerateReportButton projectId={PROJECT} initiallyDisabled={false} selectedPhotoCount={0} />,
    );
    const radio = screen.getByRole("radio", { name: /เฉพาะที่เลือก|ยังไม่ได้เลือกรูป/ });
    await user.click(radio).catch(() => undefined);
    await user.click(screen.getByRole("button", { name: "สร้างรายงาน" }));
    const arg = generateReport.mock.calls[0]?.[0] as { params: { photos: string } };
    expect(arg.params.photos).not.toBe("selected");
  });

  it("sends the chosen mode and the cover note together", async () => {
    const user = userEvent.setup();
    render(
      <GenerateReportButton projectId={PROJECT} initiallyDisabled={false} selectedPhotoCount={3} />,
    );
    await user.click(screen.getByRole("radio", { name: /เฉพาะที่เลือก/ }));
    await user.type(screen.getByLabelText(/คำนำ/), "เรียนลูกค้า");
    await user.click(screen.getByRole("button", { name: "สร้างรายงาน" }));
    expect(generateReport).toHaveBeenCalledWith({
      projectId: PROJECT,
      params: { scope: "complete", photos: "selected", coverNote: "เรียนลูกค้า" },
    });
  });

  it("omits the cover note entirely when left blank", async () => {
    const user = userEvent.setup();
    render(
      <GenerateReportButton projectId={PROJECT} initiallyDisabled={false} selectedPhotoCount={3} />,
    );
    await user.click(screen.getByRole("button", { name: "สร้างรายงาน" }));
    const arg = generateReport.mock.calls[0]?.[0] as { params: Record<string, unknown> };
    expect(arg.params).not.toHaveProperty("coverNote");
  });
});
