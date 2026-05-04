import { generatePdf, type SpikePhoto, type Phase } from "./generate-pdf";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const PHASES: Phase[] = ["Before", "During", "After"];
const photos: SpikePhoto[] = Array.from({ length: 30 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  const phase = PHASES[i % 3];
  if (!phase) throw new Error("phase undefined");
  return {
    path: resolve(__dirname, "fixtures", `img-${n}.jpg`),
    caption: `Sample photo ${n}`,
    timestamp: new Date(2026, 4, i + 1, 10, 0, 0).toISOString(),
    phase,
  };
});

async function main(): Promise<void> {
  const t0 = Date.now();
  const path = await generatePdf(photos);
  const dt = Date.now() - t0;
  const size = statSync(path).size;
  process.stdout.write(`  PDF: ${path}\n`);
  process.stdout.write(`  size: ${(size / 1024 / 1024).toFixed(2)} MB (${size} bytes)\n`);
  process.stdout.write(`  wall time: ${dt} ms\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
