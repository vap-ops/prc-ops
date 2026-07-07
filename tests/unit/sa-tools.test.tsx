import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Spec 277 P0 — the SA-home tools tile grid: un-buries four shipped destinations
// (คลัง&ของเข้า, ตารางงาน, คำขอซื้อ, ปิดวัน). Store + schedule deep-link into the SA's
// single project, or fall back to the project picker when they run 0/many projects.
// ปิดวัน gets a gentle end-of-day pulse after ~16:00 (never a reorder).

import { SaTools } from "@/components/features/sa/sa-tools";

describe("SaTools", () => {
  it("deep-links store + schedule to the single project, requests + ปิดวัน globally", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.getByRole("link", { name: /คลัง/ })).toHaveAttribute(
      "href",
      "/projects/p1/store",
    );
    expect(screen.getByRole("link", { name: /ตารางงาน/ })).toHaveAttribute(
      "href",
      "/projects/p1/schedule",
    );
    expect(screen.getByRole("link", { name: /คำขอซื้อ/ })).toHaveAttribute("href", "/requests");
    expect(screen.getByRole("link", { name: /ปิดวัน/ })).toHaveAttribute("href", "/sa/plan");
  });

  it("falls back to the project picker when there is no single project", () => {
    render(<SaTools primaryProjectId={null} showCloseNudge={false} />);
    expect(screen.getByRole("link", { name: /คลัง/ })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: /ตารางงาน/ })).toHaveAttribute("href", "/projects");
  });

  it("pulses ปิดวัน only after hours", () => {
    const { rerender } = render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.queryByTestId("close-pulse")).toBeNull();
    rerender(<SaTools primaryProjectId="p1" showCloseNudge />);
    expect(screen.getByTestId("close-pulse")).toBeInTheDocument();
  });
});
