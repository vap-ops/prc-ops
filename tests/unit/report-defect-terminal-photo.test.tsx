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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DefectPendingPhoto,
  useDefectPhotos,
} from "@/app/projects/[projectId]/work-packages/[workPackageId]/use-defect-photos";

const { mockReport, mockRefresh, mockDefectPhotos, mockRemove, mockRetry } = vi.hoisted(() => ({
  mockReport: vi.fn(),
  mockRefresh: vi.fn(),
  mockRemove: vi.fn(),
  mockRetry: vi.fn(),
  mockDefectPhotos: {
    // Typed against the REAL hook, so a rename or an added field fails tsc here
    // instead of only in production (review finding).
    photos: [] as DefectPendingPhoto[],
    anyInFlight: false,
    fileInputRef: { current: null },
    handleFiles: vi.fn(),
    attachAll: vi.fn(async () => 0),
    retry: vi.fn(),
    remove: vi.fn(),
  } satisfies ReturnType<typeof useDefectPhotos>,
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

function openWithPhoto(photo: DefectPendingPhoto) {
  mockDefectPhotos.photos = [photo];
  render(<ReportDefectControl projectId="p1" workPackageId="wp1" canAttachPhotos />);
  fireEvent.click(screen.getByRole("button", { name: /รายงานข้อบกพร่อง/ }));
}

const terminalPhoto: DefectPendingPhoto = {
  id: "ph1",
  previewUrl: "blob:preview",
  status: "upload-error",
  fileName: "a.jpg",
  errorMessage: TERMINAL_UPLOAD_COPY.authz,
  terminal: true,
  blob: new Blob(["x"]),
  lastModifiedMs: 0,
  ext: "jpeg",
  storagePath: "p/wp/x.jpeg",
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

// Writing failing test first (mutation showed the banner-clear had NO coverage —
// removing it kept every test green).
describe("ReportDefectControl — a stale attach-failure banner must not contradict a terminal tile", () => {
  it("clears the 'ดูที่รูปแต่ละใบ' banner when a new file is selected", async () => {
    mockDefectPhotos.photos = [{ ...terminalPhoto, status: "ready", terminal: false }];
    mockDefectPhotos.attachAll = vi.fn(async () => 1);
    render(<ReportDefectControl projectId="p1" workPackageId="wp1" canAttachPhotos />);
    fireEvent.click(screen.getByRole("button", { name: /รายงานข้อบกพร่อง/ }));
    fireEvent.change(screen.getByLabelText("รายละเอียดข้อบกพร่อง"), {
      target: { value: "รอยร้าวที่ผนัง" },
    });
    fireEvent.click(screen.getByRole("button", { name: "เปิดงานใหม่" }));

    const banner = await screen.findByText(/ดูที่รูปแต่ละใบ/);
    expect(banner).toBeInTheDocument();

    // The next selection can land a REFUSED photo, whose tile offers no retry at
    // all — leaving "tap the photo to retry" on screen above it would be a lie.
    fireEvent.change(screen.getByLabelText(/แนบรูป/), {
      target: { files: [new File(["x"], "b.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(screen.queryByText(/ดูที่รูปแต่ละใบ/)).not.toBeInTheDocument());
  });
});

// Writing failing test first.
//
// The insert layer (last piece of the class): addPhoto refuses a defect attach
// permanently for a non-manager, a WP not in rework, and an unknown WP. The tile
// showed ลองใหม่ for those too — and the insert-error branch never had ลบ, so the
// only escape was closing the sheet and abandoning the photo.
describe("ReportDefectControl — a REFUSED attach (insert stage) is terminal too", () => {
  it("names the refusal and offers ลบ, not a retry", () => {
    openWithPhoto({
      ...terminalPhoto,
      status: "insert-error",
      terminal: true,
      errorMessage: TERMINAL_UPLOAD_COPY.attachRole,
    });

    expect(screen.getByText(TERMINAL_UPLOAD_COPY.attachRole)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ลองใหม่" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(mockRemove).toHaveBeenCalledWith("ph1");
  });

  it("keeps ลองใหม่ for an ordinary (retryable) attach failure", () => {
    openWithPhoto({
      ...terminalPhoto,
      status: "insert-error",
      terminal: false,
      errorMessage: "แนบรูปไม่สำเร็จ — แตะเพื่อลองใหม่",
    });

    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(mockRetry).toHaveBeenCalledWith("ph1");
  });
});
