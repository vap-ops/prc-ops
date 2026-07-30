// Writing failing test first.
//
// Operator, 2026-07-30: "Image upload unavailable at add form."
//
// True, and it matters more than it sounds: spec 367 §3's PRI transfer waits on
// every item in the store having a photo, and the registry is being refilled by
// hand right now. Add → save → find the row → open แก้ไข → photograph is four
// steps per item where one would do.
//
// The structural problem, and why this is not just "render the control twice":
// the storage path is `<itemId>/<file>` (folder depth 1 is the only arm of the
// equipment-images INSERT policy that admits the back office), and on the ADD
// form no item id exists yet. The fix is to mint the id CLIENT-SIDE, upload
// under it, and hand the same id to createEquipment — one insert, no second
// round trip, and no window where a row exists without the photo the operator
// just took.
//
// What that buys and what it costs, both pinned below:
//   - the draft id must be the SAME id the row is created with, or the image
//     lands in a folder belonging to nothing;
//   - the add form must NOT call setEquipmentItemImage — there is no row to
//     update yet, and calling it would 42501/no-op silently;
//   - a failed insert leaves one unreferenced object in the bucket, the same
//     trade the edit path already makes (nothing reads an object no row points
//     at).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockUpload, mockPrepare, mockSetImage, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
  mockSetImage: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/app/equipment/actions", () => ({
  createEquipment: mockCreate,
  updateEquipment: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentCategory: vi.fn().mockResolvedValue({ ok: true }),
  createEquipmentOwner: vi.fn().mockResolvedValue({ ok: true }),
  recordEquipmentMovement: vi.fn().mockResolvedValue({ ok: true }),
  setEquipmentDailyRate: vi.fn().mockResolvedValue({ ok: true }),
  setEquipmentItemImage: mockSetImage,
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

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("ชื่ออุปกรณ์"), { target: { value: "สว่านไฟฟ้า" } });
  fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "c1" } });
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  mockSetImage.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

const imageFile = () => new File(["x"], "p.jpg", { type: "image/jpeg" });

describe("add an equipment item with its photo (spec 367 U5b)", () => {
  it("offers the image control on the add sheet", () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    expect(screen.getByLabelText("เลือกรูปภาพ")).toBeInTheDocument();
  });

  it("uploads under a client-minted id and creates the row with that SAME id and path", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    const uploadedPath = mockUpload.mock.calls[0]![0] as string;
    const [folder] = uploadedPath.split("/");
    expect(folder).toMatch(UUID_RE);
    expect(uploadedPath).toMatch(/^[^/]+\/[^/]+\.jpeg$/); // depth 1, policy arm

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as { id: string; imagePath: string | null };
    // The whole point: the row owns the folder the photo went into.
    expect(arg.id).toBe(folder);
    expect(arg.imagePath).toBe(uploadedPath);
  });

  // Silent success is the failure mode here: in draft mode there is no signed URL
  // to render, so without a local preview the control would look untouched after
  // a successful pick and the operator would re-pick, or assume it failed.
  it("shows the photo took — a preview, เปลี่ยนรูป, and a way to drop it", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    expect(screen.queryByRole("button", { name: /ลบรูป/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByAltText("รูปอุปกรณ์")).toBeInTheDocument());
    expect(screen.getByAltText<HTMLImageElement>("รูปอุปกรณ์").src).not.toBe("");
    expect(screen.getByText("เปลี่ยนรูป")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ลบรูป/ })).toBeInTheDocument();
  });

  it("dropping the draft photo clears the path handed to createEquipment", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });
    await waitFor(() => expect(screen.getByRole("button", { name: /ลบรูป/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ลบรูป/ }));
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect((mockCreate.mock.calls[0]![0] as { imagePath: string | null }).imagePath).toBeNull();
  });

  it("never calls setEquipmentItemImage from the add form — there is no row yet", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockSetImage).not.toHaveBeenCalled();
  });

  it("still adds an item with no photo at all — the photo is optional", async () => {
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const arg = mockCreate.mock.calls[0]![0] as { id: string; imagePath: string | null };
    expect(arg.imagePath).toBeNull();
    expect(arg.id).toMatch(UUID_RE);
  });

  it("does not create the row when the upload was refused", async () => {
    mockUpload.mockResolvedValue({ error: { statusCode: "403", message: "denied" } });
    renderManager();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มอุปกรณ์" }));
    fireEvent.change(screen.getByLabelText("เลือกรูปภาพ"), { target: { files: [imageFile()] } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("สิทธิ์ไม่พอ");
    // The operator can still save the item without the photo; what must NOT
    // happen is a row claiming an image path that never landed.
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect((mockCreate.mock.calls[0]![0] as { imagePath: string | null }).imagePath).toBeNull();
  });
});
