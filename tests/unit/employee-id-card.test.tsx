// Writing failing test first.
//
// Spec 291 U2 (TASK 7) — EmployeeIdCard is a presentational render of the
// ProfileCard loaded by loadProfileCard (src/lib/profile/load-profile-card.ts):
// identity + STATUSES ONLY. Pins:
// - approved/pending registration renders the full card with a status badge
//   (reusing registrationStatusBadge's label/tone — same mapper the existing
//   e-employee-card uses);
// - registration: null (a directly-assigned internal role, e.g. super_admin)
//   still renders the full "issued" card, just with no registration badge;
// - rejected renders ONLY the "contact admin" message — no card body, no
//   employee-id pill;
// - PDPA consent renders as a STATUS line only (given/revoked), never a value;
//   consent: null renders no PDPA line at all.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmployeeIdCard } from "@/components/features/profile/employee-id-card";
import { registrationStatusBadge } from "@/lib/register/card-view";
import { USER_ROLE_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import type { ProfileCard } from "@/lib/profile/load-profile-card";

const BASE: ProfileCard = {
  fullName: "สมชาย ใจดี",
  role: "site_admin",
  avatarUrl: "https://line.example/avatar.png",
  departmentName: "ฝ่ายก่อสร้าง",
  employeeId: "PRC-26-0001",
  registration: { status: "approved" },
  pdpaConsent: null,
};

describe("EmployeeIdCard — approved registration", () => {
  it("renders name, role label, department, employee-id pill, and the approved badge", () => {
    render(<EmployeeIdCard card={BASE} />);

    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getAllByText(USER_ROLE_LABEL.site_admin).length).toBeGreaterThan(0);
    expect(screen.getByText("ฝ่ายก่อสร้าง")).toBeInTheDocument();
    expect(screen.getByText("รหัส PRC-26-0001")).toBeInTheDocument();

    const badge = registrationStatusBadge("approved");
    expect(screen.getByText(badge.label)).toBeInTheDocument();
  });
});

describe("EmployeeIdCard — registration: null (directly-assigned internal role)", () => {
  it("renders the full issued card with no registration badge, no crash", () => {
    const card: ProfileCard = { ...BASE, registration: null, employeeId: null };
    render(<EmployeeIdCard card={card} />);

    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("ฝ่ายก่อสร้าง")).toBeInTheDocument();
    for (const status of ["pending", "approved", "rejected"] as const) {
      const badge = registrationStatusBadge(status);
      expect(screen.queryByText(badge.label)).not.toBeInTheDocument();
    }
  });
});

describe("EmployeeIdCard — pending registration", () => {
  it("renders the provisional (pending) badge", () => {
    const card: ProfileCard = { ...BASE, registration: { status: "pending" } };
    render(<EmployeeIdCard card={card} />);

    const badge = registrationStatusBadge("pending");
    expect(screen.getByText(badge.label)).toBeInTheDocument();
  });
});

describe("EmployeeIdCard — rejected registration", () => {
  it("renders only the contact-admin message — no card body", () => {
    const card: ProfileCard = { ...BASE, registration: { status: "rejected" } };
    render(<EmployeeIdCard card={card} />);

    expect(screen.getByText("การลงทะเบียนไม่ผ่าน โปรดติดต่อผู้ดูแล")).toBeInTheDocument();
    expect(screen.queryByText("รหัส PRC-26-0001")).not.toBeInTheDocument();
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
  });
});

describe("EmployeeIdCard — PDPA consent status line", () => {
  it("shows the given-consent line with the Thai-formatted date", () => {
    const card: ProfileCard = {
      ...BASE,
      pdpaConsent: { status: "given", at: "2026-07-01T00:00:00Z" },
    };
    render(<EmployeeIdCard card={card} />);

    const expectedDate = formatThaiDate("2026-07-01T00:00:00Z");
    expect(screen.getByText(`ยินยอม PDPA · ให้แล้ว ${expectedDate}`)).toBeInTheDocument();
  });

  it("shows the revoked-consent line with no date/value", () => {
    const card: ProfileCard = {
      ...BASE,
      pdpaConsent: { status: "revoked", at: "2026-07-01T00:00:00Z" },
    };
    render(<EmployeeIdCard card={card} />);

    expect(screen.getByText("ยินยอม PDPA · เพิกถอนแล้ว")).toBeInTheDocument();
  });

  it("renders no PDPA line when consent is null", () => {
    render(<EmployeeIdCard card={BASE} />);
    expect(screen.queryByText(/ยินยอม PDPA/)).not.toBeInTheDocument();
  });
});
