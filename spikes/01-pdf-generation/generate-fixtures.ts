import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(__dirname, "fixtures");
const COUNT = 30;
const WIDTH = 1280;
const HEIGHT = 960;
const QUALITY = 70;

async function generateOne(index: number): Promise<{ path: string; bytes: number }> {
  const n = String(index).padStart(2, "0");
  const path = resolve(FIXTURES_DIR, `img-${n}.jpg`);
  const noise = randomBytes(WIDTH * HEIGHT * 3);
  const info = await sharp(noise, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .jpeg({ quality: QUALITY })
    .toFile(path);
  return { path, bytes: info.size };
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  let total = 0;
  for (let i = 1; i <= COUNT; i++) {
    const { bytes } = await generateOne(i);
    total += bytes;
    process.stdout.write(
      `  img-${String(i).padStart(2, "0")}.jpg  ${(bytes / 1024).toFixed(0)} KB\n`,
    );
  }
  process.stdout.write(
    `\nGenerated ${COUNT} fixtures, ${(total / 1024 / 1024).toFixed(1)} MB total in ${FIXTURES_DIR}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
