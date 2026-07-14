// Feedback 397dabaa — landscape receipts need an in-viewer rotate so reviewers
// can read them without tilting their head. Rotation is a VIEW-ONLY transform on
// the shared lightbox overlay (the photo bytes are never touched — CLAUDE.md
// immutability): it applies to every enlarged photo/receipt surface, not one
// screen. Load-bearing rules encoded here:
//   - a rotate control exists in the enlarged view;
//   - each tap advances the displayed image by 90° (0→90→180→270→0);
//   - rotation is applied to the image wrapper so a saved-markup SVG overlay
//     rotates WITH the photo (strokes stay aligned);
//   - rotation resets when navigating to another photo in a group;
//   - the rotate control is hidden while composing markup (drawing is always
//     captured at 0° so the normalized-point math is never rotated).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";

const A = "https://example.test/storage/receipt-1.jpg";
const B = "https://example.test/storage/receipt-2.jpg";
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
  mocks.listPhotoMarkups.mockResolvedValue({ ok: true, markups: [] });
  mocks.addPhotoMarkup.mockResolvedValue({ ok: true });
  mocks.removePhotoMarkup.mockResolvedValue({ ok: true });
});

function wrapperTransform(): string {
  const img = screen.getByRole("dialog").querySelector("img");
  const wrapper = img?.parentElement as HTMLElement | null | undefined;
  return wrapper?.style.transform ?? "";
}

async function openReceipt() {
  render(<ZoomablePhoto src={A} />);
  fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
  await screen.findByRole("dialog");
}

describe("lightbox rotate (feedback 397dabaa)", () => {
  it("shows a rotate control on a receipt (no markup)", async () => {
    await openReceipt();
    expect(screen.getByRole("button", { name: "หมุนรูป" })).toBeInTheDocument();
  });

  it("advances the displayed image by 90° on each tap and wraps at 360°", async () => {
    await openReceipt();
    expect(wrapperTransform()).not.toContain("rotate(90deg)");
    const rotate = screen.getByRole("button", { name: "หมุนรูป" });

    fireEvent.click(rotate);
    expect(wrapperTransform()).toContain("rotate(90deg)");
    fireEvent.click(rotate);
    expect(wrapperTransform()).toContain("rotate(180deg)");
    fireEvent.click(rotate);
    expect(wrapperTransform()).toContain("rotate(270deg)");
    fireEvent.click(rotate);
    // Back to upright — no residual rotation.
    expect(wrapperTransform()).toContain("rotate(0deg)");
  });

  it("resets rotation when navigating to another photo in a group", async () => {
    render(<ZoomablePhoto src={A} group={[A, B]} groupIndex={0} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "หมุนรูป" }));
    expect(wrapperTransform()).toContain("rotate(90deg)");

    fireEvent.click(screen.getByRole("button", { name: "รูปถัดไป" }));
    expect(wrapperTransform()).toContain("rotate(0deg)");
  });

  it("hides the rotate control while composing markup", async () => {
    render(<ZoomablePhoto src={A} photoId={PHOTO_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    await screen.findByRole("dialog");

    expect(screen.getByRole("button", { name: "หมุนรูป" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "วาดและความเห็น" }));
    expect(screen.queryByRole("button", { name: "หมุนรูป" })).not.toBeInTheDocument();
  });
});
