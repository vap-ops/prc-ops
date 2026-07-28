// Writing failing test first.
//
// Spec 370 U4 (prominence redesign, 2026-07-28) — the shared scan door.
//
// #821 hoisted a plain text link to the top of the store page and the operator
// judged it "not prominent enough". Telemetry re-diagnosed it: the PLACEMENT was
// right, the PAGE was wrong — over 7 days a site_admin generated 1,367 route
// events on /sa and 20 on the project store. So the door becomes one component
// with two homes (the SA home + the top of the store page), shaped as a hero
// action rather than a text link.
//
// No count line by design: `equipment_usage_logs` is still 0 rows, so a status
// line would read "0 ยืมออก" — the subtitle names the physical act instead.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { EquipmentScanDoor } from "@/components/features/equipment/equipment-scan-door";

describe("EquipmentScanDoor", () => {
  it("links to the scan route carrying the caller as the back href", () => {
    render(<EquipmentScanDoor from="/sa" />);
    expect(screen.getByRole("link", { name: /สแกนยืม\/คืนอุปกรณ์/ })).toHaveAttribute(
      "href",
      "/equipment/scan?from=%2Fsa",
    );
  });

  it("encodes a project-store back href", () => {
    render(<EquipmentScanDoor from="/projects/p1/store" />);
    expect(screen.getByRole("link", { name: /สแกนยืม/ })).toHaveAttribute(
      "href",
      "/equipment/scan?from=%2Fprojects%2Fp1%2Fstore",
    );
  });

  it("names the physical act, so the door reads as an action and not a menu entry", () => {
    render(<EquipmentScanDoor from="/sa" />);
    expect(screen.getByText("แตะ QR หรือ NFC บนตัวเครื่องมือ")).toBeInTheDocument();
  });

  it("carries the QR mark, hidden from the accessible name", () => {
    render(<EquipmentScanDoor from="/sa" />);
    const icon = screen.getByRole("link", { name: /สแกนยืม/ }).querySelector("svg.lucide-qr-code");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("clears the field tap-target floor and reads as a filled card, not a hairline row", () => {
    render(<EquipmentScanDoor from="/sa" />);
    const cls = screen.getByRole("link", { name: /สแกนยืม/ }).className;
    // min-h-16 is the deliberate step up from #821's min-h-12 text link.
    expect(cls).toContain("min-h-16");
    expect(cls).toContain("bg-action-soft");
    expect(cls).toContain("border-action");
  });
});
