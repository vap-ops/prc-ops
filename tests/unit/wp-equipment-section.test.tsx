// Spec 363 U7 — the WP ของ-tab เครื่องมือ section: out-loans with the aging
// clock + คืน, the ยืมเครื่องมือ door, and the 370 D4 evidence gate. The state
// findings from the fresh-eyes pass are pinned here: เปลี่ยน discards the
// previous item's photos, a close-mid-upload resolution is dropped (epoch), and
// each sheet owns its own error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const checkOutEquipment = vi.fn();
const checkInEquipment = vi.fn();
const fetchLoanPhotoUrls = vi.fn();
vi.mock("@/lib/equipment/usage-actions", () => ({
  checkOutEquipment: (...a: unknown[]) => checkOutEquipment(...a),
  checkInEquipment: (...a: unknown[]) => checkInEquipment(...a),
  fetchLoanPhotoUrls: (...a: unknown[]) => fetchLoanPhotoUrls(...a),
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
  wpComplete: false,
  revalidate: "/x",
};

const pickFile = (label: RegExp) => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const input = screen.getByLabelText(label, { selector: "input" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  checkOutEquipment.mockReset().mockResolvedValue({ ok: true });
  checkInEquipment.mockReset().mockResolvedValue({ ok: true });
  fetchLoanPhotoUrls.mockReset().mockResolvedValue({ ok: true, urls: ["https://signed/out1.jpg"] });
  uploadConditionPhotos.mockReset().mockResolvedValue({ ok: true, paths: ["usage/u1/1.jpg"] });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
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

  it("a COMPLETE WP hides the borrow door but keeps คืน (mirrors the RPCs' guards)", () => {
    render(<WpEquipmentSection {...BASE} wpComplete={true} />);
    expect(screen.queryByRole("button", { name: "ยืมเครื่องมือ" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "คืน" })).toBeInTheDocument();
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
    pickFile(/รูปสภาพก่อนยืม/);
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

  it("เปลี่ยน DISCARDS the previous item's photos — submit re-disables (fresh-eyes 🔴3)", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    pickFile(/รูปสภาพก่อนยืม/);
    await waitFor(() => expect(screen.getByRole("button", { name: "ยืมออก" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "เปลี่ยน" }));
    await user.click(screen.getByRole("button", { name: /ปั๊มน้ำ/ }));
    expect(screen.getByRole("button", { name: "ยืมออก" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "ยืมออก" }));
    expect(checkOutEquipment).not.toHaveBeenCalled();
  });

  it("an upload resolving AFTER the sheet closed is dropped — reopening starts clean (fresh-eyes 🔴2)", async () => {
    let resolveUpload!: (v: unknown) => void;
    uploadConditionPhotos.mockImplementation(() => new Promise((r) => (resolveUpload = r)));
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    pickFile(/รูปสภาพก่อนยืม/);
    fireEvent.keyDown(document, { key: "Escape" });
    resolveUpload({ ok: true, paths: ["usage/GHOST/1.jpg"] });
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /ปั๊มน้ำ/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "ยืมออก" })).toBeDisabled());
    expect(screen.queryByAltText(/รูปสภาพก่อนยืม 1/)).not.toBeInTheDocument();
  });

  it("คืน: fetches before-photos ON OPEN, submit disabled until a photo, then submits via wp_tab on the ORIGINAL log id", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "คืน" }));
    expect(fetchLoanPhotoUrls).toHaveBeenCalledWith("log-1");
    await waitFor(() => expect(screen.getByAltText(/รูปตอนยืม 1/)).toBeInTheDocument());

    const submit = screen.getByRole("button", { name: "บันทึกการคืน" });
    expect(submit).toBeDisabled();
    pickFile(/รูปสภาพตอนคืน/);
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

  it("a loan with no borrow photos says so instead of an empty strip", async () => {
    fetchLoanPhotoUrls.mockResolvedValue({ ok: true, urls: [] });
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "คืน" }));
    await waitFor(() => expect(screen.getByText(/ไม่มีรูปตอนยืม/)).toBeInTheDocument());
  });

  it("a borrow failure never bleeds into the คืน sheet (per-sheet errors, fresh-eyes 🟡7)", async () => {
    checkOutEquipment.mockResolvedValue({ ok: false, error: "ยืมพัง" });
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    pickFile(/รูปสภาพก่อนยืม/);
    await waitFor(() => expect(screen.getByRole("button", { name: "ยืมออก" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "ยืมออก" }));
    await waitFor(() => expect(screen.getByText("ยืมพัง")).toBeInTheDocument());
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: "คืน" }));
    expect(screen.queryByText("ยืมพัง")).not.toBeInTheDocument();
  });

  it("no available units → the borrow sheet says so instead of an empty list", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} available={[]} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    expect(screen.getByText(/ไม่มีอุปกรณ์ว่างในโครงการ/)).toBeInTheDocument();
  });

  it("a search with no hits says so", async () => {
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.type(screen.getByLabelText("ค้นหาเครื่องมือ"), "zzzzz");
    expect(screen.getByText(/ไม่พบเครื่องมือชื่อนี้/)).toBeInTheDocument();
  });

  it("a failed upload keeps submit disabled and surfaces the error", async () => {
    uploadConditionPhotos.mockResolvedValue({ ok: false, error: "อัปโหลดไม่สำเร็จ" });
    const user = userEvent.setup();
    render(<WpEquipmentSection {...BASE} />);
    await user.click(screen.getByRole("button", { name: "ยืมเครื่องมือ" }));
    await user.click(screen.getByRole("button", { name: /เครื่องตัดไฟเบอร์/ }));
    pickFile(/รูปสภาพก่อนยืม/);
    await waitFor(() => expect(screen.getByText(/อัปโหลดไม่สำเร็จ/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "ยืมออก" })).toBeDisabled();
  });
});
