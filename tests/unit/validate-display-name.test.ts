// Pure validator for the display-name self-edit (feature spec 05).
// The DB function `public.update_my_display_name` is the security
// authority — these tests pin down the UX-side rules so the form can
// show inline errors before the round-trip. The rules must mirror the
// SQL: trim, reject empty-after-trim, reject `> 80` chars.

import { describe, it, expect } from "vitest";
import { validateDisplayName } from "@/lib/profile/validate-display-name";

describe("validateDisplayName", () => {
  it("accepts a normal name", () => {
    const r = validateDisplayName("Alice");
    expect(r).toEqual({ ok: true, value: "Alice" });
  });

  it("trims leading and trailing whitespace", () => {
    const r = validateDisplayName("   Bob Smith   ");
    expect(r).toEqual({ ok: true, value: "Bob Smith" });
  });

  it("preserves internal whitespace (only trims edges)", () => {
    const r = validateDisplayName("  Bob   Smith  ");
    expect(r).toEqual({ ok: true, value: "Bob   Smith" });
  });

  it("rejects an empty string", () => {
    const r = validateDisplayName("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ว่าง/);
  });

  it("rejects whitespace-only input (empty after trim)", () => {
    const r = validateDisplayName("   \t\n  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ว่าง/);
  });

  it("accepts exactly 80 chars", () => {
    const eighty = "a".repeat(80);
    const r = validateDisplayName(eighty);
    expect(r).toEqual({ ok: true, value: eighty });
  });

  it("rejects 81 chars", () => {
    const r = validateDisplayName("a".repeat(81));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/80/);
  });

  it("measures length AFTER the trim (81 chars surrounded by whitespace is fine)", () => {
    // Without trim, this is 84 chars and would reject. After trim it's
    // 80 chars and must pass — proves the trim runs before the length
    // check, matching the SQL function's order (btrim then char_length).
    const eighty = "a".repeat(80);
    const r = validateDisplayName(`  ${eighty}  `);
    expect(r).toEqual({ ok: true, value: eighty });
  });

  it("rejects when the post-trim length is 81 even if the raw input is longer", () => {
    const eightyOne = "a".repeat(81);
    const r = validateDisplayName(`  ${eightyOne}  `);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/80/);
  });
});
