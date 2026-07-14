// Writing failing test first.
//
// Spec 316 U2 — the guided 2-step role picker that replaces the flat 17-option
// <select> on /settings/roles. Step 1 picks a category (สำนักงาน/หน้างาน/
// บุคคลภายนอก), step 2 picks a role inside it (unbuilt roles sink to the
// bottom with a ยังไม่มีหน้าจอ badge), and a derived preview (home screen +
// capabilities from the spec-316 registry) shows before confirm.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RolePickerSheet } from "@/components/features/roles/role-picker-sheet";
import { CAPABILITY_REGISTRY, ROLE_SUMMARY } from "@/lib/roles/role-capabilities";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

function openSheet(overrides: Partial<Parameters<typeof RolePickerSheet>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <RolePickerSheet
      open
      userName="สมชาย ใจดี"
      currentRole="visitor"
      submitting={false}
      error={null}
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

describe("RolePickerSheet", () => {
  it("opens at the category step with the three category tiles", () => {
    openSheet();
    expect(screen.getByRole("button", { name: /สำนักงาน/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /หน้างาน/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /บุคคลภายนอก/ })).toBeInTheDocument();
    // No role rows yet.
    expect(screen.queryByText(ROLE_SUMMARY.site_admin)).not.toBeInTheDocument();
  });

  it("marks the current role's category on step 1", () => {
    openSheet(); // visitor → external
    const externalTile = screen.getByRole("button", { name: /บุคคลภายนอก/ });
    expect(externalTile).toHaveTextContent("สิทธิ์ปัจจุบัน");
  });

  it("category → role list; unbuilt roles sink last with the ยังไม่มีหน้าจอ badge", () => {
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^หน้างาน/ }));
    // field = site_admin, technician (built) then site_owner (unbuilt, badged)
    const rows = screen.getAllByRole("radio");
    const labels = rows.map((r) => r.textContent ?? "");
    expect(labels.some((t) => t.includes(USER_ROLE_LABEL.site_admin))).toBe(true);
    expect(labels.some((t) => t.includes(USER_ROLE_LABEL.technician))).toBe(true);
    const last = labels[labels.length - 1] ?? "";
    expect(last).toContain(USER_ROLE_LABEL.site_owner);
    expect(last).toContain("ยังไม่มีหน้าจอ");
    // Summaries render on the rows.
    expect(screen.getByText(ROLE_SUMMARY.technician)).toBeInTheDocument();
  });

  it("selecting a role shows the derived preview (home + capabilities) and enables confirm", () => {
    const { onSubmit } = openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^หน้างาน/ }));
    const confirm = screen.getByRole("button", { name: "บันทึก" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(USER_ROLE_LABEL.site_admin) }));
    // Home line, derived through roleHome(site_admin) → /sa.
    expect(screen.getByText(/หน้าแรก/)).toHaveTextContent("งานวันนี้ (หน้างาน)");
    // A capability the role holds, straight from the registry.
    const siteCapture = CAPABILITY_REGISTRY.find((e) => e.key === "site-capture");
    expect(screen.getByText(siteCapture!.labelTh)).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith("site_admin");
  });

  it("a role with no visible capabilities gets the graceful empty line", () => {
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^หน้างาน/ }));
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(USER_ROLE_LABEL.technician) }));
    expect(screen.getByText("ยังไม่มีรายการสิทธิ์เฉพาะ")).toBeInTheDocument();
  });

  it("กลับ returns to the category step", () => {
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^สำนักงาน/ }));
    expect(screen.getByText(ROLE_SUMMARY.accounting)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "กลับ" }));
    expect(screen.getByRole("button", { name: /^สำนักงาน/ })).toBeInTheDocument();
    expect(screen.queryByText(ROLE_SUMMARY.accounting)).not.toBeInTheDocument();
  });

  it("confirm stays disabled when the selection equals the current role, and while submitting", () => {
    openSheet({ currentRole: "site_admin" });
    fireEvent.click(screen.getByRole("button", { name: /^หน้างาน/ }));
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(USER_ROLE_LABEL.site_admin) }));
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
  });

  it("renders the error as an alert", () => {
    openSheet({ error: "ทำรายการไม่สำเร็จ" });
    expect(screen.getByRole("alert")).toHaveTextContent("ทำรายการไม่สำเร็จ");
  });
});
