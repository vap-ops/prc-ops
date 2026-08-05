// Writing failing test first.
//
// Spec 380 U6 — the waiver panel on the money-review voucher. §2 decision ③:
// waiving is ACCOUNTING-ONLY, and it is the last rung of the RD fallback ladder
// (a true dead end — the VAT becomes cost). The panel must therefore state what
// a waiver MEANS, not just offer a button.
//
// The reason set is pinned over its COMPLETE domain: a hand-listed subset would
// silently miss the next enum value, which is exactly how an unreviewed reason
// reaches an audited money decision.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PurchaseDocWaiverPanel } from "@/components/features/accounting/purchase-doc-waiver-panel";
import { DOC_WAIVER_REASON_LABEL } from "@/lib/i18n/labels";

const ok = vi.fn(async () => ({ ok: true }) as const);

const PR = "11111111-1111-4111-8111-111111111111";

function renderPanel(over: Partial<Parameters<typeof PurchaseDocWaiverPanel>[0]> = {}) {
  return render(
    <PurchaseDocWaiverPanel
      purchaseRequestId={PR}
      waiver={null}
      waive={ok}
      unwaive={ok}
      {...over}
    />,
  );
}

describe("PurchaseDocWaiverPanel (spec 380 U6)", () => {
  it("offers EXACTLY the waiver reasons the enum defines", () => {
    renderPanel();
    const labels = Object.values(DOC_WAIVER_REASON_LABEL).sort();
    const rendered = screen
      .getAllByRole("option")
      .map((o) => o.textContent ?? "")
      .sort();
    expect(rendered).toEqual(labels);
  });

  it("sends the chosen reason and the note", async () => {
    const waive = vi.fn(async () => ({ ok: true }) as const);
    renderPanel({ waive });
    fireEvent.change(screen.getByLabelText(/เหตุผล/), { target: { value: "docs_unobtainable" } });
    fireEvent.change(screen.getByLabelText(/หมายเหตุ/), { target: { value: "ร้านปิด" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเว้นเอกสาร" }));
    await waitFor(() => expect(waive).toHaveBeenCalledWith(PR, "docs_unobtainable", "ร้านปิด"));
  });

  it("surfaces a refusal in place instead of silently doing nothing", async () => {
    const waive = vi.fn(async () => ({ ok: false, error: "ต้องระบุเหตุผลเพิ่มเติม" }) as const);
    renderPanel({ waive });
    fireEvent.click(screen.getByRole("button", { name: "ยกเว้นเอกสาร" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ต้องระบุเหตุผลเพิ่มเติม");
  });

  // A waived order is discharged: the panel must show WHO/WHY, and offer the
  // reverse. Withdrawing a control withdraws its reverse too — the unwaive path
  // is the only way back out of a waived state.
  it("shows the recorded waiver and offers the reverse, not the waive form again", () => {
    renderPanel({
      waiver: {
        reason: "vendor_refused",
        note: "ผู้ขายปฏิเสธ",
        createdAt: "2026-08-05T00:00:00Z",
        createdByName: "คุณบัญชี",
      },
    });
    // The heading interleaves label + reason as separate text nodes, so match
    // on the element's whole textContent rather than a single node.
    const hasText = (needle: string) =>
      screen.getAllByText((_t, el) => (el?.textContent ?? "").includes(needle)).length > 0;
    expect(hasText(DOC_WAIVER_REASON_LABEL.vendor_refused)).toBe(true);
    expect(hasText("ผู้ขายปฏิเสธ")).toBe(true);
    expect(hasText("คุณบัญชี")).toBe(true);
    expect(screen.getByRole("button", { name: "ยกเลิกการยกเว้น" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเว้นเอกสาร" })).not.toBeInTheDocument();
  });

  it("calls unwaive with the request id", async () => {
    const unwaive = vi.fn(async () => ({ ok: true }) as const);
    renderPanel({
      waiver: {
        reason: "other",
        note: "x",
        createdAt: "2026-08-05T00:00:00Z",
        createdByName: null,
      },
      unwaive,
    });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการยกเว้น" }));
    await waitFor(() => expect(unwaive).toHaveBeenCalledWith(PR));
  });

  // The panel is a money decision with a legal consequence (the input VAT is
  // forfeited). It must say so where the decision is made, not in a spec.
  it("states the consequence of waiving", () => {
    renderPanel();
    expect(screen.getByText(/ภาษีซื้อ/)).toBeInTheDocument();
  });
});
