// Spec 95 diagnostic: a flag-gated overlay that prints the live iOS viewport
// metrics so the operator can report the exact dimension that is stale after the
// keyboard closes (the "bottom blank gap"). Inert unless the vpdebug flag is set,
// so it never reaches normal users.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ViewportDebug } from "@/components/features/chrome/viewport-debug";

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("ViewportDebug", () => {
  it("renders nothing without the vpdebug flag", () => {
    const { container } = render(<ViewportDebug />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the metrics overlay when the vpdebug localStorage flag is set", () => {
    window.localStorage.setItem("vpdebug", "1");
    const { queryByTestId } = render(<ViewportDebug />);
    expect(queryByTestId("viewport-debug")).not.toBeNull();
  });
});
