// Unit tests for the pure decision/validation helpers behind the PR 2
// write path. The server-action wiring and the Storage I/O aren't
// unit-testable here; these helpers are.

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isValidPhotoExt,
  isValidUuid,
  buildPhotoStoragePath,
  mimeToPhotoExt,
  PHOTO_EXTS,
  type PhotoExt,
} from "@/lib/photos/path";
import {
  shouldTransitionToInProgress,
  shouldTransitionToPendingApproval,
} from "@/lib/photos/transitions";
import { buildTombstoneRow } from "@/lib/photos/tombstone";

describe("isValidPhotoExt", () => {
  it("accepts exactly the four canonical extensions", () => {
    for (const ext of PHOTO_EXTS) {
      expect(isValidPhotoExt(ext)).toBe(true);
    }
  });

  it("rejects jpg (must be normalised to jpeg)", () => {
    expect(isValidPhotoExt("jpg")).toBe(false);
  });

  it("rejects unrelated extensions", () => {
    for (const v of ["gif", "bmp", "svg", "tiff", "mp4", "JPEG", ""]) {
      expect(isValidPhotoExt(v)).toBe(false);
    }
  });

  it("rejects non-string values", () => {
    expect(isValidPhotoExt(null)).toBe(false);
    expect(isValidPhotoExt(undefined)).toBe(false);
    expect(isValidPhotoExt(123)).toBe(false);
    expect(isValidPhotoExt({})).toBe(false);
  });
});

describe("isValidUuid", () => {
  it("accepts a well-formed v4 uuid", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isValidUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("rejects mis-shaped strings", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
    expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false);
    // path-traversal style — must be rejected
    expect(isValidUuid("../etc/passwd")).toBe(false);
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000/extra")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
  });
});

describe("buildPhotoStoragePath", () => {
  it("formats the canonical {project_id}/{wp_id}/{photo_id}.{ext} shape", () => {
    const path = buildPhotoStoragePath(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "jpeg",
    );
    expect(path).toBe(
      "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpeg",
    );
  });
});

describe("mimeToPhotoExt", () => {
  it("maps the four supported MIMEs to their canonical extensions", () => {
    expect(mimeToPhotoExt("image/jpeg")).toBe("jpeg");
    expect(mimeToPhotoExt("image/png")).toBe("png");
    expect(mimeToPhotoExt("image/webp")).toBe("webp");
    expect(mimeToPhotoExt("image/heic")).toBe("heic");
  });

  it("returns null for unsupported MIMEs", () => {
    expect(mimeToPhotoExt("image/gif")).toBeNull();
    expect(mimeToPhotoExt("video/mp4")).toBeNull();
    expect(mimeToPhotoExt("")).toBeNull();
    expect(mimeToPhotoExt("image/JPEG")).toBeNull();
  });
});

describe("shouldTransitionToPendingApproval", () => {
  it("transitions only when phase is 'after' AND status is transitionable", () => {
    for (const status of ["not_started", "in_progress", "on_hold"] as const) {
      expect(shouldTransitionToPendingApproval("after", status)).toBe(true);
    }
  });

  it("does NOT transition for non-After phases regardless of status", () => {
    for (const phase of ["before", "during"] as const) {
      for (const status of [
        "not_started",
        "in_progress",
        "on_hold",
        "pending_approval",
        "complete",
      ] as const) {
        expect(shouldTransitionToPendingApproval(phase, status)).toBe(false);
      }
    }
  });

  it("does NOT regress 'pending_approval' or 'complete' on an After photo", () => {
    expect(shouldTransitionToPendingApproval("after", "pending_approval")).toBe(false);
    expect(shouldTransitionToPendingApproval("after", "complete")).toBe(false);
  });
});

describe("shouldTransitionToInProgress", () => {
  it("transitions ONLY for phase 'during' on a 'not_started' WP (one true cell in the matrix)", () => {
    for (const phase of ["before", "during", "after"] as const) {
      for (const status of [
        "not_started",
        "in_progress",
        "on_hold",
        "pending_approval",
        "complete",
      ] as const) {
        expect(shouldTransitionToInProgress(phase, status)).toBe(
          phase === "during" && status === "not_started",
        );
      }
    }
  });

  it("does NOT release 'on_hold' — hold is a deliberate PM flag (spec 52)", () => {
    expect(shouldTransitionToInProgress("during", "on_hold")).toBe(false);
  });

  it("never regresses 'pending_approval' or 'complete'", () => {
    expect(shouldTransitionToInProgress("during", "pending_approval")).toBe(false);
    expect(shouldTransitionToInProgress("during", "complete")).toBe(false);
  });
});

describe("buildTombstoneRow", () => {
  it("produces a row with storage_path NULL and superseded_by set to the target id", () => {
    const row = buildTombstoneRow({
      workPackageId: "wp-uuid",
      phase: "after",
      targetPhotoId: "target-uuid",
      uploadedBy: "user-uuid",
    });
    expect(row.storage_path).toBeNull();
    expect(row.superseded_by).toBe("target-uuid");
    expect(row.work_package_id).toBe("wp-uuid");
    expect(row.phase).toBe("after");
    expect(row.uploaded_by).toBe("user-uuid");
  });

  it("satisfies the ADR 0015 well-formedness invariant ((path NULL) = (superseded_by NOT NULL))", () => {
    const row = buildTombstoneRow({
      workPackageId: "wp",
      phase: "before",
      targetPhotoId: "t",
      uploadedBy: "u",
    });
    // Both sides of the CHECK constraint must agree.
    expect(row.storage_path === null).toBe(true);
    expect(row.superseded_by !== null).toBe(true);
  });
});

// Type-level smoke: PhotoExt is exactly the union of PHOTO_EXTS values.
const _typeCheck: PhotoExt[] = [...PHOTO_EXTS];
void _typeCheck;
