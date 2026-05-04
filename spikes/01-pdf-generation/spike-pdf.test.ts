import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const PHASES = ["Before", "During", "After"] as const;
type Phase = (typeof PHASES)[number];

function loadFixturePhotos(): Array<{
  path: string;
  caption: string;
  timestamp: string;
  phase: Phase;
}> {
  return Array.from({ length: 30 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    const phase = PHASES[i % 3];
    if (!phase) throw new Error("phase undefined — should never happen");
    return {
      path: resolve(FIXTURES_DIR, `img-${n}.jpg`),
      caption: `Sample photo ${n}`,
      timestamp: new Date(2026, 4, i + 1, 10, 0, 0).toISOString(),
      phase,
    };
  });
}

describe("Spike 1: PDF generation with embedded images", () => {
  beforeAll(() => {
    const sample = resolve(FIXTURES_DIR, "img-01.jpg");
    if (!existsSync(sample)) {
      throw new Error(`Fixtures missing. Run: pnpm spike:fixtures`);
    }
  });

  it("generates a PDF file at the expected path", async () => {
    const { generatePdf } = await import("./generate-pdf");
    const path = await generatePdf(loadFixturePhotos());
    expect(existsSync(path)).toBe(true);
  }, 60_000);

  it("generated PDF is under 50MB", async () => {
    const { generatePdf } = await import("./generate-pdf");
    const path = await generatePdf(loadFixturePhotos());
    expect(statSync(path).size).toBeLessThan(50 * 1024 * 1024);
  }, 60_000);

  it("PDF embeds images, not external links (works offline)", async () => {
    const { generatePdf } = await import("./generate-pdf");
    const path = await generatePdf(loadFixturePhotos());
    const buffer = readFileSync(path);
    const content = buffer.toString("latin1");
    // Embedded images appear as Image XObjects in the PDF.
    expect(content).toContain("/Subtype /Image");
    // No external file: or http: URI references.
    expect(content).not.toMatch(/\/URI\s*\(file:/);
    expect(content).not.toMatch(/\/URI\s*\(https?:/);
  }, 60_000);

  it("generates within 30 seconds", async () => {
    const { generatePdf } = await import("./generate-pdf");
    const start = Date.now();
    await generatePdf(loadFixturePhotos());
    expect(Date.now() - start).toBeLessThan(30_000);
  }, 60_000);
});
