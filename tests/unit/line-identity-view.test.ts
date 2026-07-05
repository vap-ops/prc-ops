// Writing failing test first.
//
// Spec 265 U2 — the pure view-model behind the shared LineIdentityBlock. The
// crux is the "synced vs not-synced" state: a user who has NOT logged in since
// U1 shipped has line_synced_at === null → the block must render the
// "ยังไม่ได้ซิงค์" empty state, NOT empty fields. When synced, the block shows
// the LINE display name + original avatar URL + a "ตรวจล่าสุด {date}" label.
// This helper is the single source of that decision + the date formatting, so
// both surfaces (/registrations/[id] and /settings/roles/[id]) share it.

import { describe, expect, it } from "vitest";
import { buildLineIdentityView } from "@/lib/identity/line-identity";
import { formatThaiDateTime } from "@/lib/i18n/labels";

describe("buildLineIdentityView (spec 265 U2)", () => {
  it("marks a synced identity and surfaces name, avatar, and last-checked label", () => {
    const view = buildLineIdentityView({
      lineDisplayName: "สมชาย LINE",
      lineAvatarUrl: "https://profile.line-scdn.net/abc",
      lineSyncedAt: "2026-07-05T03:00:00.000Z",
    });

    expect(view.synced).toBe(true);
    expect(view.displayName).toBe("สมชาย LINE");
    expect(view.avatarUrl).toBe("https://profile.line-scdn.net/abc");
    // "ตรวจล่าสุด" prefix + the Bangkok/Buddhist-era formatted timestamp.
    expect(view.syncedAtLabel).toBe(`ตรวจล่าสุด ${formatThaiDateTime("2026-07-05T03:00:00.000Z")}`);
  });

  it("treats a null sync timestamp as NOT synced (never-synced empty state)", () => {
    const view = buildLineIdentityView({
      lineDisplayName: null,
      lineAvatarUrl: null,
      lineSyncedAt: null,
    });

    expect(view.synced).toBe(false);
    expect(view.syncedAtLabel).toBeNull();
    // The "not yet synced" copy is the SSOT string, exposed for the empty state.
    expect(view.notSyncedLabel).toBe("ยังไม่ได้ซิงค์ (รอผู้ใช้เข้าสู่ระบบครั้งถัดไป)");
  });

  it("is synced whenever line_synced_at is present, even if name/avatar are null", () => {
    // A login always stamps line_synced_at; a LINE profile with no name/picture
    // is still a real sync (we DID check). synced keys on the timestamp only.
    const view = buildLineIdentityView({
      lineDisplayName: null,
      lineAvatarUrl: null,
      lineSyncedAt: "2026-07-05T03:00:00.000Z",
    });

    expect(view.synced).toBe(true);
    expect(view.displayName).toBeNull();
    expect(view.avatarUrl).toBeNull();
    expect(view.syncedAtLabel).not.toBeNull();
  });
});
