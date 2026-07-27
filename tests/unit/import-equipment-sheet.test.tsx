// Spec 367 U3b — the import sheet's one safety property.
//
// นำเข้า must be unreachable until ตรวจสอบ came back clean. Without that the
// operator can paste 64 rows assembled over hours and write them in one tap
// with nothing reviewed — and the parser's refusals (unknown id, invented
// taxonomy, money) would only surface as a wall of errors AFTER the attempt.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportEquipmentSheet } from "@/components/features/equipment/import-equipment-sheet";

const importEquipmentCsv = vi.fn();
vi.mock("@/app/equipment/actions", () => ({
  importEquipmentCsv: (...args: unknown[]) => importEquipmentCsv(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const open = async (): Promise<void> => {
  await userEvent.click(screen.getAllByRole("button", { name: "นำเข้า CSV" })[0]!);
};
const paste = async (text: string): Promise<void> => {
  await userEvent.type(screen.getByLabelText("ข้อมูล CSV"), text);
};

describe("import sheet — commit is gated on a clean preview", () => {
  beforeEach(() => {
    importEquipmentCsv.mockReset();
  });

  it("keeps นำเข้า disabled before any ตรวจสอบ", async () => {
    render(<ImportEquipmentSheet />);
    await open();
    await paste("header");
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeDisabled();
  });

  it("keeps นำเข้า disabled when the preview returned errors", async () => {
    importEquipmentCsv.mockResolvedValue({
      ok: false,
      inserts: 0,
      updates: 0,
      errors: ['แถว 1: ไม่รู้จักหมวดหมู่ "พิมพ์ผิด"'],
    });
    render(<ImportEquipmentSheet />);
    await open();
    await paste("header");
    await userEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));

    await waitFor(() => {
      expect(screen.getByText(/ไม่รู้จักหมวดหมู่/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeDisabled();
  });

  it("enables นำเข้า only after a clean preview, and previews with dryRun", async () => {
    importEquipmentCsv.mockResolvedValue({ ok: true, inserts: 3, updates: 61, errors: [] });
    render(<ImportEquipmentSheet />);
    await open();
    await paste("header");
    await userEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));

    await waitFor(() => {
      expect(screen.getByText(/เพิ่ม 3 รายการ/)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeEnabled();
    // The preview must NOT have written: dryRun true on the first call.
    expect(importEquipmentCsv).toHaveBeenCalledWith(expect.any(String), { dryRun: true });
  });

  // Editing after a clean preview invalidates it — otherwise the operator could
  // preview one file and commit a different one.
  it("re-disables นำเข้า when the pasted text changes after a clean preview", async () => {
    importEquipmentCsv.mockResolvedValue({ ok: true, inserts: 1, updates: 0, errors: [] });
    render(<ImportEquipmentSheet />);
    await open();
    await paste("header");
    await userEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "นำเข้า" })).toBeEnabled());

    await paste("x");
    expect(screen.getByRole("button", { name: "นำเข้า" })).toBeDisabled();
  });
});
