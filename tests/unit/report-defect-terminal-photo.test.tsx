// Writing failing test first.
//
// Third surface of the 2026-07-28 honest-copy class (#823 catalog, #826 phase
// capture) — and the only one that TRAPS the user. The defect form is
// online-only, so a failed byte upload has no offline queue behind it;
// `anyInFlight` counts upload-error, so a failed photo BLOCKS the submit; and the
// tile renders ลองใหม่ in the branch where ลบ would otherwise be, so an errored
// photo cannot be removed either. A 403/413 therefore strands the whole defect
// report: the retry can never succeed and there is no way out of the form.
// A terminal photo must name its reason and offer ลบ — the way out that exists
// on THIS screen.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReport, mockRefresh, mockDefectPhotos, mockRemove, mockRetry } = vi.hoisted(() => ({
  mockReport: vi.fn(),
  mockRefresh: vi.fn(),
  mockRemove: vi.fn(),
  mockRetry: vi.fn(),
  mockDefectPhotos: {
    photos: [] as Array<{
      id: string;
      previewUrl: string;
      status: string;
      fileName: string;
      errorMessage?: string | null;
      terminal?: boolean;
    }>,
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
import { TERMINAL_UPLOAD_COPY } from "@/lib/photos/upload-queue";

beforeEach(() => {
  mockReport.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockRemove.mockReset();
  mockRetry.mockReset();
  mockDefectPhotos.photos = [];
  mockDefectPhotos.anyInFlight = false;
  mockDefectPhotos.retry = mockRetry;
  mockDefectPhotos.remove = mockRemove;
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});

function openWithPhoto(photo: (typeof mockDefectPhotos.photos)[number]) {
  mockDefectPhotos.photos = [photo];
  render(<ReportDefectControl projectId="p1" workPackageId="wp1" canAttachPhotos />);
  fireEvent.click(screen.getByRole("button", { name: /รายงานข้อบกพร่อง/ }));
}

const terminalPhoto = {
  id: "ph1",
  previewUrl: "blob:preview",
  status: "upload-error",
  fileName: "a.jpg",
  errorMessage: TERMINAL_UPLOAD_COPY.authz,
  terminal: true,
};

describe("ReportDefectControl — a terminal photo failure must not trap the form", () => {
  it("names the reason instead of offering a retry that cannot succeed", () => {
    openWithPhoto(terminalPhoto);

    expect(screen.getByText(TERMINAL_UPLOAD_COPY.authz)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
  });

  it("keeps ลบ reachable — it is the ONLY way out, and it unblocks the submit", () => {
    openWithPhoto(terminalPhoto);

    const remove = screen.getByRole("button", { name: "ลบ" });
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(mockRemove).toHaveBeenCalledWith("ph1");
  });

  it("still offers ลองใหม่ for a retryable upload failure", () => {
    openWithPhoto({
      ...terminalPhoto,
      terminal: false,
      errorMessage: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
    });

    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(mockRetry).toHaveBeenCalledWith("ph1");
  });
});
