// Writing failing test first.
//
// Spec 144 U2 — the "report defect" control on a complete WP. SA/PM/super open
// it, give a reason, and the WP reopens to rework. Mocked action + router (the
// reopen_work_package_for_defect RPC carries the gates).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReport, mockRefresh, mockDefectPhotos } = vi.hoisted(() => ({
  mockReport: vi.fn(),
  mockRefresh: vi.fn(),
  mockDefectPhotos: {
    photos: [] as Array<{ id: string; previewUrl: string; status: string; fileName: string }>,
    anyInFlight: false,
    fileInputRef: { current: null },
    handleFiles: vi.fn(),
    attachAll: vi.fn(async () => 0),
    retry: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/actions", () => ({
  reportDefect: mockReport,
}));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/use-defect-photos", () => ({
  useDefectPhotos: () => mockDefectPhotos,
}));

import { ReportDefectControl } from "@/app/projects/[projectId]/work-packages/[workPackageId]/report-defect-control";
import { REPORT_DEFECT_LABEL, REWORK_SOURCE_LABEL } from "@/lib/i18n/labels";

beforeEach(() => {
  mockReport.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockDefectPhotos.photos = [];
  mockDefectPhotos.anyInFlight = false;
  mockDefectPhotos.attachAll = vi.fn(async () => 0);
  // jsdom default; individual tests flip it.
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

function open(props: { canAttachPhotos?: boolean; canFileClientSource?: boolean } = {}) {
  render(<ReportDefectControl projectId="p1" workPackageId="wp1" {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /รายงานข้อบกพร่อง/ }));
}

describe("ReportDefectControl", () => {
  it("disables submit until a reason is entered", () => {
    open();
    const submit = screen.getByRole("button", { name: "เปิดงานใหม่" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าวที่ผนัง" },
    });
    expect(submit).toBeEnabled();
  });

  it("reopens with the reason + the default internal source, and refreshes on success", async () => {
    open();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าวที่ผนัง" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        projectId: "p1",
        workPackageId: "wp1",
        reason: "รอยร้าวที่ผนัง",
        // Spec 217: defaults to internal (ตรวจภายใน) unless the client toggle is picked.
        source: "internal",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("passes source=client when ลูกค้าแจ้ง is selected (spec 217, PM tier)", async () => {
    // Spec 337 U5 follow-up: the picker exists only at PM tier now, so this
    // spec-217 behaviour is asserted with the tier that actually has it.
    open({ canFileClientSource: true });
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "ลูกค้าพบรอยรั่ว" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ลูกค้าแจ้ง" }));
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ source: "client", reason: "ลูกค้าพบรอยรั่ว" }),
      ),
    );
  });

  it("shows the action error inline and does not refresh", async () => {
    mockReport.mockResolvedValue({ ok: false, error: "เปิดงานใหม่ไม่สำเร็จ" });
    open();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "ปัญหา" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("เปิดงานใหม่ไม่สำเร็จ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // ── Spec 248 U2 — defect photos on the filing form ────────────────────────

  it("hides the photo section unless canAttachPhotos (SA files text-only)", () => {
    open();
    expect(screen.queryByLabelText("แนบรูปข้อบกพร่อง")).not.toBeInTheDocument();
  });

  it("shows the photo picker for planners (canAttachPhotos)", () => {
    open({ canAttachPhotos: true });
    expect(screen.getByLabelText("แนบรูปข้อบกพร่อง")).toBeInTheDocument();
  });

  it("blocks submit while OFFLINE with a hint (online-only filing — no queued replay)", () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    open();
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "ปัญหา" },
    });
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeDisabled();
    expect(screen.getByText(/ออฟไลน์/)).toBeInTheDocument();
  });

  it("blocks submit while photo bytes are in flight", () => {
    mockDefectPhotos.anyInFlight = true;
    open({ canAttachPhotos: true });
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "ปัญหา" },
    });
    expect(screen.getByRole("button", { name: "เปิดงานใหม่" })).toBeDisabled();
  });

  it("attaches photos AFTER a successful reopen, then refreshes", async () => {
    open({ canAttachPhotos: true });
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าว" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));
    await waitFor(() => expect(mockDefectPhotos.attachAll).toHaveBeenCalled());
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    // Ordering: the RPC fired before any metadata insert.
    expect(mockReport.mock.invocationCallOrder[0]).toBeLessThan(
      (mockDefectPhotos.attachAll as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the sheet open with a retry hint when a photo insert fails post-reopen", async () => {
    mockDefectPhotos.attachAll = vi.fn(async () => 1);
    open({ canAttachPhotos: true });
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าว" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/แนบรูปไม่สำเร็จ/));
    // Defect already filed — the form must NOT re-fire the RPC on retry;
    // the sheet stays open so the retry buttons on the photos are reachable.
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  // Spec 337 U5 follow-up — the source picker is PM-tier only. The RPC refuses
  // p_source='client' below PM tier, so offering the button to an SA is a dead
  // door that answers with an error. Below PM tier the filing is always
  // ตรวจภายใน, so the whole picker goes rather than a one-option control.
  it("offers the ที่มา picker to PM tier (canFileClientSource)", () => {
    render(
      <ReportDefectControl projectId="p1" workPackageId="wp1" canFileClientSource initialOpen />,
    );
    expect(screen.getByRole("button", { name: REWORK_SOURCE_LABEL.client })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: REWORK_SOURCE_LABEL.internal })).toBeInTheDocument();
  });

  it("hides the whole ที่มา picker below PM tier — no dead ลูกค้าแจ้ง button", () => {
    render(<ReportDefectControl projectId="p1" workPackageId="wp1" initialOpen />);
    expect(
      screen.queryByRole("button", { name: REWORK_SOURCE_LABEL.client }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: REWORK_SOURCE_LABEL.internal }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("ที่มาของข้อบกพร่อง")).not.toBeInTheDocument();
    // The form still works — the reason field and submit are untouched.
    expect(screen.getByLabelText("รายละเอียดข้อบกพร่อง")).toBeInTheDocument();
  });

  it("files as internal when the picker is hidden", async () => {
    render(<ReportDefectControl projectId="p1" workPackageId="wp1" initialOpen />);
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าว" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));
    await waitFor(() => expect(mockReport).toHaveBeenCalled());
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({ source: "internal" }));
  });

  // Spec 337 U5 — arriving from the list's เสร็จแล้ว door (?defect=1) lands
  // with the sheet already open, so the deep link costs one tap, not two.
  it("opens the sheet on mount with initialOpen (the ?defect=1 arrival)", () => {
    render(<ReportDefectControl projectId="p1" workPackageId="wp1" initialOpen />);
    expect(screen.getByLabelText("รายละเอียดข้อบกพร่อง")).toBeInTheDocument();
  });

  it("stays closed on a normal arrival (no initialOpen)", () => {
    render(<ReportDefectControl projectId="p1" workPackageId="wp1" />);
    expect(screen.queryByLabelText("รายละเอียดข้อบกพร่อง")).not.toBeInTheDocument();
    // The trigger is still the only thing on screen.
    expect(screen.getByRole("button", { name: REPORT_DEFECT_LABEL })).toBeInTheDocument();
  });
});
