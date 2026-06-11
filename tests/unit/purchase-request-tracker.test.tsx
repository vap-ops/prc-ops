// Spec 22 — order-tracking stepper. Load-bearing rules: all five stages
// always visible in lifecycle order, the furthest reached stage carries
// aria-current="step", rejected replaces the approve stage with a red
// terminal and mutes the rest, a skipped on_route stage (delivered with
// shipped_at null) renders done-with-no-date, and ETA shows under the
// delivery stage only while undelivered.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";

const BASE = {
  requestedAt: "2026-06-01T08:00:00Z",
  decidedAt: null,
  purchasedAt: null,
  shippedAt: null,
  deliveredAt: null,
  eta: null,
};

function steps() {
  return screen.getAllByRole("listitem");
}

describe("PurchaseRequestTracker (spec 22)", () => {
  it("renders the five lifecycle stages in order", () => {
    render(<PurchaseRequestTracker status="requested" {...BASE} />);
    expect(steps().map((li) => li.getAttribute("data-stage"))).toEqual([
      "requested",
      "approved",
      "purchased",
      "on_route",
      "delivered",
    ]);
    expect(screen.getByText("ส่งคำขอ")).toBeInTheDocument();
    expect(screen.getByText("อนุมัติ")).toBeInTheDocument();
    expect(screen.getByText("สั่งซื้อ")).toBeInTheDocument();
    expect(screen.getByText("กำลังจัดส่ง")).toBeInTheDocument();
    expect(screen.getByText("ได้รับของ")).toBeInTheDocument();
  });

  it("marks the furthest reached stage with aria-current=step", () => {
    render(
      <PurchaseRequestTracker
        status="on_route"
        {...BASE}
        decidedAt="2026-06-02T08:00:00Z"
        purchasedAt="2026-06-03T08:00:00Z"
        shippedAt="2026-06-04T08:00:00Z"
      />,
    );
    const current = steps().filter((li) => li.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-stage", "on_route");
    expect(current[0]).toHaveAttribute("data-state", "done");
    // Earlier stages done, later stage pending.
    expect(steps()[2]).toHaveAttribute("data-state", "done");
    expect(steps()[4]).toHaveAttribute("data-state", "pending");
  });

  it("rejected renders a red terminal at the decision stage and mutes the rest", () => {
    render(<PurchaseRequestTracker status="rejected" {...BASE} decidedAt="2026-06-02T08:00:00Z" />);
    expect(screen.getByText("ไม่อนุมัติ")).toBeInTheDocument();
    expect(screen.queryByText("อนุมัติ")).not.toBeInTheDocument();
    const byStage = Object.fromEntries(steps().map((li) => [li.getAttribute("data-stage"), li]));
    expect(byStage["approved"]).toHaveAttribute("data-state", "rejected");
    expect(byStage["purchased"]).toHaveAttribute("data-state", "cancelled");
    expect(byStage["on_route"]).toHaveAttribute("data-state", "cancelled");
    expect(byStage["delivered"]).toHaveAttribute("data-state", "cancelled");
  });

  it("delivered with shipped_at null shows on_route as done without a date", () => {
    render(
      <PurchaseRequestTracker
        status="delivered"
        {...BASE}
        decidedAt="2026-06-02T08:00:00Z"
        purchasedAt="2026-06-03T08:00:00Z"
        deliveredAt="2026-06-05T08:00:00Z"
      />,
    );
    const onRoute = steps().find((li) => li.getAttribute("data-stage") === "on_route");
    expect(onRoute).toHaveAttribute("data-state", "done");
    expect(onRoute).toHaveTextContent("—");
  });

  it("cancelled renders approve as done and the rest as muted cancelled stages (spec 27)", () => {
    render(
      <PurchaseRequestTracker status="cancelled" {...BASE} decidedAt="2026-06-02T08:00:00Z" />,
    );
    const byStage = Object.fromEntries(steps().map((li) => [li.getAttribute("data-stage"), li]));
    expect(byStage["requested"]).toHaveAttribute("data-state", "done");
    expect(byStage["approved"]).toHaveAttribute("data-state", "done");
    expect(byStage["purchased"]).toHaveAttribute("data-state", "cancelled");
    expect(byStage["on_route"]).toHaveAttribute("data-state", "cancelled");
    expect(byStage["delivered"]).toHaveAttribute("data-state", "cancelled");
    // Administrative close, not a refusal — no red ไม่อนุมัติ rendering.
    expect(screen.queryByText("ไม่อนุมัติ")).not.toBeInTheDocument();
  });

  it("shows ETA under the delivery stage while undelivered, and not after delivery", () => {
    const { rerender } = render(
      <PurchaseRequestTracker
        status="purchased"
        {...BASE}
        decidedAt="2026-06-02T08:00:00Z"
        purchasedAt="2026-06-03T08:00:00Z"
        eta="2026-06-09"
      />,
    );
    expect(screen.getByText(/คาดว่า/)).toBeInTheDocument();
    rerender(
      <PurchaseRequestTracker
        status="delivered"
        {...BASE}
        decidedAt="2026-06-02T08:00:00Z"
        purchasedAt="2026-06-03T08:00:00Z"
        deliveredAt="2026-06-05T08:00:00Z"
        eta="2026-06-09"
      />,
    );
    expect(screen.queryByText(/คาดว่า/)).not.toBeInTheDocument();
  });
});
