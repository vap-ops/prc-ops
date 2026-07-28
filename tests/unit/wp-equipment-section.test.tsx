// Spec 363 U7 — the WP ของ-tab เครื่องมือ section: out-loans with the aging
// clock + คืน, the ยืมเครื่องมือ door, and the 370 D4 evidence gate (submit
// stays disabled until ≥1 condition photo exists, BOTH directions).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const checkOutEquipment = vi.fn();
const checkInEquipment = vi.fn();
vi.mock("@/lib/equipment/usage-actions", () => ({
  checkOutEquipment: (...a: unknown[]) => checkOutEquipment(...a),
  checkInEquipment: (...a: unknown[]) => checkInEquipment(...a),
}));

const uploadConditionPhotos = vi.fn();
vi.mock("@/lib/equipment/photo-upload", () => ({
  uploadConditionPhotos: (...a: unknown[]) => uploadConditionPhotos(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { WpEquipmentSection } from "@/components/features/equipment/wp-equipment-section";

const LOANS = [
  {
    logId: "log-1",
    itemId: "item-1",
    itemName: "สว่านโรตารี่ Hilti",
    holderName: "สมชาย ใจดี",
    checkedOutOn: "2026-07-20",
    days: 8,
    outPhotoUrls: ["https://signed/out1.jpg"],
  },
];

const AVAILABLE = [
  { id: "item-2", name: "เครื่องตัดไฟเบอร์", tracking: "unit" as const },
  { id: "item-3", name: "ปั๊มน้ำ", tracking: "unit" as const },
];

const BASE = {
  wpId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
  loans: LOANS,
  available: AVAILABLE,
  roster: [{ id: "w-1", name: "สมชาย ใจดี" }],
  canAct: true,
  revalidate: "/x",
};

beforeEach(() => {
  checkOutEquipment.mockReset().mockResolvedValue({ ok: true });
  checkInEquipment.mockReset().mockResolvedValue({ ok: true });
  uploadConditionPhotos.mockReset().mockResolvedValue({
    ok: true,
    paths: ["usage/u1/1.jpg"],
  });
});

describe("spec 363 U7 — เครื่องมือ section", () => {
  it("renders the open loan with name, holder, and the aging clock", () => {
    render(<WpEquipmentSection {...BASE} />);
    expect(screen.getByText("สว่านโรตารี่ Hilti")).toBeInTheDocument();
    expect(screen.getByText(/สมชาย ใจดี/)).toBeInTheDocument();
    expect(screen.getByText(/ยืม 8 วัน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คืน" })).toBeInTheDocument();
  });

  it("read-only viewers get the list but neither door", () => {
    render(<WpEquipmentSection {...BASE} canAct={false} />);
    expect(screen.getByText("สว่านโรตารี่ Hilti")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "คืน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืมเครื่องมือ" })).not.toBeInTheDocument();
  });

  it("day 0 reads ยืมวันนี้, not ยืม 0 วัน", () => {
    render(<WpEquipmentSection {...BASE} loans={[{ ...LOANS[0]!, days: 0 }]} />);
    expect(screen.getByText(/ยืมวันนี้/)).toBeInTheDocument();
  });

  it("ยืมเครื่องมือ: submit stays DISABLED with an item picked but zero photos (370 D4)", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    const submit = screen.getByRole("button", { name: "ยืมออก" });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(checkOutEquipment).not.toHaveBeenCalled();
  });

  it("with a photo attached the borrow submits via wp_tab with the uploaded paths", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/รูปสภาพก่อนยืม/, { selector: "input" });
    await waitFor(() => fireEvent.change(input, { target: { files: [file] } }));
    await waitFor(() => expect(uploadConditionPhotos).toHaveBeenCalled());

    const submit = screen.getByRole("button", { name: "ยืมออก" });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(checkOutEquipment).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "item-2",
          workPackageId: BASE.wpId,
          via: "wp_tab",
          photoPaths: ["usage/u1/1.jpg"],
        }),
      ),
    );
  });

  it("คืน: shows the before-photos, submit disabled until a photo, then submits via wp_tab against the ORIGINAL log id", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "คืน" }));

    expect(screen.getByAltText(/รูปตอนยืม/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "บันทึกการคืน" });
    expect(submit).toBeDisabled();

    const file = new File(["x"], "b.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/รูปสภาพตอนคืน/, { selector: "input" });
    await waitFor(() => fireEvent.change(input, { target: { files: [file] } }));
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(checkInEquipment).toHaveBeenCalledWith(
        expect.objectContaining({
          logId: "log-1",
          via: "wp_tab",
          photoPaths: ["usage/u1/1.jpg"],
        }),
      ),
    );
  });

  it("no available units → the borrow sheet says so instead of an empty list", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} available={[]} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    expect(screen.getByText(/ไม่มีอุปกรณ์ว่างในโครงการ/)).toBeInTheDocument();
  });

  it("a failed upload keeps submit disabled and surfaces the error", async () => {
    uploadConditionPhotos.mockResolvedValue({ ok: false, error: "อัปโหลดไม่สำเร็จ" });
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/รูปสภาพก่อนยืม/, { selector: "input" });
    await waitFor(() => fireEvent.change(input, { target: { files: [file] } }));
    await waitFor(() => expect(screen.getByText(/อัปโหลดไม่สำเร็จ/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "ยืมออก" })).toBeDisabled();
  });
});
