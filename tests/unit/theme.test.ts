// Spec 190 U1 — dark mode. The theme setting is a cookie-backed tri-state
// (light / dark / system); resolveTheme turns it + the OS preference into a
// boolean isDark that both the no-flash script and the toggle apply. Default is
// LIGHT (operator decision 2026-06-24 — honors the spec-20 sun-first rationale;
// dark is opt-in). Pure logic, unit-tested without the DOM.

import { describe, it, expect } from "vitest";
import { parseThemeSetting, resolveTheme, THEME_COOKIE } from "@/lib/ui/theme";

describe("parseThemeSetting", () => {
  it("accepts the three valid settings", () => {
    expect(parseThemeSetting("light")).toBe("light");
    expect(parseThemeSetting("dark")).toBe("dark");
    expect(parseThemeSetting("system")).toBe("system");
  });

  it("defaults to light for missing or unknown values (sun-first, opt-in dark)", () => {
    expect(parseThemeSetting(undefined)).toBe("light");
    expect(parseThemeSetting("")).toBe("light");
    expect(parseThemeSetting("midnight")).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("explicit light/dark ignore the OS preference", () => {
    expect(resolveTheme("light", true)).toBe(false);
    expect(resolveTheme("light", false)).toBe(false);
    expect(resolveTheme("dark", false)).toBe(true);
    expect(resolveTheme("dark", true)).toBe(true);
  });

  it("system follows the OS preference", () => {
    expect(resolveTheme("system", true)).toBe(true);
    expect(resolveTheme("system", false)).toBe(false);
  });
});

describe("THEME_COOKIE", () => {
  it("is a stable cookie name", () => {
    expect(THEME_COOKIE).toBe("theme");
  });
});
