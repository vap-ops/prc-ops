// Writing failing test first.
//
// Spec 327 U6 — the shared S/T/R view header: the PROJECT NAME is now the door
// to หน้าโครงการ (checkpoint-2 finding: reaching the project page took 5-6
// taps; the workspace already knows the selected project, so its name opens
// it, ?from-threaded back to the tab you left). เปลี่ยนโครงการ stays beside it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementProjectHeader } from "@/components/features/purchasing/procurement-project-header";

describe("ProcurementProjectHeader", () => {
  it("the project name links หน้าโครงการ with ?from back to the hosting tab", () => {
    render(
      <ProcurementProjectHeader
        projectId="p1"
        projectName="TFM โพธิ์ทอง ลพบุรี"
        from="/procurement/scope"
      />,
    );
    const name = screen.getByRole("link", { name: /TFM โพธิ์ทอง ลพบุรี/ });
    expect(name.getAttribute("href")).toContain("/projects/p1");
    expect(name.getAttribute("href")).toContain("from=%2Fprocurement%2Fscope");
  });

  it("keeps the เปลี่ยนโครงการ escape beside the name", () => {
    render(<ProcurementProjectHeader projectId="p1" projectName="X" from="/procurement/time" />);
    expect(screen.getByRole("link", { name: "เปลี่ยนโครงการ" }).getAttribute("href")).toBe(
      "/procurement",
    );
  });
});
