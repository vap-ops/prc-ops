// Writing failing test first.
//
// Spec 167: the WP detail page becomes a segmented-tab surface. WpDetailTabs is
// the client switcher — it renders a WAI-ARIA tablist, shows ONE panel at a time
// (inactive panels stay MOUNTED via `hidden` so a half-typed form and the single
// server fetch survive a switch — spec 147), defaults to the first tab, and
// answers a deep-link hash (the pending-requests chip → คำขอซื้อ).

import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WpDetailTabs } from "@/components/features/work-packages/wp-detail-tabs";

const TABS = [
  { key: "photos", label: "รูปถ่าย", panel: <p>PHOTO ZONE</p> },
  { key: "purchases", label: "คำขอซื้อ", panel: <p>PURCHASE FORMS</p> },
  { key: "labor", label: "แรงงาน", panel: <p>LABOR ZONE</p> },
  { key: "info", label: "ข้อมูล", panel: <p>NOTES</p> },
];

afterEach(() => {
  window.location.hash = "";
});

const tab = (name: string) => screen.getByRole("tab", { name });
const panelOf = (text: string) => screen.getByText(text).closest('[role="tabpanel"]');

describe("WpDetailTabs", () => {
  it("renders one tab per section and defaults to the first", () => {
    render(<WpDetailTabs tabs={TABS} />);
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(tab("รูปถ่าย")).toHaveAttribute("aria-selected", "true");
    expect(tab("คำขอซื้อ")).toHaveAttribute("aria-selected", "false");
  });

  it("keeps every panel mounted, hiding the inactive ones", () => {
    render(<WpDetailTabs tabs={TABS} />);
    // all panel content is mounted — preserves form state + the single fetch
    expect(screen.getByText("PHOTO ZONE")).toBeInTheDocument();
    expect(screen.getByText("LABOR ZONE")).toBeInTheDocument();
    // but only the active panel is visible
    expect(panelOf("PHOTO ZONE")).not.toHaveAttribute("hidden");
    expect(panelOf("LABOR ZONE")).toHaveAttribute("hidden");
  });

  it("switches the active panel on tab click", () => {
    render(<WpDetailTabs tabs={TABS} />);
    fireEvent.click(tab("แรงงาน"));
    expect(tab("แรงงาน")).toHaveAttribute("aria-selected", "true");
    expect(tab("รูปถ่าย")).toHaveAttribute("aria-selected", "false");
    expect(panelOf("LABOR ZONE")).not.toHaveAttribute("hidden");
    expect(panelOf("PHOTO ZONE")).toHaveAttribute("hidden");
  });

  it("answers a deep-link hash → opens the mapped tab", () => {
    render(<WpDetailTabs tabs={TABS} hashTabMap={{ "wp-requests": "purchases" }} />);
    expect(tab("คำขอซื้อ")).toHaveAttribute("aria-selected", "false");
    act(() => {
      window.location.hash = "#wp-requests";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(tab("คำขอซื้อ")).toHaveAttribute("aria-selected", "true");
  });
});
