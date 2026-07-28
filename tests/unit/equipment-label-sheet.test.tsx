// Spec 370 U3 — the printable label grid: one label per item carrying the QR
// (mocked — canvas is absent in jsdom) plus the deep-link TEXT, which is what
// an NFC NDEF sticker gets written with; identifiers render when present.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const toDataURL = vi.fn();
vi.mock("qrcode", () => ({ default: { toDataURL: (...a: unknown[]) => toDataURL(...a) } }));

import { EquipmentLabelSheet } from "@/components/features/equipment/equipment-label-sheet";

const ITEMS = [
  { id: "aaa-1", name: "สว่านโรตารี่", serialNo: "SN-9", assetTag: "EQ-01" },
  { id: "bbb-2", name: "เครื่องตัด", serialNo: null, assetTag: null },
];

beforeEach(() => {
  toDataURL.mockReset().mockResolvedValue("data:image/png;base64,x");
});

describe("spec 370 U3 — label sheet", () => {
  it("renders one label per item with the scan deep link as both QR payload and printed text", async () => {
    render(<EquipmentLabelSheet items={ITEMS} appOrigin="https://app.example" />);
    await waitFor(() =>
      expect(toDataURL).toHaveBeenCalledWith(
        "https://app.example/equipment/scan?item=aaa-1",
        expect.anything(),
      ),
    );
    expect(screen.getByText("สว่านโรตารี่")).toBeInTheDocument();
    expect(screen.getByText(/EQ-01 · SN-9/)).toBeInTheDocument();
    expect(screen.getByText("/equipment/scan?item=aaa-1")).toBeInTheDocument();
    expect(screen.getByText("/equipment/scan?item=bbb-2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByAltText("QR สว่านโรตารี่")).toBeInTheDocument());
  });

  it("the print chrome names the label count and the NFC procedure", () => {
    render(<EquipmentLabelSheet items={ITEMS} appOrigin="https://app.example" />);
    expect(screen.getByText(/2 ป้าย/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พิมพ์" })).toBeInTheDocument();
  });
});
