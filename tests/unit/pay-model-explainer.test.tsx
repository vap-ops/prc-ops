// Spec 314 U4 (help) — the pay-model explainer on /settings/labor-rates. A zero-JS
// <details> accordion rendering the typed PAY_MODEL_HELP content: title (summary),
// intro, and each concept point (term + detail). Collapsed by default so it never
// pushes the rate form down for repeat users; the content is still in the DOM.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PayModelExplainer } from "@/components/features/labor/pay-model-explainer";
import {
  PAY_MODEL_HELP_TITLE,
  PAY_MODEL_HELP_INTRO,
  PAY_MODEL_HELP_POINTS,
} from "@/lib/help/pay-model-help";

describe("PayModelExplainer", () => {
  it("renders the title as the accordion summary", () => {
    const { container } = render(<PayModelExplainer />);
    const summary = container.querySelector("summary");
    expect(summary?.textContent).toContain(PAY_MODEL_HELP_TITLE);
  });

  it("is a <details> accordion, collapsed by default", () => {
    const { container } = render(<PayModelExplainer />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("renders the intro", () => {
    render(<PayModelExplainer />);
    expect(screen.getByText(PAY_MODEL_HELP_INTRO)).toBeTruthy();
  });

  it("renders every concept point (term + detail)", () => {
    render(<PayModelExplainer />);
    for (const point of PAY_MODEL_HELP_POINTS) {
      expect(screen.getByText(point.term)).toBeTruthy();
      expect(screen.getByText(point.detail)).toBeTruthy();
    }
  });

  it("covers the three pay-model concepts operators must learn", () => {
    const { container } = render(<PayModelExplainer />);
    const text = container.textContent ?? "";
    // (a) gross-vs-net basis terms; (b) daily default; (c) payroll gross/WHT/net.
    expect(text).toContain("ก่อนหักภาษี");
    expect(text).toContain("หลังหักภาษี");
    expect(text).toContain("รายวัน");
    expect(text).toContain("หัก ณ ที่จ่าย");
    expect(text).toContain("สุทธิ");
  });
});
