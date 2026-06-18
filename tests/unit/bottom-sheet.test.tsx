// Writing failing test first.
//
// Spec 78 (app-feel slice 4): BottomSheet — a thumb-reachable sheet that
// slides up from the bottom, replacing inline disclosure forms. Same overlay
// contract as ConfirmDialog (scrim + Escape close, content click does not
// close, role=dialog aria-modal); the caller owns the open state.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "@/components/features/common/bottom-sheet";

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <BottomSheet open={false} title="มอบหมายงาน" onClose={vi.fn()}>
        <p>เนื้อหา</p>
      </BottomSheet>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a labelled dialog with the title and children when open", () => {
    render(
      <BottomSheet open title="มอบหมายงาน" onClose={vi.fn()}>
        <p>เนื้อหาในชีต</p>
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "มอบหมายงาน" })).toBeInTheDocument();
    expect(screen.getByText("เนื้อหาในชีต")).toBeInTheDocument();
  });

  it("portals the overlay to document.body so z-50 escapes a parent stacking context", () => {
    // Spec 94 follow-up: opened from inside a `sticky z-20` header, an in-place
    // overlay is capped at z-20 page-wide and the fixed capture bar (z-40) paints
    // over it ("WP general information hidden behind camera button"). The portal
    // attaches the overlay under <body> so its z-50 wins at the root.
    render(
      <header style={{ position: "sticky", zIndex: 20 }}>
        <BottomSheet open title="ข้อมูลงาน" onClose={vi.fn()}>
          <p>เนื้อหา</p>
        </BottomSheet>
      </header>,
    );
    expect(screen.getByRole("dialog").parentElement).toBe(document.body);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="t" onClose={onClose}>
        <p>x</p>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a scrim click but NOT on a content click", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="t" onClose={onClose}>
        <p>เนื้อหา</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByText("เนื้อหา"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the ปิด button", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="t" onClose={onClose}>
        <p>x</p>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("keyboard occlusion (VisualViewport)", () => {
    afterEach(() => {
      // The hook reads window.visualViewport; clear the mock between cases.
      Object.defineProperty(window, "visualViewport", {
        value: undefined,
        configurable: true,
      });
    });

    function mockKeyboard(height: number, offsetTop = 0) {
      Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
      Object.defineProperty(window, "visualViewport", {
        value: {
          height,
          offsetTop,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
        configurable: true,
      });
    }

    it("lifts the bottom panel above the keyboard and caps it to the visible viewport", () => {
      // 768 window, keyboard leaves a 432px-tall visual viewport → 336px inset.
      mockKeyboard(432);
      render(
        <BottomSheet open title="เพิ่มโครงการ" onClose={vi.fn()}>
          <input aria-label="ชื่อโครงการ" />
        </BottomSheet>,
      );
      const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
      expect(panel.style.marginBottom).toBe("336px");
      expect(panel.style.maxHeight).toBe("432px");
    });

    it("applies no inline lift when no keyboard is up (VisualViewport fills the window)", () => {
      mockKeyboard(768);
      render(
        <BottomSheet open title="เพิ่มโครงการ" onClose={vi.fn()}>
          <input aria-label="ชื่อโครงการ" />
        </BottomSheet>,
      );
      const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
      expect(panel.style.marginBottom).toBe("");
      expect(panel.style.maxHeight).toBe("");
    });

    it("caps height but does not margin-shift the right (side-sheet) variant", () => {
      mockKeyboard(432);
      render(
        <BottomSheet open side="right" title="รายละเอียด" onClose={vi.fn()}>
          <input aria-label="ค้นหา" />
        </BottomSheet>,
      );
      const panel = screen.getByRole("dialog").firstElementChild as HTMLElement;
      expect(panel.style.maxHeight).toBe("432px");
      expect(panel.style.marginBottom).toBe("");
    });
  });
});
