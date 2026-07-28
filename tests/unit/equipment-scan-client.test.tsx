// Spec 370 U2 — the scan screen's state machine: decode/search/deep-link →
// resolve → the right sheet; D4's photo gate on the borrow; the outcome
// stating itself in place with the item named.

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/muster/scanner-support", () => ({ hasScannerSupport: () => true }));
// The camera loop cannot run in jsdom; the mock exposes the raw-decode seam.
vi.mock("@/components/features/muster/muster-camera", () => ({
  MusterCamera: ({ onDetected }: { onDetected: (v: string) => void }) => (
    <button
      type="button"
      onClick={() =>
        onDetected("https://x.example/equipment/scan?item=1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a")
      }
    >
      MOCK-DECODE
    </button>
  ),
}));

import { EquipmentScanClient } from "@/components/features/equipment/equipment-scan-client";

const ITEMS = [
  {
    id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
    name: "สว่านโรตารี่",
    serialNo: "SN-99",
    assetTag: "EQ-01",
    tracking: "unit" as const,
  },
  {
    id: "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
    name: "เครื่องตัด",
    serialNo: null,
    assetTag: null,
    tracking: "unit" as const,
  },
  {
    id: "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c",
    name: "นั่งร้าน",
    serialNo: null,
    assetTag: null,
    tracking: "bulk" as const,
  },
];

const LOANS = [
  {
    logId: "L2",
    itemId: "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
    wpId: "wp-1",
    wpCode: "W01-01",
    wpName: "งานเหล็ก",
    checkedOutOn: "2026-07-25",
    holderName: "สมชาย",
  },
];

const BASE = {
  items: ITEMS,
  openLoans: LOANS,
  itemProjects: { "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a": "p-1" },
  leafWps: [
    { id: "wp-a", projectId: "p-1", code: "W05-03", name: "งานผนัง" },
    { id: "wp-z", projectId: "p-OTHER", code: "Z01", name: "งานอื่น" },
  ],
  initialItemId: null,
  revalidate: "/equipment/scan",
};

const pickFile = () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const input = screen.getByLabelText(/รูปสภาพก่อนยืม/, { selector: "input" });
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  checkOutEquipment.mockReset().mockResolvedValue({ ok: true });
  checkInEquipment.mockReset().mockResolvedValue({ ok: true });
  fetchLoanPhotoUrls.mockReset().mockResolvedValue({ ok: true, urls: [] });
  uploadConditionPhotos.mockReset().mockResolvedValue({ ok: true, paths: ["usage/u/1.jpg"] });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("spec 370 U2 — scan client", () => {
  it("search finds by serial; tapping an in-store item opens the borrow sheet with ITS project's WPs only", async () => {
    const user = userEvent.setup();
    render(<EquipmentScanClient {...BASE} />);
    await user.type(screen.getByLabelText(/ค้นหาด้วยชื่อ หรือ S\/N/), "SN-99");
    await user.click(screen.getByRole("button", { name: /สว่านโรตารี่/ }));
    expect(screen.getByText("ยืมออกจากคลัง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /W05-03/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Z01/ })).not.toBeInTheDocument();
  });

  it("WP picked + photo → submits via 'scan'; the outcome names the item and WP in place", async () => {
    const user = userEvent.setup();
    render(<EquipmentScanClient {...BASE} />);
    await user.type(screen.getByLabelText(/ค้นหาด้วยชื่อ หรือ S\/N/), "สว่าน");
    await user.click(screen.getByRole("button", { name: /สว่านโรตารี่/ }));
    await user.click(screen.getByRole("button", { name: /W05-03/ }));
    const submit = screen.getByRole("button", { name: "ยืมออก" });
    expect(submit).toBeDisabled();
    pickFile();
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(checkOutEquipment).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
          workPackageId: "wp-a",
          via: "scan",
          photoPaths: ["usage/u/1.jpg"],
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/ยืมแล้ว — สว่านโรตารี่/)).toBeInTheDocument());
    expect(screen.getByText(/W05-03/)).toBeInTheDocument();
  });

  it("a camera decode of the deep-link URL resolves the item", async () => {
    const user = userEvent.setup();
    render(<EquipmentScanClient {...BASE} />);
    await user.click(screen.getByRole("button", { name: "เปิดกล้องสแกน" }));
    await user.click(screen.getByRole("button", { name: "MOCK-DECODE" }));
    expect(screen.getByText("ยืมออกจากคลัง")).toBeInTheDocument();
  });

  it("an OUT item opens the return sheet against its loan", async () => {
    const user = userEvent.setup();
    render(<EquipmentScanClient {...BASE} />);
    await user.type(screen.getByLabelText(/ค้นหาด้วยชื่อ หรือ S\/N/), "เครื่องตัด");
    await user.click(screen.getByRole("button", { name: /เครื่องตัด/ }));
    expect(fetchLoanPhotoUrls).toHaveBeenCalledWith("L2");
    expect(screen.getByText("คืนเครื่องมือ")).toBeInTheDocument();
  });

  it("bulk resolves to the explanatory refusal (D5), never a silent nothing", async () => {
    const user = userEvent.setup();
    render(<EquipmentScanClient {...BASE} />);
    await user.type(screen.getByLabelText(/ค้นหาด้วยชื่อ หรือ S\/N/), "นั่งร้าน");
    await user.click(screen.getByRole("button", { name: /นั่งร้าน/ }));
    expect(screen.getByText(/ของแบบนับจำนวน/)).toBeInTheDocument();
  });

  it("an unknown deep-link id lands on the not-a-sticker copy", () => {
    render(<EquipmentScanClient {...BASE} initialItemId="9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f" />);
    expect(screen.getByText(/ไม่ใช่สติกเกอร์อุปกรณ์ของระบบ/)).toBeInTheDocument();
  });

  it("a deep-link initialItemId auto-opens the right sheet on arrival (no camera)", () => {
    render(<EquipmentScanClient {...BASE} initialItemId="1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a" />);
    expect(screen.getByText("ยืมออกจากคลัง")).toBeInTheDocument();
  });
});
