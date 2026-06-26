// Component tests for the tap-to-enlarge photo lightbox (spec 15 item D).
// The trigger is a button-wrapped thumbnail; activating it opens a
// full-screen dialog with the same image at full size. The dialog closes
// on Escape, on the ปิด button, and on a backdrop click — but NOT when
// the enlarged photo itself is clicked (so panning a finger on mobile
// doesn't dismiss the view).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Spec 51 made the lightbox import the markup server actions; the
// module carries `import "server-only"`, so client-component tests mock
// it (the established action-module pattern). No test here passes a
// photoId, so the mocks are never called.
vi.mock("@/app/photo-markups/actions", () => ({
  listPhotoMarkups: vi.fn(),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";

const SRC = "https://example.test/storage/photo-1.jpg";

describe("ZoomablePhoto", () => {
  it("renders a thumbnail inside a labelled trigger button, dialog closed", () => {
    render(<ZoomablePhoto src={SRC} />);
    const trigger = screen.getByRole("button", { name: "ดูรูปขยาย" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(SRC);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the dialog with the full image when the trigger is clicked", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(SRC);
  });

  it("closes on the ปิด button", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a backdrop click but stays open when the photo is clicked", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    const dialog = screen.getByRole("dialog");
    const photo = dialog.querySelector("img");
    expect(photo).not.toBeNull();
    fireEvent.click(photo as HTMLImageElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders no nav buttons and no counter without a group", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.queryByRole("button", { name: "รูปก่อนหน้า" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });
});

// Spec 50 — swipe/arrow navigation inside a photo group. Load-bearing
// rules: the dialog opens on the TAPPED photo, navigation is
// non-wrapping (buttons disable at the ends), arrow keys work, and a
// singleton group renders no chrome.
describe("ZoomablePhoto group navigation (spec 50)", () => {
  const GROUP = [
    "https://example.test/storage/photo-1.jpg",
    "https://example.test/storage/photo-2.jpg",
    "https://example.test/storage/photo-3.jpg",
  ];

  function openSecond() {
    render(<ZoomablePhoto src={GROUP[1]!} group={GROUP} groupIndex={1} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    return screen.getByRole("dialog");
  }

  it("opens on the tapped photo with a position counter", () => {
    const dialog = openSecond();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[1]);
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("next/prev buttons navigate and disable at the ends", () => {
    const dialog = openSecond();
    const next = screen.getByRole("button", { name: "รูปถัดไป" });
    const prev = screen.getByRole("button", { name: "รูปก่อนหน้า" });
    fireEvent.click(next);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[2]);
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(next).toBeDisabled();
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[0]);
    expect(prev).toBeDisabled();
  });

  it("ArrowRight and ArrowLeft navigate", () => {
    const dialog = openSecond();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[2]);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[0]);
    // Non-wrapping: another left stays put.
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[0]);
  });

  it("re-opens on the tapped photo after navigating and closing", () => {
    const dialog = openSecond();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[2]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(GROUP[1]);
  });

  it("renders no nav chrome for a singleton group", () => {
    render(<ZoomablePhoto src={SRC} group={[SRC]} groupIndex={0} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });
});

// Feedback a6037564 — a project director wants to know who uploaded each
// photo. The enlarged view shows "ถ่ายโดย <name>"; in a group the name
// tracks the current photo. Thumbnails stay time-only (decision: lightbox
// detail only, visible to anyone who can already see the photo).
describe("ZoomablePhoto uploader attribution (feedback a6037564)", () => {
  it("shows the uploader name in the open dialog", () => {
    render(<ZoomablePhoto src={SRC} uploaderName="สมชาย ใจดี" />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.getByRole("dialog").textContent).toContain("ถ่ายโดย สมชาย ใจดี");
  });

  it("shows no attribution line when no uploader name is given", () => {
    render(<ZoomablePhoto src={SRC} />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    expect(screen.getByRole("dialog").textContent).not.toContain("ถ่ายโดย");
  });

  it("tracks the current photo's uploader across group navigation", () => {
    const GROUP = [
      "https://example.test/storage/photo-1.jpg",
      "https://example.test/storage/photo-2.jpg",
    ];
    const NAMES = ["อาทิตย์ แดนไกล", "บุญมี ขยันงาน"];
    render(
      <ZoomablePhoto src={GROUP[0]!} group={GROUP} groupIndex={0} groupUploaderNames={NAMES} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("ถ่ายโดย อาทิตย์ แดนไกล");
    fireEvent.click(screen.getByRole("button", { name: "รูปถัดไป" }));
    expect(dialog.textContent).toContain("ถ่ายโดย บุญมี ขยันงาน");
  });
});
