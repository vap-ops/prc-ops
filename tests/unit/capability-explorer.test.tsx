// Writing failing test first.
//
// Spec 316 U3 — CapabilityExplorer: the /settings/roles/capabilities client
// island. Two lenses over the spec-316 registry (ตามบทบาท = per-role accordion
// under category headers; ตามสิทธิ์ = per-capability under domain headers) plus
// a search box that filters both (non-matching accordions unmount). All content
// is static registry data — no DB.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CapabilityExplorer } from "@/components/features/roles/capability-explorer";
import {
  CAPABILITY_REGISTRY,
  ROLE_CATEGORY_LABEL,
  ROLE_SUMMARY,
} from "@/lib/roles/role-capabilities";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const ALL_ROLE_LABELS = Object.values(USER_ROLE_LABEL);
const payrollEntry = CAPABILITY_REGISTRY.find((e) => e.key === "payroll")!;
const hiddenEntry = CAPABILITY_REGISTRY.find((e) => e.key === "external")!;

describe("CapabilityExplorer", () => {
  it("by-role lens (default): three category headers, every role present with its summary", () => {
    render(<CapabilityExplorer />);
    for (const label of Object.values(ROLE_CATEGORY_LABEL)) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    for (const label of ALL_ROLE_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(ROLE_SUMMARY.site_admin)).toBeInTheDocument();
  });

  it("lens switch → by-capability: domain headers + capability labels, hidden entries never render", () => {
    render(<CapabilityExplorer />);
    fireEvent.click(screen.getByRole("button", { name: "ตามสิทธิ์" }));
    expect(screen.getByText(payrollEntry.labelTh)).toBeInTheDocument();
    expect(screen.queryByText(hiddenEntry.labelTh)).not.toBeInTheDocument();
    // Member chips pinned INSIDE the payroll entry's accordion — dropping
    // procurement from PAYROLL_ROLES must fail here, not just anywhere on page.
    const payrollDetails = screen.getByText(payrollEntry.labelTh).closest("details");
    expect(payrollDetails).not.toBeNull();
    expect(
      within(payrollDetails as HTMLElement).getByText(USER_ROLE_LABEL.procurement),
    ).toBeInTheDocument();
  });

  it("search filters the by-capability lens; clearing restores", () => {
    render(<CapabilityExplorer />);
    fireEvent.click(screen.getByRole("button", { name: "ตามสิทธิ์" }));
    const box = screen.getByPlaceholderText("ค้นหา…");
    fireEvent.change(box, { target: { value: "ค่าแรง" } });
    expect(screen.getByText(payrollEntry.labelTh)).toBeInTheDocument();
    expect(
      screen.queryByText(CAPABILITY_REGISTRY.find((e) => e.key === "legal")!.labelTh),
    ).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: "" } });
    expect(
      screen.getByText(CAPABILITY_REGISTRY.find((e) => e.key === "legal")!.labelTh),
    ).toBeInTheDocument();
  });

  it("search filters the by-role lens on role label + summary", () => {
    render(<CapabilityExplorer />);
    fireEvent.change(screen.getByPlaceholderText("ค้นหา…"), {
      target: { value: USER_ROLE_LABEL.accounting },
    });
    expect(screen.getAllByText(USER_ROLE_LABEL.accounting).length).toBeGreaterThan(0);
    expect(screen.queryByText(ROLE_SUMMARY.site_admin)).not.toBeInTheDocument();
    expect(screen.queryByText("ไม่พบรายการ")).not.toBeInTheDocument();
  });

  it("by-role search matches the SUMMARY branch too (not just the role label)", () => {
    render(<CapabilityExplorer />);
    // "ถ่ายรูป" appears only in site_admin's ROLE_SUMMARY, not any role label.
    fireEvent.change(screen.getByPlaceholderText("ค้นหา…"), { target: { value: "ถ่ายรูป" } });
    expect(screen.getAllByText(USER_ROLE_LABEL.site_admin).length).toBeGreaterThan(0);
    expect(screen.queryByText(ROLE_SUMMARY.accounting)).not.toBeInTheDocument();
  });

  it("search is case-insensitive over Latin substrings (csv → CSV export entry)", () => {
    render(<CapabilityExplorer />);
    fireEvent.click(screen.getByRole("button", { name: "ตามสิทธิ์" }));
    fireEvent.change(screen.getByPlaceholderText("ค้นหา…"), { target: { value: "csv" } });
    expect(
      screen.getByText(CAPABILITY_REGISTRY.find((e) => e.key === "purchase-report")!.labelTh),
    ).toBeInTheDocument();
    expect(screen.queryByText(payrollEntry.labelTh)).not.toBeInTheDocument();
  });

  it("no match → empty notice", () => {
    render(<CapabilityExplorer />);
    fireEvent.change(screen.getByPlaceholderText("ค้นหา…"), {
      target: { value: "ไม่มีจริงแน่นอน" },
    });
    expect(screen.getByText("ไม่พบรายการ")).toBeInTheDocument();
  });

  it("each role accordion carries its home screen line", () => {
    render(<CapabilityExplorer />);
    fireEvent.change(screen.getByPlaceholderText("ค้นหา…"), {
      target: { value: USER_ROLE_LABEL.site_admin },
    });
    expect(screen.getByText(/งานวันนี้ \(หน้างาน\)/)).toBeInTheDocument();
  });
});
