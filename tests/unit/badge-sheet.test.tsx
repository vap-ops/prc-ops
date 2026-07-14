// Spec 306 U1 — printable badge sheet. Renders per-project badge cards (name +
// PRC code + pre-rendered QR SVG) and a print trigger. The QR SVG is built
// server-side (same dangerouslySetInnerHTML pattern as the /sa/crew onboard QR).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BadgeSheet } from "@/components/features/sa/badge-sheet";

const groups = [
  {
    project: { id: "p1", code: "PRC-2026-004", name: "TFM โพธิ์ทอง" },
    badges: [
      { workerId: "w1", name: "สมชาย", code: "PRC-26-0002", svg: "<svg data-qr='w1'></svg>" },
      { workerId: "w2", name: "สมศักดิ์", code: null, svg: "<svg data-qr='w2'></svg>" },
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BadgeSheet", () => {
  it("renders a card per worker with name, PRC code and QR", () => {
    render(<BadgeSheet groups={groups} />);
    expect(screen.getByText("สมชาย")).toBeInTheDocument();
    expect(screen.getByText("PRC-26-0002")).toBeInTheDocument();
    expect(screen.getByText("TFM โพธิ์ทอง")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-qr]")).toHaveLength(2);
  });

  it("shows a dash fallback when the PRC code is missing", () => {
    render(<BadgeSheet groups={groups} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("print button calls window.print", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<BadgeSheet groups={groups} />);
    await userEvent.click(screen.getByRole("button", { name: /พิมพ์/ }));
    expect(printSpy).toHaveBeenCalledOnce();
  });
});
