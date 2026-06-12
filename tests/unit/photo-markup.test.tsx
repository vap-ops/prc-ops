// Spec 51 — markup UI inside the lightbox. Load-bearing rules: markup
// chrome exists ONLY when the current photo has a photoId; saved strokes
// render as an SVG overlay; comments list with author; compose mode
// saves via addPhotoMarkup and is creator-gated for removal.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZoomablePhoto } from "@/components/features/photo-lightbox";

const SRC = "https://example.test/storage/photo-1.jpg";
const PHOTO_ID = "7f1f2a3b-4c5d-6e7f-8a9b-0c1d2e3f4a5b";

const mocks = vi.hoisted(() => ({
  listPhotoMarkups: vi.fn(),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

vi.mock("@/app/photo-markups/actions", () => mocks);

beforeEach(() => {
  mocks.listPhotoMarkups.mockReset();
  mocks.addPhotoMarkup.mockReset();
  mocks.removePhotoMarkup.mockReset();
  mocks.listPhotoMarkups.mockResolvedValue({
    ok: true,
    markups: [
      {
        id: "11111111-2222-3333-4444-555555555555",
        strokes: [
          {
            points: [
              [0.1, 0.1],
              [0.9, 0.9],
            ],
          },
        ],
        comment: "ตรงนี้ร้าว",
        createdByName: "สมชาย",
        createdAt: "2026-06-12T08:00:00Z",
        isMine: false,
      },
    ],
  });
  mocks.addPhotoMarkup.mockResolvedValue({ ok: true });
  mocks.removePhotoMarkup.mockResolvedValue({ ok: true });
});

function openLightbox() {
  render(<ZoomablePhoto src={SRC} photoId={PHOTO_ID} />);
  fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
}

describe("photo markup (spec 51)", () => {
  it("renders no markup chrome without a photoId", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.queryByRole("button", { name: "วาดและความเห็น" })).not.toBeInTheDocument();
    expect(mocks.listPhotoMarkups).not.toHaveBeenCalled();
  });

  it("loads and shows saved comments and a strokes overlay", async () => {
    openLightbox();
    expect(await screen.findByText("ตรงนี้ร้าว")).toBeInTheDocument();
    expect(screen.getByText("สมชาย")).toBeInTheDocument();
    expect(mocks.listPhotoMarkups).toHaveBeenCalledWith({ photoLogId: PHOTO_ID });
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("svg polyline")).not.toBeNull();
  });

  it("saves a comment-only markup from compose mode", async () => {
    openLightbox();
    fireEvent.click(await screen.findByRole("button", { name: "วาดและความเห็น" }));
    fireEvent.change(screen.getByLabelText("ความเห็น"), {
      target: { value: "เก็บงานเพิ่มมุมนี้" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mocks.addPhotoMarkup).toHaveBeenCalledWith({
        photoLogId: PHOTO_ID,
        strokes: null,
        comment: "เก็บงานเพิ่มมุมนี้",
      }),
    );
  });

  it("shows ลบ only on own markups", async () => {
    mocks.listPhotoMarkups.mockResolvedValue({
      ok: true,
      markups: [
        {
          id: "11111111-2222-3333-4444-555555555555",
          strokes: null,
          comment: "ของฉันเอง",
          createdByName: "ฉัน",
          createdAt: "2026-06-12T08:00:00Z",
          isMine: true,
        },
        {
          id: "66666666-7777-8888-9999-000000000000",
          strokes: null,
          comment: "ของคนอื่น",
          createdByName: "สมหญิง",
          createdAt: "2026-06-12T09:00:00Z",
          isMine: false,
        },
      ],
    });
    openLightbox();
    await screen.findByText("ของฉันเอง");
    expect(screen.getAllByRole("button", { name: "ลบความเห็น" })).toHaveLength(1);
  });
});
