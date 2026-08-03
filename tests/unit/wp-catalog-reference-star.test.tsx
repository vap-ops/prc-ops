// Spec 389 U5 — the PD-tier star toggle on WP-detail photo tiles, and the
// PhaseGallery contract: star buttons render ONLY when the starring prop is
// provided — every other PhaseGallery surface (review page) stays untouched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReferenceStarButton } from "@/components/features/wp-catalog/reference-star-button";
import { PhaseGallery } from "@/components/features/photos/phase-gallery";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

const starReferencePhoto = vi.fn();
const unstarReferencePhoto = vi.fn();
vi.mock("@/lib/wp-catalog/star-actions", () => ({
  starReferencePhoto: (...args: unknown[]) => starReferencePhoto(...args) as unknown,
  unstarReferencePhoto: (...args: unknown[]) => unstarReferencePhoto(...args) as unknown,
}));

beforeEach(() => {
  starReferencePhoto.mockReset().mockResolvedValue({ ok: true });
  unstarReferencePhoto.mockReset().mockResolvedValue({ ok: true });
});

const photo = (id: string): PhotoLogRow =>
  ({
    id,
    work_package_id: "w1",
    phase: "after",
    storage_path: `p/${id}.jpg`,
    superseded_by: null,
    uploaded_by: "u1",
    created_at: "2026-08-01T00:00:00Z",
    captured_at_client: null,
    rework_round: 0,
    answers_photo_id: null,
  }) as PhotoLogRow;

describe("ReferenceStarButton", () => {
  it("stars an unstarred photo", async () => {
    render(<ReferenceStarButton projectId="pr" workPackageId="w1" photoId="p1" starred={false} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ปักดาว/ }));
    });
    expect(starReferencePhoto).toHaveBeenCalledWith("pr", "w1", "p1");
  });

  it("un-stars a starred photo", async () => {
    render(<ReferenceStarButton projectId="pr" workPackageId="w1" photoId="p1" starred={true} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /เอาดาวออก/ }));
    });
    expect(unstarReferencePhoto).toHaveBeenCalledWith("pr", "w1", "p1");
  });
});

describe("PhaseGallery starring contract", () => {
  const base = {
    label: "หลังทำงาน",
    photos: [photo("p1")],
    signedUrls: new Map([["p1", "https://signed/p1.jpg"]]),
    uploaderNames: new Map<string, string>(),
  };

  it("renders NO star button without the starring prop (review surfaces unchanged)", () => {
    render(<PhaseGallery {...base} />);
    expect(screen.queryByRole("button", { name: /ดาว/ })).not.toBeInTheDocument();
  });

  it("renders a star button per tile when starring is provided", () => {
    render(
      <PhaseGallery
        {...base}
        starring={{ projectId: "pr", workPackageId: "w1", starredPhotoIds: ["p1"] }}
      />,
    );
    expect(screen.getByRole("button", { name: /เอาดาวออก/ })).toBeInTheDocument();
  });
});
