// Spec 321 U7 — PendingChangeNotice: the ONE waiting banner shown while an
// approved-tier profile change (bank / identity) is pending. Uniform attention
// treatment + copy for every audience (kills the S16 per-surface markup
// divergences); every string is single-sourced from the labels SSOT and every
// bank audience draws its copy from the same PM / HR constants.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PendingChangeNotice } from "@/components/features/profile/pending-change-notice";
import {
  BANK_CHANGE_APPROVER_HR,
  BANK_CHANGE_APPROVER_PM,
  BANK_CHANGE_PENDING_HR,
  BANK_CHANGE_PENDING_PM,
  BANK_CHANGE_TOAST_HR,
  BANK_CHANGE_TOAST_PM,
  BANK_INSTANT_SUBTITLE,
  BANK_INSTANT_TOAST,
  IDENTITY_CHANGE_PENDING,
} from "@/lib/i18n/labels";
import { BANK_AUDIENCE } from "@/lib/profile/bank-audience";

describe("PendingChangeNotice", () => {
  it("renders its message inside the uniform attention treatment", () => {
    const { container } = render(
      <PendingChangeNotice>{IDENTITY_CHANGE_PENDING}</PendingChangeNotice>,
    );
    const msg = screen.getByText(IDENTITY_CHANGE_PENDING);
    expect(msg).toBeInTheDocument();
    expect(msg.className).toContain("text-attn-ink");
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain("border-attn");
    expect(box.className).toContain("bg-attn-soft");
    expect(box.className).toContain("border-l-4");
  });

  it("defaults to the standalone card container, accepts a className for the inset context", () => {
    const { container, rerender } = render(<PendingChangeNotice>x</PendingChangeNotice>);
    // default = the shared CARD look (rounded-card) used by the standalone banners
    expect((container.firstElementChild as HTMLElement).className).toContain("rounded-card");
    rerender(<PendingChangeNotice className="mt-3 rounded-md px-3 py-2">x</PendingChangeNotice>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain("px-3");
    // the attention treatment is fixed regardless of the container
    expect(box.className).toContain("border-attn");
  });
});

describe("approved-tier change copy is single-sourced (U7 SSOT)", () => {
  it("every bank audience draws its pending banner from the shared PM / HR labels", () => {
    // worker + contractor → their ผู้จัดการ (money approver); staff + user → ฝ่ายบุคคล / trio
    expect(BANK_AUDIENCE.worker.pendingText).toBe(BANK_CHANGE_PENDING_PM);
    expect(BANK_AUDIENCE.contractor.pendingText).toBe(BANK_CHANGE_PENDING_PM);
    expect(BANK_AUDIENCE.staff.pendingText).toBe(BANK_CHANGE_PENDING_HR);
    expect(BANK_AUDIENCE.user.pendingText).toBe(BANK_CHANGE_PENDING_HR);
  });

  it("every bank audience draws its toast + approver subtitle from the shared labels", () => {
    expect(BANK_AUDIENCE.worker.successToast).toBe(BANK_CHANGE_TOAST_PM);
    expect(BANK_AUDIENCE.contractor.successToast).toBe(BANK_CHANGE_TOAST_PM);
    expect(BANK_AUDIENCE.staff.successToast).toBe(BANK_CHANGE_TOAST_HR);
    expect(BANK_AUDIENCE.worker.subtitle).toBe(BANK_CHANGE_APPROVER_PM);
    expect(BANK_AUDIENCE.staff.subtitle).toBe(BANK_CHANGE_APPROVER_HR);
  });

  it("the user (login-keyed) audience is the INSTANT tier — its copy comes from the instant labels (U8a)", () => {
    expect(BANK_AUDIENCE.user.tierMode).toBe("instant");
    expect(BANK_AUDIENCE.user.successToast).toBe(BANK_INSTANT_TOAST);
    expect(BANK_AUDIENCE.user.subtitle).toBe(BANK_INSTANT_SUBTITLE);
    // the three approved audiences stay on the request/approval tier
    expect(BANK_AUDIENCE.worker.tierMode).toBe("approved");
    expect(BANK_AUDIENCE.staff.tierMode).toBe("approved");
    expect(BANK_AUDIENCE.contractor.tierMode).toBe("approved");
  });
});
