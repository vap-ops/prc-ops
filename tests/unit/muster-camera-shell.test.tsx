// Writing failing test first.
//
// Spec 357 U-D — MusterCamera loses its standalone overlay shell: the add sheet
// (muster-add-sheet.tsx) owns the chrome (backdrop, close button), the camera
// renders only its viewfinder/error view. The decode loop itself stays
// untestable in jsdom (getUserMedia absent) — these tests pin the SHELL: in the
// error state (jsdom's guaranteed path) there is no ปิดกล้อง button and no
// fixed overlay wrapper, and the error copy is the neutral form (the old copy
// named the removed + เพิ่มช่าง button).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MusterCamera } from "@/components/features/muster/muster-camera";

describe("MusterCamera — shell-less viewfinder (spec 357 U-D)", () => {
  it("error state renders neutral copy with no overlay chrome of its own", async () => {
    const { container } = render(<MusterCamera onDetected={() => {}} />);
    expect(await screen.findByText("เปิดกล้องไม่ได้")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ปิดกล้อง" })).toBeNull();
    expect(container.querySelector(".fixed")).toBeNull();
  });
});
