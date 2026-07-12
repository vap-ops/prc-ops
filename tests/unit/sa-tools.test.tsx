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
    // คลัง: spec 208 relocated เบิก to the WP-detail เบิกของ tab; the store console
    // now offers รับเข้า + ตรวจนับ only.
    expect(screen.getByText("รับเข้า · ตรวจนับ")).toBeInTheDocument();
    expect(screen.queryByText(/เบิก/)).toBeNull();
    // คำขอซื้อ: /requests is track-only — PR creation lives on the WP detail.
    expect(screen.getByText("ติดตามคำขอ")).toBeInTheDocument();
    // ปิดวัน: /sa/plan carries no report yet (spec 212 unbuilt) — plan only.
    expect(screen.getByText("แผนพรุ่งนี้")).toBeInTheDocument();
    expect(screen.queryByText(/รายงาน/)).toBeNull();
  });
});
