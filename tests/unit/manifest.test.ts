// Shape pins for the PWA manifest (spec 18 item D). The manifest is what
// makes the app installable; these pins keep the load-bearing fields from
// drifting (Thai locale, standalone display, zinc-950 theme, 512 icon +
// maskable entry).

import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  const m = manifest();

  it("identifies the app in Thai with the brand name kept Latin", () => {
    expect(m.name).toBe("PRC Ops");
    expect(m.short_name).toBe("PRC Ops");
    expect(m.lang).toBe("th");
    expect(m.description).toMatch(/ก่อสร้าง/);
  });

  it("opens standalone from the app root", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
  });

  it("uses the zinc-950 ground for theme and splash", () => {
    expect(m.theme_color).toBe("#09090b");
    expect(m.background_color).toBe("#09090b");
  });

  it("carries a 512x512 icon and a maskable entry", () => {
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.sizes === "512x512")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    expect(icons.some((i) => i.sizes === "192x192")).toBe(true);
  });
});
