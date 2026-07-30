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

  // Spec 376 U5: the หน้างาน (field) category no longer HAS an unbuilt role —
  // site_admin, technician and site_owner are all served now — so the badge half
  // of this case moved to สำนักงาน below, where hr / subcon_manager / auditor still
  // sink. Splitting them keeps both halves real: a category with no unbuilt member
  // can never prove the sink, and asserting the sink here would have quietly
  // become vacuous the moment U5 landed.
  it("category → role list, with summaries on the rows", () => {
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^หน้างาน/ }));
    const labels = screen.getAllByRole("radio").map((r) => r.textContent ?? "");
    expect(labels.some((t) => t.includes(USER_ROLE_LABEL.site_admin))).toBe(true);
    expect(labels.some((t) => t.includes(USER_ROLE_LABEL.technician))).toBe(true);
    expect(labels.some((t) => t.includes(USER_ROLE_LABEL.site_owner))).toBe(true);
    // Every field role is built now, so NONE of them may carry the badge.
    expect(labels.filter((t) => t.includes("ยังไม่มีหน้าจอ"))).toEqual([]);
    // Summaries render on the rows.
    expect(screen.getByText(ROLE_SUMMARY.technician)).toBeInTheDocument();
  });

  it("unbuilt roles sink last with the ยังไม่มีหน้าจอ badge", () => {
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: /^สำนักงาน/ }));
    const labels = screen.getAllByRole("radio").map((r) => r.textContent ?? "");
    // office ends with the still-unbuilt trio (hr, subcon_manager, auditor).
    const last = labels[labels.length - 1] ?? "";
    expect(last).toContain("ยังไม่มีหน้าจอ");
    // …and the built office roles are above them, unbadged.
    const firstBadged = labels.findIndex((t) => t.includes("ยังไม่มีหน้าจอ"));
    expect(firstBadged).toBeGreaterThan(0);
    expect(labels.slice(0, firstBadged).some((t) => t.includes("ยังไม่มีหน้าจอ"))).toBe(false);
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
