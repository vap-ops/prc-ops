// Spec 315 U1 — the ช่าง's ID-card renewal card on /technician. Shows the current
// (signed-URL) card photo, and routes a re-upload through prepare → storage →
// addStaffRegistrationDoc('id_card') exactly like the registration form's DocRow
// (all mocked here). Self-serve supersede: success just refreshes; no queue.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/register/actions", () => ({ addStaffRegistrationDoc: mockAdd }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: mockUpload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));

import { WorkerIdCardUpdate } from "@/components/features/portal/worker-id-card-update";

const UID = "11111111-1111-1111-1111-111111111111";

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "card.jpg")] } });
}

beforeEach(() => {
  mockAdd.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("WorkerIdCardUpdate", () => {
  it("shows the current ID-card photo and the renewal hint", () => {
    render(<WorkerIdCardUpdate uid={UID} currentUrl="https://signed/id.jpg" />);
    expect(screen.getByText("บัตรประชาชน")).toBeInTheDocument();
    const img = screen.getByAltText("บัตรประชาชน") as HTMLImageElement;
    expect(img.src).toBe("https://signed/id.jpg");
    // Renewal affordance, not first-upload copy.
    expect(screen.getByRole("button", { name: "อัปเดตบัตรประชาชน" })).toBeInTheDocument();
  });

  it("uploads a picked file then records it as an id_card doc", async () => {
    render(<WorkerIdCardUpdate uid={UID} currentUrl="https://signed/id.jpg" />);
    pickFile();
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    // Storage first (own technician/<uid>/id_card path), then the record action.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`technician/${UID}/id_card/`)).toBe(true);
    const arg = mockAdd.mock.calls[0]?.[0] as { purpose: string; ext: string };
    expect(arg.purpose).toBe("id_card");
    expect(arg.ext).toBe("jpeg");
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces the action error and does not refresh", async () => {
    mockAdd.mockResolvedValue({ ok: false, error: "บันทึกเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
    render(<WorkerIdCardUpdate uid={UID} currentUrl={null} />);
    pickFile();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("บันทึกเอกสารไม่สำเร็จ"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
