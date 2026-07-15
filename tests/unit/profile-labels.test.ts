// Spec 321 U1 — the profile-edit door names are single-sourced in labels.ts.
// S11 (session investigation 2026-07-15): "ข้อมูลของฉัน" and "โปรไฟล์" were
// hardcoded across my-info / sections / profile / coming-soon / settings with no
// constant — a rename would silently miss copies. These constants are the SSOT;
// the label-ssot guard (SINGLE_SOURCED_TERMS) enforces no stray literals remain.

import { describe, expect, it } from "vitest";
import { MY_INFO_LABEL, PROFILE_LABEL } from "@/lib/i18n/labels";

describe("spec 321 profile-edit door-name labels (SSOT)", () => {
  it("MY_INFO_LABEL is the canonical door name", () => {
    expect(MY_INFO_LABEL).toBe("ข้อมูลของฉัน");
  });

  it("PROFILE_LABEL is the canonical /profile card name", () => {
    expect(PROFILE_LABEL).toBe("โปรไฟล์");
  });
});
