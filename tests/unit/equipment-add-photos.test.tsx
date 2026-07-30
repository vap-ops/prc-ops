// Spec 382 U2 — replaces tests/unit/equipment-add-image.test.tsx (spec 367 U5b).
//
// The behaviours below are the SAME ones U5b pinned; only the shape changed from
// one image to four slots, so they are adapted rather than dropped:
//
//   - the id is minted CLIENT-SIDE, because the storage path is `<itemId>/<file>`
//     (the depth-1 arm of the equipment-images policy) and no row exists yet;
//   - the row is created with that SAME id, so every photo lands in a folder the
//     row owns;
//   - the add form writes NO photo rows itself — createEquipment does, after the
//     insert, because of the FK;
//   - photos are OPTIONAL (operator ruling: a dead camera must not stall the
//     refill), so an item with none still saves;
//   - a refused upload never leaves the row claiming a path that isn't there.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpload, mockPrepare, mockSetPhoto, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
  mockSetPhoto: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/app/equipment/photo-actions", () => ({ setEquipmentItemPhoto: mockSetPhoto }));
vi.mock("@/app/equipment/actions", () => ({
  createEquipment: mockCreate,
  updateEquipment: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentCategory: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentOwner: vi.fn().mockResolvedValue({ ok: true }),
  recordEquipmentMovement: vi.fn().mockResolvedValue({ ok: true }),
  setEquipmentDailyRate: vi.fn().mockResolvedValue({ ok: true }),
}));

import { EquipmentManager } from "@/components/features/equipment/equipment-manager";

const CATEGORIES = [{ id: "c1", name: "เครื่องปั่นไฟ" }];
const OWNERS = [{ id: "o2", name: "Preston International Co., Ltd.", isDefault: true }];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderManager() {
  render(
    <EquipmentManager
      items={[]}
      categories={CATEGORIES}
      owners={OWNERS}
      projects={[{ id: "p1", name: "ไซต์บางนา" }]}
      movements={[]}
      canManageRegistry
    />,
  );
}

function openAddSheet() {
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "สว่านไฟฟ้า" } });
  fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
}

const imageFile = () => new File(["x"], "p.jpg", { type: "image/jpeg" });

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  mockSetPhoto.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("add an equipment item with its photos (spec 382 U2)", () => {
  it("offers all four slots on the add sheet", () => {
    renderManager();
    openAddSheet();
    for (const label of ["รูปอุปกรณ์", "เพลทเลขเครื่อง", "ยี่ห้อ", "QR ของเรา"]) {
      expect(screen.getByLabelText(`เลือกรูป ${label}`), label).toBeInTheDocument();
    }
  });

  it("uploads under a client-minted id and creates the row with that SAME id", async () => {
    renderManager();
    openAddSheet();
    fireEvent.change(screen.getByLabelText("เลือกรูป เพลทเลขเครื่อง"), {
      target: { files: [imageFile()] },
    });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    const uploadedPath = mockUpload.mock.calls[0]![0] as string;
    const [folder] = uploadedPath.split("/");
    expect(folder).toMatch(UUID_RE);
    expect(uploadedPath).toMatch(/^[^/]+\/[^/]+\.jpeg$/); // depth 1 — the policy arm

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as {
      id: string;
      photos: { kind: string; path: string }[];
    };
    expect(arg.id).toBe(folder);
    expect(arg.photos).toEqual([{ kind: "nameplate", path: uploadedPath }]);
  });

  it("carries several slots through in one save", async () => {
    renderManager();
    openAddSheet();
    fireEvent.change(screen.getByLabelText("เลือกรูป รูปอุปกรณ์"), {
      target: { files: [imageFile()] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("เลือกรูป QR ของเรา"), {
      target: { files: [imageFile()] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const kinds = (mockCreate.mock.calls[0]![0] as { photos: { kind: string }[] }).photos
      .map((p) => p.kind)
      .sort();
    expect(kinds).toEqual(["item", "qr_tag"]);
  });

  it("writes no photo rows from the add form — there is no item yet", async () => {
    renderManager();
    openAddSheet();
    fireEvent.change(screen.getByLabelText("เลือกรูป ยี่ห้อ"), {
      target: { files: [imageFile()] },
    });
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockSetPhoto).not.toHaveBeenCalled();
  });

  it("still adds an item with no photos at all — every slot is optional", async () => {
    renderManager();
    openAddSheet();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as { id: string; photos: unknown[] };
    expect(arg.photos).toEqual([]);
    expect(arg.id).toMatch(UUID_RE);
  });

  it("does not claim a path when the upload was refused", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "denied" } });
    renderManager();
    openAddSheet();
    fireEvent.change(screen.getByLabelText("เลือกรูป รูปอุปกรณ์"), {
      target: { files: [imageFile()] },
    });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("สิทธิ์ไม่พอ");

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect((mockCreate.mock.calls[0]![0] as { photos: unknown[] }).photos).toEqual([]);
  });

  it("shows the photo took, per slot, and can drop it again", async () => {
    renderManager();
    openAddSheet();
    fireEvent.change(screen.getByLabelText("เลือกรูป รูปอุปกรณ์"), {
      target: { files: [imageFile()] },
    });

    await waitFor(() => expect(screen.getByAltText("รูปอุปกรณ์")).toBeInTheDocument());
    // Only the slot that was filled gains a remove control.
    expect(screen.getAllByRole("button", { name: /ลบรูป/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /ลบรูป/ }));
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect((mockCreate.mock.calls[0]![0] as { photos: unknown[] }).photos).toEqual([]);
  });
});
