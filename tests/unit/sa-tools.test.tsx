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
    expect(screen.getByRole("link", { name: /คลัง/ })).toHaveAttribute(
      "href",
      "/projects/p1/store",
    );
    // Spec 307 follow-up 2: the คลัง (store) tile uses the Warehouse icon — the same
    // store symbol as the project-page คลัง chip (page.tsx) — not a Box.
    expect(
      screen.getByRole("link", { name: /คลัง/ }).querySelector("svg.lucide-warehouse"),
    ).not.toBeNull();
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

  it("links the ทีมงาน tile to the crew/onboarding page", () => {
    render(<SaTools primaryProjectId="p1" showCloseNudge={false} />);
    expect(screen.getByRole("link", { name: /ทีมงาน/ })).toHaveAttribute("href", "/sa/crew");
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
    // คลัง: spec 208 relocated เบิก to the WP-detail เบิกของ tab; deliveries moved to
    // ของเข้า (spec 300 U4), so the store console now offers stock + ตรวจนับ only.
    expect(screen.getByText("สต๊อก · ตรวจนับ")).toBeInTheDocument();
    expect(screen.queryByText(/เบิก/)).toBeNull();
    // คำขอซื้อ: /requests is track-only — PR creation lives on the WP detail.
    expect(screen.getByText("ติดตามคำขอ")).toBeInTheDocument();
    // ปิดวัน: /sa/plan carries no report yet (spec 212 unbuilt) — plan only.
    expect(screen.getByText("แผนพรุ่งนี้")).toBeInTheDocument();
    expect(screen.queryByText(/รายงาน/)).toBeNull();
  });
});
