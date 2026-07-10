// Component tests for the tap-to-enlarge photo lightbox (spec 15 item D).
// The trigger is a button-wrapped thumbnail; activating it opens a
// full-screen dialog with the same image at full size. The dialog closes
// on Escape, on the ปิด button, and on a backdrop click — but NOT when
// the enlarged photo itself is clicked (so panning a finger on mobile
// doesn't dismiss the view).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Spec 51 made the lightbox import the markup server actions; the
// module carries `import "server-only"`, so client-component tests mock
// it (the established action-module pattern). The delete tests below DO
// pass a photoId (markup loads on open), so listPhotoMarkups resolves.
vi.mock("@/app/photo-markups/actions", () => ({
  listPhotoMarkups: vi.fn().mockResolvedValue({ ok: true, markups: [] }),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";

const SRC = "https://example.test/storage/photo-1.jpg";

// The overlay is fetched through next/dynamic on first open, so opening is
// asynchronous — click the trigger, then await the dialog.
async function openLightbox() {
  fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
  return await screen.findByRole("dialog");
}

// Audit 2026-06 rank 6 (`photo-lightbox-dynamic`) — the enlarged-view overlay
// (markup canvas, comments, server-action calls) is the heavy half of the
// lightbox and is only needed once a photo is actually tapped, yet a static
// import would ship it inside EVERY page that renders a thumbnail. The trigger
// module must load the overlay through next/dynamic so the overlay stays in
// its own lazily-fetched chunk, and the heavy deps must live in the overlay
// module, not the trigger.
describe("lightbox code-split (audit rank 6)", () => {
  const COMPONENTS = join(process.cwd(), "src", "components", "features", "photos");

  it("loads the overlay via next/dynamic and keeps heavy deps out of the trigger", async () => {
    const trigger = readFileSync(join(COMPONENTS, "photo-lightbox.tsx"), "utf8");
    expect(trigger).toContain("next/dynamic");
    // The markup server actions (and their transitive weight) belong to the
    // overlay chunk — the trigger renders on every thumbnail.
    expect(trigger).not.toContain("@/app/photo-markups/actions");
    const overlay = readFileSync(join(COMPONENTS, "photo-lightbox-overlay.tsx"), "utf8");
    expect(overlay).toContain("@/app/photo-markups/actions");
  });
});

describe("ZoomablePhoto", () => {
  it("renders a thumbnail inside a labelled trigger button, dialog closed", async () => {
    render(<ZoomablePhoto src={SRC} />);
    const trigger = screen.getByRole("button", { name: "ดูรูปขยาย" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector("img")?.getAttribute("src")).toBe(SRC);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the dialog with the full image when the trigger is clicked", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(SRC);
  });

  it("closes on the ปิด button", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a backdrop click but stays open when the photo is clicked", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    const dialog = screen.getByRole("dialog");
    const photo = dialog.querySelector("img");
    expect(photo).not.toBeNull();
    fireEvent.click(photo as HTMLImageElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders no nav buttons and no counter without a group", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    expect(screen.queryByRole("button", { name: "รูปก่อนหน้า" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });
});

// Feedback 87004dc1 "Images are there but not loading" — the schedule photo
// strips mint thumbnails through the Supabase image-TRANSFORM API, which is
// capped at a monthly origin-image quota; once exceeded, a not-yet-cached
// photo's thumbnail 403s and the <img> shows broken while the photo itself is
// perfectly readable through the plain (quota-free) object URL. ZoomablePhoto
// takes an optional fallbackSrc (the full object URL) and swaps to it when the
// thumbnail fails to load, so a quota 403 (or any thumbnail fetch failure)
// degrades to the full image instead of a broken tile.
describe("ZoomablePhoto thumbnail fallback (feedback 87004dc1)", () => {
  const THUMB = "https://example.test/render/thumb-1.jpg";
  const FULL = "https://example.test/object/full-1.jpg";

  function thumbImg() {
    return screen
      .getByRole("button", { name: "ดูรูปขยาย" })
      .querySelector("img") as HTMLImageElement;
  }

  it("swaps to fallbackSrc when the thumbnail fails to load", () => {
    render(<ZoomablePhoto src={THUMB} fallbackSrc={FULL} />);
    const img = thumbImg();
    expect(img.getAttribute("src")).toBe(THUMB);
    fireEvent.error(img);
    expect(thumbImg().getAttribute("src")).toBe(FULL);
  });

  it("does not loop — a failure on the fallback itself is not re-swapped", () => {
    render(<ZoomablePhoto src={THUMB} fallbackSrc={FULL} />);
    fireEvent.error(thumbImg());
    expect(thumbImg().getAttribute("src")).toBe(FULL);
    // The fallback (full object URL) is quota-free and should load; but even if
    // it errors, we must not thrash back to the broken thumbnail.
    fireEvent.error(thumbImg());
    expect(thumbImg().getAttribute("src")).toBe(FULL);
  });

  it("leaves src unchanged on error when no fallbackSrc is given (backward compatible)", () => {
    render(<ZoomablePhoto src={SRC} />);
    const img = thumbImg();
    fireEvent.error(img);
    expect(thumbImg().getAttribute("src")).toBe(SRC);
  });

  it("opens the enlarged single-photo view on the quota-free full URL, not the thumbnail", async () => {
    render(<ZoomablePhoto src={THUMB} fallbackSrc={FULL} photoId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "ดูรูปขยาย" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(FULL);
  });

  it("resets to the thumbnail when the src prop changes (signed-URL refresh)", () => {
    const { rerender } = render(<ZoomablePhoto src={THUMB} fallbackSrc={FULL} />);
    fireEvent.error(thumbImg());
    expect(thumbImg().getAttribute("src")).toBe(FULL);
    // Spec 257 refreshes signed URLs every ~100s; a fresh thumb should be tried
    // again, not stay pinned to the previous fallback.
    const THUMB2 = "https://example.test/render/thumb-1-v2.jpg";
    const FULL2 = "https://example.test/object/full-1-v2.jpg";
    rerender(<ZoomablePhoto src={THUMB2} fallbackSrc={FULL2} />);
    expect(thumbImg().getAttribute("src")).toBe(THUMB2);
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

  async function openSecond() {
    render(<ZoomablePhoto src={GROUP[1]!} group={GROUP} groupIndex={1} />);
    return await openLightbox();
  }

  it("opens on the tapped photo with a position counter", async () => {
    const dialog = await openSecond();
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[1]);
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("next/prev buttons navigate and disable at the ends", async () => {
    const dialog = await openSecond();
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

  it("ArrowRight and ArrowLeft navigate", async () => {
    const dialog = await openSecond();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[2]);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[0]);
    // Non-wrapping: another left stays put.
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[0]);
  });

  it("re-opens on the tapped photo after navigating and closing", async () => {
    const dialog = await openSecond();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(GROUP[2]);
    fireEvent.keyDown(document, { key: "Escape" });
    await openLightbox();
    expect(screen.getByRole("dialog").querySelector("img")?.getAttribute("src")).toBe(GROUP[1]);
  });

  it("renders no nav chrome for a singleton group", async () => {
    render(<ZoomablePhoto src={SRC} group={[SRC]} groupIndex={0} />);
    await openLightbox();
    expect(screen.queryByRole("button", { name: "รูปถัดไป" })).not.toBeInTheDocument();
    expect(screen.queryByText("1/1")).not.toBeInTheDocument();
  });
});

// Feedback 7c3347b3 — clicking a photo should open a detail view that
// OWNS the delete action (off the small grid thumbnail, so an upload
// can't be deleted by a mis-tap and feels permanent). Delete is opt-in
// per surface: only the SA capture context passes `canDelete` +
// `onDeletePhoto`; read-only surfaces (PM gallery, the recent strip)
// pass neither and show no delete. Deletion still routes through the
// supersede tombstone (the parent's onDeletePhoto), guarded by a confirm.
describe("ZoomablePhoto detail-view delete (feedback 7c3347b3)", () => {
  const PID = "11111111-1111-1111-1111-111111111111";

  it("shows no delete button on a read-only surface (no canDelete)", async () => {
    render(<ZoomablePhoto src={SRC} photoId={PID} />);
    await openLightbox();
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
  });

  it("shows a delete button inside the open detail when canDelete is set", async () => {
    render(<ZoomablePhoto src={SRC} photoId={PID} canDelete onDeletePhoto={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "ลบรูป" })).not.toBeInTheDocument();
    await openLightbox();
    expect(screen.getByRole("button", { name: "ลบรูป" })).toBeInTheDocument();
  });

  it("requires a confirm, then calls onDeletePhoto with the id and closes", async () => {
    const onDelete = vi.fn();
    render(<ZoomablePhoto src={SRC} photoId={PID} canDelete onDeletePhoto={onDelete} />);
    await openLightbox();
    fireEvent.click(screen.getByRole("button", { name: "ลบรูป" }));
    // The supersede is irreversible to the user — a confirm gates it.
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    const confirmDialog = prompt.closest('[role="dialog"]') as HTMLElement;
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "ลบรูป" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(PID);
    // After deleting, the photo is gone — close the detail.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not delete when the confirm is cancelled and keeps the detail open", async () => {
    const onDelete = vi.fn();
    render(<ZoomablePhoto src={SRC} photoId={PID} canDelete onDeletePhoto={onDelete} />);
    await openLightbox();
    fireEvent.click(screen.getByRole("button", { name: "ลบรูป" }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("deletes the CURRENT photo after navigating within a group", async () => {
    const onDelete = vi.fn();
    const GROUP = [
      "https://example.test/storage/photo-1.jpg",
      "https://example.test/storage/photo-2.jpg",
    ];
    const IDS = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    render(
      <ZoomablePhoto
        src={GROUP[0]!}
        group={GROUP}
        groupPhotoIds={IDS}
        groupIndex={0}
        photoId={IDS[0]!}
        canDelete
        onDeletePhoto={onDelete}
      />,
    );
    await openLightbox();
    fireEvent.click(screen.getByRole("button", { name: "รูปถัดไป" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบรูป" }));
    const prompt = screen.getByText("ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้");
    fireEvent.click(
      within(prompt.closest('[role="dialog"]') as HTMLElement).getByRole("button", {
        name: "ลบรูป",
      }),
    );
    expect(onDelete).toHaveBeenCalledWith(IDS[1]);
  });
});

// Feedback a6037564 — a project director wants to know who uploaded each
// photo. The enlarged view shows "ถ่ายโดย <name>"; in a group the name
// tracks the current photo. Thumbnails stay time-only (decision: lightbox
// detail only, visible to anyone who can already see the photo).
describe("ZoomablePhoto uploader attribution (feedback a6037564)", () => {
  it("shows the uploader name in the open dialog", async () => {
    render(<ZoomablePhoto src={SRC} uploaderName="สมชาย ใจดี" />);
    await openLightbox();
    expect(screen.getByRole("dialog").textContent).toContain("ถ่ายโดย สมชาย ใจดี");
  });

  it("shows no attribution line when no uploader name is given", async () => {
    render(<ZoomablePhoto src={SRC} />);
    await openLightbox();
    expect(screen.getByRole("dialog").textContent).not.toContain("ถ่ายโดย");
  });

  it("tracks the current photo's uploader across group navigation", async () => {
    const GROUP = [
      "https://example.test/storage/photo-1.jpg",
      "https://example.test/storage/photo-2.jpg",
    ];
    const NAMES = ["อาทิตย์ แดนไกล", "บุญมี ขยันงาน"];
    render(
      <ZoomablePhoto src={GROUP[0]!} group={GROUP} groupIndex={0} groupUploaderNames={NAMES} />,
    );
    await openLightbox();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("ถ่ายโดย อาทิตย์ แดนไกล");
    fireEvent.click(screen.getByRole("button", { name: "รูปถัดไป" }));
    expect(dialog.textContent).toContain("ถ่ายโดย บุญมี ขยันงาน");
  });
});
