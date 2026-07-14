import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Spec 279 U7 — the /sa/crew roster as a staged onboarding progress tracker.
// Three gates the SA can already observe: รอตรวจ (pending staff_registrations)
// → รอยืนยัน (worker exists, cost/level not PM-confirmed) → พร้อม (confirmed;
// shows the worker's level). Lets the SA see who is stuck at which gate and chase
// the follow-up. Pure presentation — no schema, reuses already-granted reads.

import {
  CrewProgressRoster,
  type CrewProgressData,
} from "@/components/features/sa/crew-progress-roster";
import { BANK_PENDING_CHIP_LABEL } from "@/lib/i18n/labels";

const EMPTY: CrewProgressData = { needsReview: [], awaitingConfirm: [], ready: [] };

describe("CrewProgressRoster", () => {
  it("renders the three onboarding gates as sections", () => {
    render(<CrewProgressRoster data={EMPTY} registrationsHref="/sa/registrations" />);
    expect(screen.getByText(/รอตรวจ/)).toBeInTheDocument();
    expect(screen.getByText(/รอยืนยัน/)).toBeInTheDocument();
    expect(screen.getByText(/พร้อม/)).toBeInTheDocument();
  });

  it("places a pending registration under รอตรวจ, linking to the queue", () => {
    render(
      <CrewProgressRoster
        data={{ ...EMPTY, needsReview: [{ id: "r1", name: "สมหมาย รอตรวจ" }] }}
        registrationsHref="/sa/registrations"
      />,
    );
    const section = screen.getByLabelText("รอตรวจ");
    expect(within(section).getByText("สมหมาย รอตรวจ")).toBeInTheDocument();
    expect(within(section).getByRole("link")).toHaveAttribute("href", "/sa/registrations");
  });

  it("places an unconfirmed worker under รอยืนยัน", () => {
    render(
      <CrewProgressRoster
        data={{ ...EMPTY, awaitingConfirm: [{ id: "w1", name: "สายบัว", level: null }] }}
        registrationsHref="/sa/registrations"
      />,
    );
    const section = screen.getByLabelText("รอยืนยัน");
    expect(within(section).getByText("สายบัว")).toBeInTheDocument();
  });

  it("shows a bank-pending chip on a worker awaiting a PM's bank entry (spec 298 U2)", () => {
    render(
      <CrewProgressRoster
        data={{
          ...EMPTY,
          awaitingConfirm: [
            { id: "w1", name: "ไม่มีมือถือ", level: null, bankPending: true },
            { id: "w2", name: "มีบัญชีแล้ว", level: null },
          ],
        }}
        registrationsHref="/sa/registrations"
      />,
    );
    const section = screen.getByLabelText("รอยืนยัน");
    // exactly one chip — only the bankPending worker shows it.
    expect(within(section).getAllByText(BANK_PENDING_CHIP_LABEL)).toHaveLength(1);
  });

  it("shows the level badge for a confirmed worker under พร้อม", () => {
    render(
      <CrewProgressRoster
        data={{ ...EMPTY, ready: [{ id: "w2", name: "สมชาย ใจดี", level: "senior" }] }}
        registrationsHref="/sa/registrations"
      />,
    );
    const section = screen.getByLabelText("พร้อม");
    expect(within(section).getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(within(section).getByText("อาวุโส")).toBeInTheDocument();
  });

  it("shows a per-row project label when the SA runs more than one project", () => {
    render(
      <CrewProgressRoster
        data={{ ...EMPTY, ready: [{ id: "w3", name: "สมปอง", level: "mid", projectLabel: "TFM" }] }}
        registrationsHref="/sa/registrations"
      />,
    );
    expect(screen.getByText(/TFM/)).toBeInTheDocument();
  });

  it("shows a count per gate", () => {
    render(
      <CrewProgressRoster
        data={{
          needsReview: [{ id: "r1", name: "ก" }],
          awaitingConfirm: [
            { id: "w1", name: "ข", level: null },
            { id: "w2", name: "ค", level: null },
          ],
          ready: [],
        }}
        registrationsHref="/sa/registrations"
      />,
    );
    expect(within(screen.getByLabelText("รอตรวจ")).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByLabelText("รอยืนยัน")).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByLabelText("พร้อม")).getByText("0")).toBeInTheDocument();
  });

  it("shows an onboarding hint when every gate is empty", () => {
    render(<CrewProgressRoster data={EMPTY} registrationsHref="/sa/registrations" />);
    expect(screen.getByText(/ยังไม่มีช่าง/)).toBeInTheDocument();
  });

  it("never says อนุมัติ — the SA reviews registrations, the PM approves (view-only)", () => {
    // Empty-state onboarding hint carries no approve verb.
    const { rerender } = render(
      <CrewProgressRoster data={EMPTY} registrationsHref="/sa/registrations" />,
    );
    expect(screen.queryByText(/อนุมัติ/)).toBeNull();
    // With a pending registration the CTA is a review link (ตรวจ, not อนุมัติ).
    rerender(
      <CrewProgressRoster
        data={{ ...EMPTY, needsReview: [{ id: "r1", name: "ก" }] }}
        registrationsHref="/sa/registrations"
      />,
    );
    expect(screen.queryByText(/อนุมัติ/)).toBeNull();
    expect(screen.getByRole("link", { name: /ตรวจคำขอสมัคร/ })).toBeInTheDocument();
  });
});
