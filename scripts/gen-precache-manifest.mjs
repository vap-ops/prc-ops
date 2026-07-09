// Spec 290 — postbuild precache-manifest generator.
//
// Walks the freshly-built `.next/static` tree and writes
// `public/precache-manifest.json` — the deploy's immutable-asset list the
// service worker warms from (`warmStaticCache` in public/sw.js). Runs as part
// of `pnpm build` (`next build && node scripts/gen-precache-manifest.mjs`), so
// the manifest ships with every deploy, always matching that deploy's hashed
// chunk names. The manifest deliberately lives under public/ (served
// must-revalidate, never immutable) so a stale copy can't wedge; the SW
// re-enforces the /_next/static/ allowlist on every entry regardless.

import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Recursively collect a built .next/static tree as sorted /_next/static/ URLs. */
export function collectStaticAssets(staticDir) {
  if (!existsSync(staticDir)) return [];
  const assets = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`);
      else assets.push(`${prefix}/${name}`);
    }
  };
  walk(staticDir, "/_next/static");
  return assets.sort();
}

/** The documented manifest shape — one key, one array. */
export function buildManifest(assets) {
  return JSON.stringify({ assets });
}

// CLI entry: node scripts/gen-precache-manifest.mjs (from the repo root).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assets = collectStaticAssets(join(process.cwd(), ".next", "static"));
  const out = join(process.cwd(), "public", "precache-manifest.json");
  writeFileSync(out, buildManifest(assets));
  console.log(`[precache-manifest] wrote ${assets.length} assets to ${out}`);
}
