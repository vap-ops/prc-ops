// Component tests for the themed confirm dialog (spec 18 item C) that
// replaces window.confirm. Cancel paths (button, Escape, backdrop) must
// never fire onConfirm; clicking the panel itself is not a cancel.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/features/confirm-dialog";

function setup(open = true) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open={open}
      message="ลบรูปนี้หรือไม่? การลบไม่สามารถย้อนกลับได้"
      confirmLabel="ลบรูป"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    setup(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the message and both buttons when open", () => {
    setup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/ลบรูปนี้หรือไม่/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบรูป" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
  });

  it("fires onConfirm exactly once on the confirm button", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ลบรูป" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on the cancel button without confirming", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on a backdrop click but not on a panel click", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByText(/ลบรูปนี้หรือไม่/));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("puts initial focus on the cancel button", () => {
    setup();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toHaveFocus();
  });
});
