import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Spec 277 P0 (+ spec 300 U4) — the SA-home tools tile grid: un-buries shipped
// destinations (ของเข้า + คลัง [split by spec 300 U4], ตารางงาน, คำขอซื้อ, ปิดวัน, ทีมงาน).
// Store/incoming/schedule deep-link into the SA's single project, or fall back to the
// project picker when they run 0/many projects. ปิดวัน gets a gentle end-of-day pulse
// after ~16:00 (never a reorder).

import { SaTools } from "@/components/features/sa/sa-tools";

describe("SaTools", () => {
  it("deep-links store + schedule to the single project, requests + ปิดวัน globally", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    // Spec 300 U4: ของเข้า (incoming) is its own tile/route, split from คลัง.
    expect(screen.getByRole("link", { name: /ของเข้า/ })).toHaveAttribute(
      "href",
      "/projects/p1/incoming",
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
    expect(screen.getByRole("link", { name: /ตารางงาน/ })).toHaveAttribute("href", "/projects");
  });

  // Spec 375 U3: the คลัง tile is RETIRED. It became the left half of the
  // เบิกจากคลังหน้างาน custody pair (เบิกวัสดุ → the same /store route), so keeping
  // it here would be a SECOND door to one destination — the spec-313 U3 defect
  // that retired the ทีมงาน tile. Asserted as an ABSENCE, not merely deleted:
  // without this, re-adding the tile would restore the duplicate silently.
  it("no longer carries a คลัง tile — the custody pair owns that door", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.queryByRole("link", { name: /คลัง/ })).toBeNull();
    // ของเข้า is a DIFFERENT destination (receiving, spec 300 U4) and must survive
    // this removal — a regex on คลัง alone would not have caught deleting it too.
    expect(screen.getByRole("link", { name: /ของเข้า/ })).toHaveAttribute(
      "href",
      "/projects/p1/incoming",
    );
  });

  // Spec 313 U3: the ทีมงาน tile is RETIRED. U1 added it as the only way into
  // /team; the SA bar now carries a real ทีมงาน tab, so the tile was a duplicate
  // door competing with it for the same destination.
  it("no longer renders a ทีมงาน tile (the SA bar's tab owns /team now)", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.queryByRole("link", { name: /ทีมงาน/ })).toBeNull();
  });

  it("links the คู่มือ tile to the in-app help hub (spec 299 U1)", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.getByRole("link", { name: /คู่มือ/ })).toHaveAttribute("href", "/sa/help");
  });

  it("pulses ปิดวัน only after hours", () => {
    const { rerender } = render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.queryByTestId("close-pulse")).toBeNull();
    rerender(<SaTools primaryProjectId="p1" showCloseNudge />);
    expect(screen.getByTestId("close-pulse")).toBeInTheDocument();
  });

  it("shows truthful tile subtitles — promises no action the destination lacks", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    // ของเข้า (spec 300 U4): the incoming-deliveries surface — กำลังมา + รับของ.
    expect(screen.getByText("กำลังมา · รับของ")).toBeInTheDocument();
    // Spec 375 U3: the คลัง tile and its "สต๊อก · ตรวจนับ" subtitle are gone —
    // the custody pair owns that door now. The absence pin lives in its own case
    // above; what remains here is that no tile in THIS grid offers a เบิก action,
    // which is still the truthful claim (the pair is a separate component).
    expect(screen.queryByText(/เบิก/)).toBeNull();
    // คำขอซื้อ: /requests is track-only — PR creation lives on the WP detail.
    expect(screen.getByText("ติดตามคำขอ")).toBeInTheDocument();
    // ปิดวัน: /sa/plan carries no report yet (spec 212 unbuilt) — plan only.
    expect(screen.getByText("แผนพรุ่งนี้")).toBeInTheDocument();
    expect(screen.queryByText(/รายงาน/)).toBeNull();
  });
});
