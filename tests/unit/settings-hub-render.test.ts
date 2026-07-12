// Guard: the ตั้งค่า hub renders each section via an explicit configSection("key")
// call (hand-ordered, interleaved with account/theme/about blocks). Adding a
// section to sections.ts is NOT enough — the hub must also render it, or the
// menu is invisible (spec 310: the office-expenses section shipped in the config
// but was never rendered → super_admin couldn't find it). This asserts no
// configured section is orphaned from the hub.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SETTINGS_SECTIONS } from "@/app/settings/sections";

describe("settings hub render coverage", () => {
  it("renders every configured section (no orphaned section)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/settings/page.tsx"), "utf8");
    const rendered = [...src.matchAll(/configSection\("([^"]+)"\)/g)].map((m) => m[1]);
    const missing = SETTINGS_SECTIONS.map((s) => s.key).filter((k) => !rendered.includes(k));
    expect(missing).toEqual([]);
  });
});
