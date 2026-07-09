// Spec 290 — the postbuild precache-manifest generator. RED first: the script
// does not exist yet. collectStaticAssets walks a built .next/static tree and
// returns the deploy's asset URLs (sorted, /_next/static/-prefixed).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { collectStaticAssets, buildManifest } from "../../scripts/gen-precache-manifest.mjs";

const root = mkdtempSync(join(tmpdir(), "precache-test-"));
const staticDir = join(root, ".next", "static");
mkdirSync(join(staticDir, "chunks", "app"), { recursive: true });
mkdirSync(join(staticDir, "css"), { recursive: true });
mkdirSync(join(staticDir, "media"), { recursive: true });
writeFileSync(join(staticDir, "chunks", "main-abc123.js"), "x");
writeFileSync(join(staticDir, "chunks", "app", "page-def456.js"), "x");
writeFileSync(join(staticDir, "css", "styles-789.css"), "x");
writeFileSync(join(staticDir, "media", "font-xyz.woff2"), "x");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("gen-precache-manifest", () => {
  it("walks .next/static recursively and returns sorted /_next/static/ URLs", () => {
    const assets = collectStaticAssets(staticDir);
    expect(assets).toEqual([
      "/_next/static/chunks/app/page-def456.js",
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/styles-789.css",
      "/_next/static/media/font-xyz.woff2",
    ]);
  });

  it("uses forward slashes regardless of platform", () => {
    const assets = collectStaticAssets(staticDir);
    for (const a of assets) expect(a).not.toContain("\\");
  });

  it("buildManifest wraps the assets in the documented shape", () => {
    const manifest = buildManifest(["/_next/static/chunks/a.js"]);
    expect(JSON.parse(manifest)).toEqual({ assets: ["/_next/static/chunks/a.js"] });
  });

  it("returns [] for a missing directory (fail-open at build)", () => {
    expect(collectStaticAssets(join(root, "does-not-exist"))).toEqual([]);
  });
});
