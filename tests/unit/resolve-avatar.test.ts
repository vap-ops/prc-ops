import { describe, it, expect } from "vitest";
import { resolveAvatar, getInitials } from "@/lib/profile/resolve-avatar";

describe("resolveAvatar", () => {
  it("returns uploaded when both uploadedUrl and lineUrl present", () => {
    const r = resolveAvatar({ uploadedUrl: "https://cdn/up.jpg", lineUrl: "https://cdn/line.jpg" });
    expect(r).toEqual({ kind: "uploaded", url: "https://cdn/up.jpg" });
  });

  it("returns line when uploadedUrl is absent", () => {
    const r = resolveAvatar({ lineUrl: "https://cdn/line.jpg" });
    expect(r).toEqual({ kind: "line", url: "https://cdn/line.jpg" });
  });

  it("returns line when uploadedUrl is null", () => {
    const r = resolveAvatar({ uploadedUrl: null, lineUrl: "https://cdn/line.jpg" });
    expect(r).toEqual({ kind: "line", url: "https://cdn/line.jpg" });
  });

  it("returns initials when neither url present", () => {
    const r = resolveAvatar({});
    expect(r).toEqual({ kind: "initials" });
  });

  it("returns initials when uploadedUrl is null and lineUrl is null", () => {
    const r = resolveAvatar({ uploadedUrl: null, lineUrl: null });
    expect(r).toEqual({ kind: "initials" });
  });

  it("returns initials when lineUrl is undefined", () => {
    const r = resolveAvatar({ uploadedUrl: null });
    expect(r).toEqual({ kind: "initials" });
  });
});

describe("getInitials", () => {
  it("returns first letter of a single-word name", () => {
    expect(getInitials("Alice")).toBe("A");
  });

  it("returns first letters of a two-word name", () => {
    expect(getInitials("Alice Smith")).toBe("AS");
  });

  it("uses only first two words for three-word names", () => {
    expect(getInitials("Alice Mary Smith")).toBe("AM");
  });

  it("trims surrounding whitespace before splitting", () => {
    expect(getInitials("  Bob  Jones  ")).toBe("BJ");
  });

  it("uppercases the result", () => {
    expect(getInitials("alice jones")).toBe("AJ");
  });

  it("returns empty string for null", () => {
    expect(getInitials(null)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(getInitials("")).toBe("");
  });

  it("returns empty string for whitespace-only string", () => {
    expect(getInitials("   ")).toBe("");
  });
});
