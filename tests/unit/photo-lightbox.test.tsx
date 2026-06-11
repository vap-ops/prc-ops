// Component tests for the tap-to-enlarge photo lightbox (spec 15 item D).
// The trigger is a button-wrapped thumbnail; activating it opens a
// full-screen dialog with the same image at full size. The dialog closes
// on Escape, on the ปิด button, and on a backdrop click — but NOT when
// the enlarged photo itself is clicked (so panning a finger on mobile
// doesn't dismiss the view).

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";

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
});
