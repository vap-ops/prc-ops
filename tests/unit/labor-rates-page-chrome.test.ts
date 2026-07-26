// Spec 362 U2 — /settings/labor-rates was the one registry whose page title had
// drifted off the shared token: `text-lg font-semibold` where /catalog,
// /equipment and /workers all use `text-title text-ink font-bold tracking-tight`.
// Nothing type-checks a className, so the drift survived from spec 314 until a
// four-registry comparison put the pages side by side.
//
// Source-text assertions, so BOTH directions are pinned: the registry token is
// present AND the drifted pair is gone (a presence-only pin would stay green if
// someone re-added the old classes alongside).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REGISTRY_H1 = "text-title text-ink font-bold tracking-tight";

const PAGES = {
  "labor-rates": "src/app/settings/labor-rates/page.tsx",
  equipment: "src/app/equipment/page.tsx",
  catalog: "src/app/catalog/page.tsx",
  workers: "src/app/workers/page.tsx",
} as const;

describe("registry page chrome", () => {
  it("every registry page titles itself with the shared token", () => {
    for (const [name, path] of Object.entries(PAGES)) {
      const src = readFileSync(path, "utf8");
      expect(src, `${name} lost the registry h1 token`).toContain(REGISTRY_H1);
    }
  });

  it("the labor-rates title no longer carries the drifted pair", () => {
    // COMMENTS ARE STRIPPED FIRST: the fix's own comment explains what drifted
    // and therefore quotes the retired classes — a raw-text scan would read that
    // explanation as the defect and fail the file that fixes it.
    const src = readFileSync(PAGES["labor-rates"], "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toContain("text-lg font-semibold");
  });
});
