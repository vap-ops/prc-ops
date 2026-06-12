// Unit tests for the AttentionCard primitive (spec 54) — the mockup's
// "amber left bar + dot + bold imperative title" callout, shared by the
// contractor-assignment card and the rejected/needs_revision strip.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { AttentionCard } from "@/components/features/attention-card";

describe("AttentionCard", () => {
  it("renders the bold title and the body content", () => {
    render(
      <AttentionCard tone="amber" title="ต้องมอบหมายผู้รับเหมาก่อนเริ่มงาน">
        <p>งานนี้ยังไม่มีผู้รับเหมา</p>
      </AttentionCard>,
    );
    expect(screen.getByText("ต้องมอบหมายผู้รับเหมาก่อนเริ่มงาน")).toBeInTheDocument();
    expect(screen.getByText("งานนี้ยังไม่มีผู้รับเหมา")).toBeInTheDocument();
  });

  it("amber tone carries the amber left bar; red tone the red one", () => {
    const { container: amber } = render(
      <AttentionCard tone="amber" title="t">
        x
      </AttentionCard>,
    );
    const { container: red } = render(
      <AttentionCard tone="red" title="t">
        x
      </AttentionCard>,
    );
    expect(amber.firstElementChild?.className).toContain("border-l-amber");
    expect(red.firstElementChild?.className).toContain("border-l-red");
  });

  it("is an alert region (role=alert) — same contract as the strip it replaces", () => {
    render(
      <AttentionCard tone="red" title="ให้แก้ไข">
        x
      </AttentionCard>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
