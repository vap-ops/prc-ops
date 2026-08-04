// Spec 389 U5 — the PD-tier star toggle on REVIEW-page photo tiles, and the
// PhaseGallery contract: star buttons render ONLY when the starring prop is
// provided — every other PhaseGallery surface (the WP-detail read-only
// galleries) stays untouched.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReferenceStarButton } from "@/components/features/wp-catalog/reference-star-button";
import { PhaseGallery } from "@/components/features/photos/phase-gallery";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

const starReferencePhoto = vi.fn();
const unstarReferencePhoto = vi.fn();
// Spec 391 D5 — mocked alongside the star pair. ⚠️ A mock that omits an arm
// makes that whole branch unreachable in every test in the file while the suite
// stays green (the spec-390 U2 lesson: the Telegram arm was "pinned" by a
// harness that had pinned its token to undefined).
const hideReferencePhoto = vi.fn();
const unhideReferencePhoto = vi.fn();
vi.mock("@/lib/wp-catalog/star-actions", () => ({
  starReferencePhoto: (...args: unknown[]) => starReferencePhoto(...args) as unknown,
  unstarReferencePhoto: (...args: unknown[]) => unstarReferencePhoto(...args) as unknown,
  hideReferencePhoto: (...args: unknown[]) => hideReferencePhoto(...args) as unknown,
  unhideReferencePhoto: (...args: unknown[]) => unhideReferencePhoto(...args) as unknown,
}));

beforeEach(() => {
  starReferencePhoto.mockReset().mockResolvedValue({ ok: true });
  unstarReferencePhoto.mockReset().mockResolvedValue({ ok: true });
  hideReferencePhoto.mockReset().mockResolvedValue({ ok: true });
  unhideReferencePhoto.mockReset().mockResolvedValue({ ok: true });
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
    render(
      <ReferenceStarButton
        projectId="pr"
        workPackageId="w1"
        photoId="p1"
        starred={false}
        hidden={false}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ปักดาว/ }));
    });
    expect(starReferencePhoto).toHaveBeenCalledWith("pr", "w1", "p1");
  });

  it("un-stars a starred photo", async () => {
    render(
      <ReferenceStarButton
        projectId="pr"
        workPackageId="w1"
        photoId="p1"
        starred={true}
        hidden={false}
      />,
    );
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
        starring={{
          projectId: "pr",
          workPackageId: "w1",
          starredPhotoIds: ["p1"],
          hiddenPhotoIds: [],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: /เอาดาวออก/ })).toBeInTheDocument();
  });
});

// Writing failing test first.
//
// Spec 391 D5 — ไม่ใช้เป็นตัวอย่าง. Hiding is a SEPARATE act from un-starring:
// since 391 the ตัวอย่างงาน set fills itself, so most of what a PD sees there was
// never starred and there is no star to remove. The two controls must therefore
// be independently reachable, and each must call its own action.
describe("ReferenceStarButton — the hide control (spec 391 D5)", () => {
  it("hides an un-hidden photo", async () => {
    render(
      <ReferenceStarButton
        projectId="pr"
        workPackageId="w1"
        photoId="p1"
        starred={false}
        hidden={false}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ไม่ใช้รูปนี้เป็นตัวอย่าง/ }));
    });
    expect(hideReferencePhoto).toHaveBeenCalledWith("pr", "w1", "p1");
    // …and did NOT touch the star, which answers a different question.
    expect(starReferencePhoto).not.toHaveBeenCalled();
    expect(unstarReferencePhoto).not.toHaveBeenCalled();
  });

  it("un-hides a hidden photo", async () => {
    render(
      <ReferenceStarButton
        projectId="pr"
        workPackageId="w1"
        photoId="p1"
        starred={false}
        hidden={true}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ใช้เป็นตัวอย่างได้อีกครั้ง/ }));
    });
    expect(unhideReferencePhoto).toHaveBeenCalledWith("pr", "w1", "p1");
  });

  // The states are independent — a photo can be starred AND hidden (hiding wins
  // in the reader). A UI that collapsed them into one tri-state control would
  // make that unreachable, so both controls must render together.
  it("offers BOTH controls on a starred-and-hidden photo", () => {
    render(
      <ReferenceStarButton
        projectId="pr"
        workPackageId="w1"
        photoId="p1"
        starred={true}
        hidden={true}
      />,
    );
    expect(screen.getByRole("button", { name: /เอาดาวออก/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ใช้เป็นตัวอย่างได้อีกครั้ง/ })).toBeInTheDocument();
  });
});
