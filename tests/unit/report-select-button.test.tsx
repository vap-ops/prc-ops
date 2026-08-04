// Spec 394 U2 — the per-photo client-report toggle and the D6 arrange strip.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const selectReportPhoto = vi.fn();
const unselectReportPhoto = vi.fn();
const reorderReportPhotos = vi.fn();
vi.mock("@/lib/reports/report-selection-actions", () => ({
  selectReportPhoto: (...a: unknown[]) => selectReportPhoto(...a) as unknown,
  unselectReportPhoto: (...a: unknown[]) => unselectReportPhoto(...a) as unknown,
  reorderReportPhotos: (...a: unknown[]) => reorderReportPhotos(...a) as unknown,
}));

import { ReportSelectButton } from "@/components/features/reports/report-select-button";
import { ReportArrangeStrip } from "@/components/features/reports/report-arrange-strip";

const W = "22222222-2222-2222-2222-222222222222";
const P1 = "33333333-3333-3333-3333-333333333333";
const P2 = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  selectReportPhoto.mockReset().mockResolvedValue({ ok: true });
  unselectReportPhoto.mockReset().mockResolvedValue({ ok: true });
  reorderReportPhotos.mockReset().mockResolvedValue({ ok: true });
});

describe("ReportSelectButton", () => {
  it("names the client report explicitly — รายงาน alone collides with the procurement reports", () => {
    render(<ReportSelectButton workPackageId={W} photoId={P1} selected={false} />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(label).toContain("ลูกค้า");
  });

  it("the label states the ACTION and flips with state", async () => {
    const { unmount } = render(
      <ReportSelectButton workPackageId={W} photoId={P1} selected={false} />,
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("เลือก");
    unmount();
    render(<ReportSelectButton workPackageId={W} photoId={P1} selected />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("เอาออก");
  });

  it("an unselected photo calls select; a selected one calls unselect", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ReportSelectButton workPackageId={W} photoId={P1} selected={false} />,
    );
    await user.click(screen.getByRole("button"));
    expect(selectReportPhoto).toHaveBeenCalledWith(W, P1);
    unmount();

    render(<ReportSelectButton workPackageId={W} photoId={P1} selected />);
    await user.click(screen.getByRole("button"));
    expect(unselectReportPhoto).toHaveBeenCalledWith(W, P1);
  });

  it("surfaces a refusal in an alert, verbatim — the action owns the honest copy", async () => {
    selectReportPhoto.mockResolvedValue({ ok: false, error: "เลือกรูปนี้ไม่ได้: รูปถูกแทนที่" });
    const user = userEvent.setup();
    render(<ReportSelectButton workPackageId={W} photoId={P1} selected={false} />);
    await user.click(screen.getByRole("button"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ถูกแทนที่");
    expect(alert.textContent).not.toContain("ลองใหม่");
  });
});

describe("ReportArrangeStrip (D6)", () => {
  const photos = [
    { photoId: P1, url: "u1" },
    { photoId: P2, url: "u2" },
  ];

  it("renders NOTHING at zero selected — not an empty frame with dead arrows", () => {
    const { container } = render(<ReportArrangeStrip workPackageId={W} photos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("each control names the photo's POSITION — order is otherwise visual only", () => {
    render(<ReportArrangeStrip workPackageId={W} photos={photos} />);
    expect(screen.getByLabelText("เลื่อนขึ้น รูปที่ 2")).toBeTruthy();
    expect(screen.getByLabelText("เลื่อนลง รูปที่ 1")).toBeTruthy();
  });

  it("the first row cannot move up and the last cannot move down", () => {
    render(<ReportArrangeStrip workPackageId={W} photos={photos} />);
    expect(screen.queryByLabelText("เลื่อนขึ้น รูปที่ 1")).toBeNull();
    expect(screen.queryByLabelText("เลื่อนลง รูปที่ 2")).toBeNull();
  });

  it("moving a photo sends the WHOLE reordered list", async () => {
    const user = userEvent.setup();
    render(<ReportArrangeStrip workPackageId={W} photos={photos} />);
    await user.click(screen.getByLabelText("เลื่อนขึ้น รูปที่ 2"));
    await waitFor(() => expect(reorderReportPhotos).toHaveBeenCalledWith(W, [P2, P1]));
  });

  it("a refused reorder tells the user to refresh, in an alert", async () => {
    reorderReportPhotos.mockResolvedValue({
      ok: false,
      error: "รายการรูปเปลี่ยนไปแล้ว กรุณารีเฟรช",
    });
    const user = userEvent.setup();
    render(<ReportArrangeStrip workPackageId={W} photos={photos} />);
    await user.click(screen.getByLabelText("เลื่อนขึ้น รูปที่ 2"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("รีเฟรช");
  });
});
