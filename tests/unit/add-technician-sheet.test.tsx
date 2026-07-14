// Writing failing test first.
//
// Spec 298 U2 — the /sa/crew "เพิ่มช่างใหม่" front door. One button opens an onboarding
// sheet that branches: มีมือถือ (self-serve QR the worker scans + keys their own bank —
// nothing bank touches the SA) / ไม่มีมือถือ (capture-blind add: identity + a REQUIRED
// passbook photo). This pins the branch UI, the required-photo gate, and the invariant
// that NO bank-account field is ever rendered to the SA.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AddTechnicianSheet } from "@/components/features/sa/add-technician-sheet";
import {
  ADD_TECHNICIAN_LABEL,
  ADD_TECHNICIAN_HAS_PHONE_LABEL,
  ADD_TECHNICIAN_NO_PHONE_LABEL,
  PASSBOOK_PHOTO_LABEL,
} from "@/lib/i18n/labels";

const projects = [{ id: "11111111-1111-4111-8111-111111111111", code: "TFM", name: "TFM Site" }];
const qrCards = [
  {
    project: { id: projects[0]!.id, name: "TFM Site" },
    url: "https://app.example/register/technician?project=abc",
    svg: "<svg data-testid='qr-svg'></svg>",
  },
];

function openSheet() {
  render(<AddTechnicianSheet projects={projects} qrCards={qrCards} />);
  fireEvent.click(screen.getByRole("button", { name: ADD_TECHNICIAN_LABEL }));
  return screen.getByRole("dialog");
}

describe("AddTechnicianSheet — spec 298 U2 front door", () => {
  it("opens the onboarding sheet from the add button, offering both branches", () => {
    const dialog = openSheet();
    expect(
      within(dialog).getByRole("button", { name: ADD_TECHNICIAN_HAS_PHONE_LABEL }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }),
    ).toBeVisible();
  });

  it("has-phone branch shows the project's self-onboard QR", () => {
    const dialog = openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_HAS_PHONE_LABEL }));
    expect(within(dialog).getByText(/register\/technician/)).toBeInTheDocument();
  });

  it("no-phone branch requires a passbook photo before the add is enabled", () => {
    const dialog = openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ/), { target: { value: "สมชาย ช่างดี" } });
    fireEvent.change(within(dialog).getByLabelText(/เลขบัตร/), {
      target: { value: "3201200000008" },
    });
    fireEvent.change(within(dialog).getByLabelText(/วันเกิด/), { target: { value: "1990-05-01" } });
    const submit = within(dialog).getByRole("button", { name: /เพิ่มช่างเข้าทีม/ });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(PASSBOOK_PHOTO_LABEL), {
      target: { files: [new File(["x"], "passbook.jpg", { type: "image/jpeg" })] },
    });
    expect(submit).toBeEnabled();
  });

  it("passbook input accepts gallery/file uploads, not camera-only (spec 298 §5 camera/upload)", () => {
    const dialog = openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    const input = within(dialog).getByLabelText(PASSBOOK_PHOTO_LABEL);
    // `capture` forces the camera on mobile and hides the gallery/file picker.
    expect(input).not.toHaveAttribute("capture");
    expect(input).toHaveAttribute("accept", "image/*");
  });

  it("never renders a bank-account field on the SA surface (capture-blind)", () => {
    const dialog = openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    // No bank-account INPUT (number / holder name) — the passbook PHOTO is the only
    // bank-adjacent field, and it's a capture, not a value the SA reads or keys.
    // (Checks fields, not prose — the hint copy may mention that the PM fills the number.)
    expect(within(dialog).queryByLabelText(/เลขบัญชี|เลขที่บัญชี|ชื่อบัญชี/)).toBeNull();
  });
});
