// Writing failing test first.
//
// Spec 197 U1 — คลัง becomes a per-project surface. The store stops being a
// global /settings drill-down reached through a project picker and becomes a
// project sub-route (/projects/[id]/store), reached from a header chip exactly
// like ตารางงาน / แผนจัดหา. This pins the testable contract of that move:
//   • a storeHref builder that nests the store under the project (one SSOT URL),
//   • STORE_LABEL = "คลัง" (the destination term, single-sourced),
//   • the bottom bar's settings tab no longer claims the legacy /store path
//     (the projects tab owns the new sub-route and lights on it),
//   • StoreManager can hide its project picker (the route supplies the project).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { storeHref } from "@/lib/nav/project-paths";
import { STORE_LABEL } from "@/lib/i18n/labels";
import { BottomTabBar, PM_TABS } from "@/components/features/chrome/bottom-tab-bar";
import { StoreManager } from "@/components/features/store/store-manager";

describe("spec 197 U1 — คลัง per-project surface", () => {
  it("storeHref nests the store under the project (no global /store)", () => {
    expect(storeHref("p1")).toBe("/projects/p1/store");
    expect(storeHref("p1")).not.toMatch(/^\/store/);
  });

  it("STORE_LABEL is the per-project destination term คลัง (SSOT)", () => {
    expect(STORE_LABEL).toBe("คลัง");
  });

  it("the settings tab no longer claims the legacy /store path", () => {
    const settingsTab = PM_TABS.find((t) => t.href === "/settings");
    expect(settingsTab?.match ?? []).not.toContain("/store");
  });

  it("lights the projects tab on a project's store sub-route", () => {
    mockUsePathname.mockReturnValue("/projects/abc/store");
    const { container } = render(<BottomTabBar role="site_admin" />);
    const active = container.querySelectorAll('[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.textContent).toContain("โครงการ");
  });

  it("hides the project picker when hidePicker is set (the route supplies the project)", () => {
    render(
      <StoreManager
        projects={[{ id: "p1", code: "PRC-2026-001", name: "บ้านคุณเอ" }]}
        selectedProjectId="p1"
        hidePicker
        onHand={[]}
        catalogItems={[]}
        suppliers={[]}
        canIssue={false}
        receipts={[]}
        counts={[]}
      />,
    );
    expect(screen.queryByLabelText("โครงการ")).toBeNull();
  });
});
