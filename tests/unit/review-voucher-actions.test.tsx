import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewVoucherActions } from "@/components/features/accounting/review-voucher-actions";
import { ADMIN_FLAG_TYPES } from "@/lib/accounting/review-queue-view";
import type { ReviewVoucherFlag } from "@/lib/accounting/load-review-voucher";

const ok = vi.fn(async () => ({ ok: true }) as const);

function openFlag(id: string, type = "amount_mismatch"): ReviewVoucherFlag {
  return {
    id,
    flagType: type,
    raisedByKind: "reviewer",
    status: "open",
    detail: "ยอดไม่ตรง",
    flaggedAt: "2026-07-23T00:00:00Z",
    resolvedAt: null,
    resolution: null,
  };
}

describe("ReviewVoucherActions (spec 345 U3)", () => {
  it("offers exactly the admin-raisable flag types (changed_after_verified is reserved)", () => {
    render(
      <ReviewVoucherActions
        source="wage_payments"
        sourceId="x"
        reviewStatus="pending"
        openFlags={[]}
        suggestedFlags={[]}
        verify={ok}
        flag={ok}
        resolve={ok}
        dismiss={ok}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(ADMIN_FLAG_TYPES.length);
    expect(screen.queryByText("ข้อมูลเปลี่ยนหลังตรวจแล้ว")).not.toBeInTheDocument();
  });

  it("blocks ตรวจผ่าน while open flags exist and explains why", () => {
    render(
      <ReviewVoucherActions
        source="wage_payments"
        sourceId="x"
        reviewStatus="flagged"
        openFlags={[openFlag("f1")]}
        suggestedFlags={[]}
        verify={ok}
        flag={ok}
        resolve={ok}
        dismiss={ok}
      />,
    );
    expect(screen.getByRole("button", { name: "ตรวจผ่าน" })).toBeDisabled();
    expect(screen.getByText("ปิดธงให้หมดก่อนจึงจะตรวจผ่านได้")).toBeInTheDocument();
  });

  it("shows the stale banner when suggested system flags exist", () => {
    render(
      <ReviewVoucherActions
        source="wage_payments"
        sourceId="x"
        reviewStatus="pending"
        openFlags={[]}
        suggestedFlags={[{ ...openFlag("s1", "changed_after_verified"), status: "suggested" }]}
        verify={ok}
        flag={ok}
        resolve={ok}
        dismiss={ok}
      />,
    );
    expect(screen.getByText(/ข้อมูลเงินต้นทางเปลี่ยนหลังตรวจแล้ว — ตรวจซ้ำ/)).toBeInTheDocument();
  });

  it("surfaces an action refusal inline (never a silent failure)", async () => {
    const refuse = vi.fn(async () => ({ ok: false, error: "ยังมีธงค้างอยู่" }) as const);
    render(
      <ReviewVoucherActions
        source="wage_payments"
        sourceId="x"
        reviewStatus="pending"
        openFlags={[]}
        suggestedFlags={[]}
        verify={refuse}
        flag={ok}
        resolve={ok}
        dismiss={ok}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ตรวจผ่าน" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ยังมีธงค้างอยู่"));
  });

  it("sends the resolution text with แก้ไขแล้ว", async () => {
    const resolve = vi.fn(async () => ({ ok: true }) as const);
    render(
      <ReviewVoucherActions
        source="wage_payments"
        sourceId="src-1"
        reviewStatus="flagged"
        openFlags={[openFlag("f9")]}
        suggestedFlags={[]}
        verify={ok}
        flag={ok}
        resolve={resolve}
        dismiss={ok}
      />,
    );
    fireEvent.change(screen.getByLabelText(/ผลการแก้ไข/), { target: { value: "แนบสลิปแล้ว" } });
    fireEvent.click(screen.getByRole("button", { name: "แก้ไขแล้ว" }));
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith("wage_payments", "src-1", "f9", "แนบสลิปแล้ว"),
    );
  });
});
