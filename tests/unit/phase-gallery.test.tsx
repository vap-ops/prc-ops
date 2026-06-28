// Feedback a6037564 — the photo grid should show WHO uploaded each photo at a
// glance, not only inside the opened lightbox. (The lightbox already shows
// "ถ่ายโดย <name>"; this adds the name to the filmstrip thumbnail overlay.)

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseGallery } from "@/components/features/photos/phase-gallery";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

function photo(id: string, uploadedBy: string): PhotoLogRow {
  return {
    id,
    work_package_id: "wp1",
    phase: "after",
    storage_path: `path/${id}.jpg`,
    superseded_by: null,
    uploaded_by: uploadedBy,
    created_at: "2026-06-28T03:00:00Z",
    captured_at_client: "2026-06-28T03:00:00Z",
    rework_round: 0,
  };
}

const photos = [photo("p1", "u1"), photo("p2", "u2")];
const signedUrls = new Map([
  ["p1", "https://img.example/p1.jpg"],
  ["p2", "https://img.example/p2.jpg"],
]);
const uploaderNames = new Map([
  ["u1", "สมชาย ใจดี"],
  ["u2", "สมหญิง รักงาน"],
]);

describe("PhaseGallery uploader attribution (feedback a6037564)", () => {
  it("shows each photo's uploader name on the grid thumbnail (at a glance)", () => {
    render(
      <PhaseGallery
        label="หลังทำงาน"
        photos={photos}
        signedUrls={signedUrls}
        uploaderNames={uploaderNames}
      />,
    );
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText("สมหญิง รักงาน")).toBeInTheDocument();
  });

  it("renders no uploader line when the name is unresolved", () => {
    render(
      <PhaseGallery
        label="หลังทำงาน"
        photos={[photo("p3", "u-unknown")]}
        signedUrls={new Map([["p3", "https://img.example/p3.jpg"]])}
        uploaderNames={new Map()}
      />,
    );
    // the photo still renders (its time overlay), just no name
    expect(screen.queryByText(/สมชาย/)).toBeNull();
  });
});
