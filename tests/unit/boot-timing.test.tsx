// TEMPORARY perf overlay (boot timing). Renders the Navigation Timing split so the
// ~2s boot is profiled on the real device. Removed once the boot is fixed.

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BootTiming } from "@/components/features/chrome/boot-timing";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("BootTiming", () => {
  it("renders the timing overlay", () => {
    const { queryByTestId } = render(<BootTiming />);
    expect(queryByTestId("boot-timing")).not.toBeNull();
  });
});
