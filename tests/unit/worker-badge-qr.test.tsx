// Writing failing test first.
//
// Spec 306 U3a — the worker's own morning-muster QR, shown on their phone so the
// SA scans the screen instead of a printed badge. WorkerBadgeQr is a presentational
// render of a pre-generated QR svg string (payload = workers.id, generated
// server-side by src/lib/muster/badge-qr.ts). Pins:
// - renders the passed svg inside a labelled, white-backed QR region (scannable);
// - shows the check-in heading + the "let the admin scan you in the morning" hint.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerBadgeQr } from "@/components/features/common/worker-badge-qr";

const FAKE_SVG = '<svg data-testid="qr-svg"><rect /></svg>';

describe("WorkerBadgeQr", () => {
  it("renders the QR svg inside a labelled, white-backed region", () => {
    render(<WorkerBadgeQr svg={FAKE_SVG} />);

    const region = screen.getByLabelText("QR เช็คชื่อของฉัน");
    expect(region).toBeInTheDocument();
    // The QR must sit on a white background regardless of theme (scanner contrast).
    expect(region.className).toMatch(/bg-white/);
    expect(region.querySelector('[data-testid="qr-svg"]')).not.toBeNull();
  });

  it("shows the check-in heading and the scan-me hint", () => {
    render(<WorkerBadgeQr svg={FAKE_SVG} />);

    expect(screen.getByText("QR เช็คชื่อเข้างาน")).toBeInTheDocument();
    expect(screen.getByText("ให้ผู้ดูแลสแกนตอนเช้าเพื่อเช็คชื่อเข้า–ออกงาน")).toBeInTheDocument();
  });
});
