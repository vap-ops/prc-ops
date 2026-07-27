// Writing failing test first.
//
// Spec 298 U2 — the /sa/crew "เพิ่มช่างใหม่" front door. One button opens an onboarding
// sheet that branches: มีมือถือ (self-serve QR the worker scans + keys their own bank —
// nothing bank touches the SA) / ไม่มีมือถือ (capture-blind add: identity + a REQUIRED
// passbook photo). This pins the branch UI, the required-photo gate, and the invariant
// that NO bank-account field is ever rendered to the SA.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Field bug 2026-07-27 — the submit leg. Stubbed so the no-phone add can be driven
// end-to-end in jsdom: the real path decodes a photo on a canvas, uploads to Storage
// and calls a server action, none of which exist here.
const submitMocks = vi.hoisted(() => ({
  add: vi.fn(),
  upload: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@/app/sa/crew/actions", () => ({ addProjectWorkerWithBank: submitMocks.add }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: submitMocks.upload }) } }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: submitMocks.prepare }));

import { AddTechnicianSheet } from "@/components/features/sa/add-technician-sheet";
import {
  ADD_TECHNICIAN_LABEL,
  ADD_TECHNICIAN_HAS_PHONE_LABEL,
  ADD_TECHNICIAN_NO_PHONE_LABEL,
  PASSBOOK_PHOTO_LABEL,
  SUBCON_LINE_SHARE_LABEL,
  REGISTER_PREP_POSTER_LINE,
  ADD_TECHNICIAN_DONE_TITLE,
  ADD_TECHNICIAN_ADD_ANOTHER_LABEL,
  ADD_TECHNICIAN_DONE_LABEL,
  ROSTER_TILE_LABEL,
} from "@/lib/i18n/labels";

const projects = [{ id: "11111111-1111-4111-8111-111111111111", code: "TFM", name: "TFM Site" }];
const qrCards = [
  {
    project: { id: projects[0]!.id, name: "TFM Site" },
    url: "https://app.example/register/technician?project=abc",
    svg: "<svg data-testid='qr-svg'></svg>",
  },
];
const firmQrCards = [
  {
    contractor: { id: "22222222-2222-4222-8222-222222222222", name: "ช่างอวย (กระเบื้อง)" },
    project: { id: projects[0]!.id, name: "TFM Site" },
    url: "https://app.example/register/technician?project=abc&contractor=def",
    svg: "<svg data-testid='firm-qr-svg'></svg>",
  },
  {
    contractor: { id: "33333333-3333-4333-8333-333333333333", name: "ช่างสุทิน (ฐานราก)" },
    project: { id: projects[0]!.id, name: "TFM Site" },
    url: "https://app.example/register/technician?project=abc&contractor=ghi",
    svg: "<svg data-testid='firm-qr-svg-2'></svg>",
  },
];

function openSheet(withFirms = false) {
  render(
    <AddTechnicianSheet
      projects={projects}
      qrCards={qrCards}
      firmQrCards={withFirms ? firmQrCards : []}
    />,
  );
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

  // Spec 328 U2 — the per-firm subcon QR arm.
  it("spec 328: renders the สมัครเข้าทีม selector with ทีม PRC + one row per firm", () => {
    const dialog = openSheet(true);
    expect(within(dialog).getByText("สมัครเข้าทีม")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /ทีม PRC/ })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /ช่างอวย/ })).toBeVisible();
  });

  it("spec 328: picking a firm shows its QR + the no-bank hint, hiding the PRC branches", () => {
    const dialog = openSheet(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /ช่างอวย/ }));
    expect(within(dialog).getByText(/contractor=def/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/ไม่เก็บข้อมูลธนาคาร/).length).toBeGreaterThan(0);
    expect(
      within(dialog).queryByRole("button", { name: ADD_TECHNICIAN_HAS_PHONE_LABEL }),
    ).toBeNull();
  });

  // Spec 343 U3 — the LINE share carries the "bring your ID card" line ahead of
  // the URL, so a firm member reading the forward knows what to prepare before
  // they even scan (the poster carries the same line via the shared constant).
  it("spec 343: the LINE share text leads with the เตรียมบัตรประชาชนก่อนสแกน line", () => {
    const dialog = openSheet(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /ช่างอวย/ }));
    const share = within(dialog).getByRole("link", { name: SUBCON_LINE_SHARE_LABEL });
    const href = share.getAttribute("href") ?? "";
    expect(href).toContain(encodeURIComponent(REGISTER_PREP_POSTER_LINE));
    // and still carries the URL it was sharing
    expect(href).toContain(encodeURIComponent("contractor=def"));
  });

  it("spec 328 U2b: the QR expands UNDER the tapped firm row (accordion), not below the list", () => {
    const dialog = openSheet(true);
    const aueyBtn = within(dialog).getByRole("button", { name: /ช่างอวย/ });
    const sutinBtn = within(dialog).getByRole("button", { name: /ช่างสุทิน/ });
    fireEvent.click(aueyBtn);
    const qr = within(dialog).getByText(/contractor=def/);
    // Accordion placement: อวย's QR sits AFTER its own row and BEFORE สุทิน's row.
    expect(aueyBtn.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(qr.compareDocumentPosition(sutinBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("spec 328 U2b: opening another firm collapses the first (one panel at a time)", () => {
    const dialog = openSheet(true);
    fireEvent.click(within(dialog).getByRole("button", { name: /ช่างอวย/ }));
    expect(within(dialog).getByText(/contractor=def/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /ช่างสุทิน/ }));
    expect(within(dialog).queryByText(/contractor=def/)).toBeNull();
    expect(within(dialog).getByText(/contractor=ghi/)).toBeInTheDocument();
  });

  it("spec 328 U2b: the PRC branch UI renders under the ทีม PRC row (above the firm rows)", () => {
    const dialog = openSheet(true);
    const phoneQ = within(dialog).getByText(/ช่างคนนี้มีมือถือไหม/);
    const aueyBtn = within(dialog).getByRole("button", { name: /ช่างอวย/ });
    expect(phoneQ.compareDocumentPosition(aueyBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("spec 328: no firms → no selector, legacy behavior untouched", () => {
    const dialog = openSheet(false);
    expect(within(dialog).queryByText("สมัครเข้าทีม")).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: ADD_TECHNICIAN_HAS_PHONE_LABEL }),
    ).toBeVisible();
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

// Field bug 2026-07-27 — "SA cannot press เพิ่มช่างเข้าทีม, it jumps her to home screen".
// Prod telemetry refuted both halves literally: session 8cc17162 sat on /team unbroken
// across three presses with ZERO route changes and no js_error, and two of the three
// CREATED workers (PRC-26-0033, PRC-26-0034). What actually happened is that the success
// path did close() + router.refresh() and NOTHING else — the full-screen sheet vanished,
// revealing the ทีมงาน hub (header: "สวัสดี คุณ…" — reads as home), and the new worker is
// invisible on that page bar a tile-bubble +1. She re-submitted the same man 128s later
// and hit the dedup refusal, which is the one orphan sa-bank-capture/ object in prod.
// So: confirm the add IN PLACE. Second, latent half — submitNoPhone had no try/finally
// and is invoked as `void submitNoPhone()`, so a network throw on either leg skipped
// setBusy(false) and left the button disabled reading กำลังบันทึก… forever with no error.
describe("AddTechnicianSheet — the no-phone add reports its own outcome", () => {
  beforeEach(() => {
    submitMocks.add.mockReset();
    submitMocks.upload.mockReset().mockResolvedValue({ error: null });
    submitMocks.prepare
      .mockReset()
      .mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg", downscaled: true });
  });

  /** The passbook input as a File input — `.files` is the only honest read in jsdom. */
  function passbookInput(dialog: HTMLElement): HTMLInputElement {
    return within(dialog).getByLabelText(PASSBOOK_PHOTO_LABEL) as HTMLInputElement;
  }

  async function fillAndSubmit(dialog: HTMLElement) {
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ/), {
      target: { value: "นายอำนาจ แดงสูงเนิน" },
    });
    fireEvent.change(within(dialog).getByLabelText(/เลขบัตร/), {
      target: { value: "1161000055091" },
    });
    fireEvent.change(within(dialog).getByLabelText(/วันเกิด/), { target: { value: "2004-12-22" } });
    fireEvent.change(within(dialog).getByLabelText(PASSBOOK_PHOTO_LABEL), {
      target: { files: [new File(["x"], "IMG_8987.jpeg", { type: "image/jpeg" })] },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /^เพิ่มช่างเข้าทีม$/ }));
    });
  }

  it("confirms the add IN PLACE — the sheet stays open, naming the worker and their รหัสช่าง", async () => {
    submitMocks.add.mockResolvedValue({ ok: true, employeeId: "PRC-26-0034" });
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByText(ADD_TECHNICIAN_DONE_TITLE)).toBeVisible();
    expect(within(dialog).getByText("นายอำนาจ แดงสูงเนิน")).toBeVisible();
    expect(within(dialog).getByText(/PRC-26-0034/)).toBeVisible();
    // …and it says where he now lives, because /team itself shows him nowhere.
    expect(within(dialog).getByText(new RegExp(ROSTER_TILE_LABEL))).toBeVisible();
    // The spent form is gone, so nothing invites the duplicate submit she made in prod.
    expect(within(dialog).queryByLabelText(PASSBOOK_PHOTO_LABEL)).toBeNull();
  });

  it("confirms by name even when the รหัสช่าง read comes back empty", async () => {
    submitMocks.add.mockResolvedValue({ ok: true, employeeId: null });
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    expect(within(dialog).getByText(ADD_TECHNICIAN_DONE_TITLE)).toBeVisible();
    expect(within(dialog).getByText("นายอำนาจ แดงสูงเนิน")).toBeVisible();
    expect(within(dialog).queryByText(/รหัสช่าง/)).toBeNull();
  });

  it("เพิ่มอีกคน returns to a BLANK form without reopening the sheet", async () => {
    submitMocks.add.mockResolvedValue({ ok: true, employeeId: "PRC-26-0034" });
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_ADD_ANOTHER_LABEL }));
    expect(within(dialog).getByLabelText(/ชื่อ/)).toHaveValue("");
    expect(within(dialog).getByLabelText(/เลขบัตร/)).toHaveValue("");
    expect(within(dialog).queryByText(ADD_TECHNICIAN_DONE_TITLE)).toBeNull();
    // The previous man's passbook must NOT carry over — attaching his bank book to
    // the next worker is the one mistake this continue-button could invent. Refill
    // EVERY other field first, so the only thing that can still hold the submit
    // disabled is the missing passbook (a bare assertion here passes on the empty
    // name instead, and measures nothing — caught by mutation testing).
    // NB assert on `.files`, never `toHaveValue("")`: jsdom leaves a file input's
    // `value` empty even when a File is attached, so the value form passes
    // unconditionally and measures nothing (fresh-eyes catch, probe-confirmed).
    expect(passbookInput(dialog).files).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ/), { target: { value: "นายอำนวย ก" } });
    fireEvent.change(within(dialog).getByLabelText(/เลขบัตร/), {
      target: { value: "3301800499533" },
    });
    fireEvent.change(within(dialog).getByLabelText(/วันเกิด/), { target: { value: "1972-07-10" } });
    expect(within(dialog).getByRole("button", { name: /^เพิ่มช่างเข้าทีม$/ })).toBeDisabled();
  });

  // `added` belongs to one no-phone form session. The team selector sits ABOVE the
  // panel and is live while the receipt shows, so tapping ทีม PRC → ไม่มีมือถือ must
  // not hand the next man his predecessor's confirmation instead of a blank form.
  it("re-entering the ไม่มีมือถือ branch does NOT resurrect the previous man's receipt", async () => {
    submitMocks.add.mockResolvedValue({ ok: true, employeeId: "PRC-26-0034" });
    const dialog = openSheet(true);
    await fillAndSubmit(dialog);
    expect(within(dialog).getByText(ADD_TECHNICIAN_DONE_TITLE)).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: /ทีม PRC/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    expect(within(dialog).queryByText(ADD_TECHNICIAN_DONE_TITLE)).toBeNull();
    expect(within(dialog).getByLabelText(PASSBOOK_PHOTO_LABEL)).toBeInTheDocument();
    // Identity AND passbook go: re-entering with นายอำนาจ's bank book still attached
    // under the next man's name is how the wrong account gets paid. Refill the other
    // fields before asserting disabled, or the empty name carries the assertion and
    // the passbook is never measured (the same vacuity fixed in the test above).
    expect(within(dialog).getByLabelText(/ชื่อ/)).toHaveValue("");
    expect(passbookInput(dialog).files).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ/), { target: { value: "นายอำนวย ก" } });
    fireEvent.change(within(dialog).getByLabelText(/เลขบัตร/), {
      target: { value: "3301800499533" },
    });
    fireEvent.change(within(dialog).getByLabelText(/วันเกิด/), { target: { value: "1972-07-10" } });
    expect(within(dialog).getByRole("button", { name: /^เพิ่มช่างเข้าทีม$/ })).toBeDisabled();
  });

  it("a mid-typing branch bounce (nothing committed) KEEPS the half-entered form", async () => {
    const dialog = openSheet(true);
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    fireEvent.change(within(dialog).getByLabelText(/ชื่อ/), { target: { value: "สมชาย ช่างดี" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /ทีม PRC/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_NO_PHONE_LABEL }));
    expect(within(dialog).getByLabelText(/ชื่อ/)).toHaveValue("สมชาย ช่างดี");
  });

  it("เสร็จแล้ว closes the sheet", async () => {
    submitMocks.add.mockResolvedValue({ ok: true, employeeId: "PRC-26-0034" });
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    fireEvent.click(within(dialog).getByRole("button", { name: ADD_TECHNICIAN_DONE_LABEL }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a network throw from the server action surfaces an error and RE-ENABLES the button", async () => {
    submitMocks.add.mockRejectedValue(new TypeError("Load failed"));
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    expect(within(dialog).getByRole("alert")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /^เพิ่มช่างเข้าทีม$/ })).toBeEnabled();
    expect(within(dialog).queryByRole("button", { name: /กำลังบันทึก/ })).toBeNull();
  });

  it("a network throw from the passbook upload is caught too — the leg that left a prod orphan", async () => {
    submitMocks.upload.mockRejectedValue(new TypeError("Load failed"));
    const dialog = openSheet();
    await fillAndSubmit(dialog);

    expect(within(dialog).getByRole("alert")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /^เพิ่มช่างเข้าทีม$/ })).toBeEnabled();
    expect(submitMocks.add).not.toHaveBeenCalled();
  });
});
