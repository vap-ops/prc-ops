import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type Phase = "Before" | "During" | "After";

export interface SpikePhoto {
  path: string;
  caption: string;
  timestamp: string;
  phase: Phase;
}

const TEMPLATE_PATH = resolve(__dirname, "template.html");
const OUTPUT_DIR = resolve(__dirname, "output");
const PHASE_ORDER: Phase[] = ["Before", "During", "After"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function toDataUri(path: string): Promise<string> {
  const bytes = await readFile(path);
  const ext = extname(path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function renderCard(photo: SpikePhoto, dataUri: string): string {
  return `<article class="card">
  <div class="img-wrap"><img src="${dataUri}" alt="${escapeHtml(photo.caption)}" /></div>
  <div class="body">
    <span class="phase ${photo.phase.toLowerCase()}">${escapeHtml(photo.phase)}</span>
    <div class="caption">${escapeHtml(photo.caption)}</div>
    <div class="ts">${escapeHtml(photo.timestamp)}</div>
  </div>
</article>`;
}

export async function generatePdf(photos: SpikePhoto[]): Promise<string> {
  const sorted = [...photos].sort((a, b) => {
    const phaseDiff = PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase);
    if (phaseDiff !== 0) return phaseDiff;
    return a.timestamp.localeCompare(b.timestamp);
  });

  const cards = await Promise.all(
    sorted.map(async (photo) => renderCard(photo, await toDataUri(photo.path))),
  );

  const template = await readFile(TEMPLATE_PATH, "utf8");
  const generatedAt = new Date().toISOString();
  const html = template
    .replaceAll("{{TITLE}}", "Project Photo Report")
    .replaceAll("{{GENERATED_AT}}", generatedAt)
    .replaceAll("{{PHOTO_COUNT}}", String(sorted.length))
    .replaceAll("{{CARDS}}", cards.join("\n"));

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outPath = resolve(OUTPUT_DIR, `report-${Date.now()}.pdf`);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.pdf({
      path: outPath,
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });
  } finally {
    await browser.close();
  }

  return outPath;
}
