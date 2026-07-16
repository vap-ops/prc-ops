// Spec 321 U3b — ProfileContactSection: the read-only + edit-in-bottom-sheet
// wrapper for the CONTACT block on detail/home pages (operator decision 6),
// covering the three divergent audiences (worker / staff / contractor) with one
// shared shell + each audience's existing, validated form body. Read card shows
// the current values; the edit form only appears inside the sheet on แก้ไข.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/portal/actions", () => ({
  updateOwnWorkerProfile: vi.fn(),
  updateOwnContactInfo: vi.fn(),
}));
vi.mock("@/app/settings/my-info/actions", () => ({ updateOwnStaffContact: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { ProfileContactSection } from "@/components/features/profile/profile-contact-section";

describe("ProfileContactSection — read card + edit-in-sheet (decision 6)", () => {
  it("worker: shows contact + emergency as a read card, form hidden until แก้ไข", () => {
    render(
      <ProfileContactSection
        audience="worker"
        current={{
          phone: "0810000000",
          email: "wa@e.local",
          emergencyName: "แม่ ทดสอบ",
          emergencyRelation: "แม่",
          emergencyPhone: "0899999999",
        }}
      />,
    );
    expect(screen.getByText("0810000000")).toBeInTheDocument();
    expect(screen.getByText("wa@e.local")).toBeInTheDocument();
    expect(screen.getByText("แม่ ทดสอบ")).toBeInTheDocument();
    // decision 6: no inline edit form before แก้ไข
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    expect(screen.queryAllByRole("textbox").length).toBeGreaterThan(0);
  });

  it("staff: read card omits an email row (staff contact has no email)", () => {
    render(
      <ProfileContactSection
        audience="staff"
        current={{
          phone: "0820000000",
          emergencyName: "พี่ ทดสอบ",
          emergencyRelation: "พี่สาว",
          emergencyPhone: "0888888888",
        }}
      />,
    );
    expect(screen.getByText("0820000000")).toBeInTheDocument();
    expect(screen.getByText("พี่ ทดสอบ")).toBeInTheDocument();
    expect(screen.queryByText("อีเมล")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("contractor: read card shows business-contact fields (contact person + address), no emergency", () => {
    render(
      <ProfileContactSection
        audience="contractor"
        current={{
          phone: "0830000000",
          email: "ct@e.local",
          contactPerson: "คุณ ผู้ติดต่อ",
          mailingAddress: "123 ถนนทดสอบ",
        }}
      />,
    );
    expect(screen.getByText("คุณ ผู้ติดต่อ")).toBeInTheDocument();
    expect(screen.getByText("123 ถนนทดสอบ")).toBeInTheDocument();
    expect(screen.queryByText("เบอร์โทรฉุกเฉิน")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    expect(screen.queryAllByRole("textbox").length).toBeGreaterThan(0);
  });
});
