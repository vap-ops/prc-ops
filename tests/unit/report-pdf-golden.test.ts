// @vitest-environment node
// (pdfkit/fontkit type-check Buffers across realms — jsdom's globals fail the
// check; the PDF path only ever runs server-side anyway.)
//
// GOLDEN CHARACTERISATION TEST for the client report PDF.
//
// Why this exists: the report is rendered by pdfkit, and a renderer upgrade can
// change pagination, font subsetting or text encoding without changing a line of
// our code. The 0.17 → 0.19 bump was verified by hand — generate on both
// versions, inflate the streams, decode the glyphs — and that comparison should
// not have to be rebuilt from scratch next time. These assertions are that
// comparison, committed.
//
// Reading a generated PDF back has three traps, all of which return "no text"
// rather than an error, so each is handled explicitly below:
//   1. every stream is Flate-compressed INCLUDING the ToUnicode CMap, so the
//      CMap cannot be found by scanning the raw file;
//   2. PDFKit writes HEX strings (`<0e07 0e32> Tj`) for embedded SUBSET fonts,
//      not parenthesised literals;
//   3. Sarabun renders SARA AM (ำ) as two glyphs, so extraction yields an extra
//      codepoint that must be recomposed before comparing with the source text.
import { inflateSync, constants } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildReportPdf } from "@/lib/reports/build-pdf";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

interface DecodedPdf {
  /** Decoded text of each page CONTENT stream, in document order. */
  pages: string[];
  /** All of the above joined — for "does the document contain X" questions. */
  all: string;
  /** Subset names of the embedded faces, e.g. "CZZZZZ+Sarabun-Regular". */
  fonts: string[];
  /** Number of glyph → character mappings recovered from the ToUnicode CMap. */
  cmapEntries: number;
  /** `/Type /Page` objects — the authoritative page count. */
  pageObjects: number;
}

function decodePdf(pdf: Buffer): DecodedPdf {
  const latin = pdf.toString("latin1");

  // Trap 1: inflate first. Plain inflateSync throws on PDFKit's trailing
  // bytes, so tolerate a truncated tail.
  const streams: string[] = [];
  for (const m of latin.matchAll(/stream\r?\n/g)) {
    try {
      streams.push(
        inflateSync(pdf.subarray(m.index + m[0].length), {
          finishFlush: constants.Z_SYNC_FLUSH,
        }).toString("latin1"),
      );
    } catch {
      // Not a Flate stream (or not inflatable) — an embedded font file or image.
    }
  }
  const joined = streams.join("\n");

  const cmap = new Map<number, string>();
  for (const block of joined.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      cmap.set(parseInt(pair[1]!, 16), String.fromCodePoint(parseInt(pair[2]!.slice(0, 4), 16)));
    }
  }
  for (const block of joined.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1]!;
    for (const r of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(r[1]!, 16);
      const hi = parseInt(r[2]!, 16);
      const dst = parseInt(r[3]!.slice(0, 4), 16);
      for (let g = lo; g <= hi; g++) cmap.set(g, String.fromCodePoint(dst + (g - lo)));
    }
    for (const r of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g)) {
      const lo = parseInt(r[1]!, 16);
      [...r[3]!.matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((d, i) =>
        cmap.set(lo + i, String.fromCodePoint(parseInt(d[1]!.slice(0, 4), 16))),
      );
    }
  }

  // Trap 2: subset fonts are shown as hex strings, not literals. Decode both.
  const fromHex = (hex: string): string => {
    const clean = hex.replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      const gid = parseInt(clean.slice(i, i + 4), 16);
      if (!Number.isNaN(gid)) out += cmap.get(gid) ?? "";
    }
    return out;
  };
  const fromLiteral = (raw: string): string => {
    const unescaped = raw.replace(/\\([()\\])/g, "$1");
    let out = "";
    for (let i = 0; i + 1 < unescaped.length; i += 2) {
      out += cmap.get((unescaped.charCodeAt(i) << 8) | unescaped.charCodeAt(i + 1)) ?? "";
    }
    return out;
  };

  // Trap 3: recompose SARA AM, which the font draws as two glyphs.
  const recompose = (s: string): string => s.replace(/ํา/g, "ำ").replace(/ำา/g, "ำ");

  // A page's content stream shows text (`BT` … `Tf`) and is not the CMap.
  const pages: string[] = [];
  for (const s of streams) {
    if (!s.includes("BT") || !/\/F\d+\s+[\d.]+\s+Tf/.test(s) || s.includes("begincmap")) continue;
    let text = "";
    for (const t of s.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) text += fromHex(t[1]!);
    for (const t of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) text += fromLiteral(t[1]!);
    for (const arr of s.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ/g)) {
      for (const t of arr[1]!.matchAll(/<([0-9A-Fa-f\s]+)>/g)) text += fromHex(t[1]!);
      for (const t of arr[1]!.matchAll(/\(((?:\\.|[^\\)])*)\)/g)) text += fromLiteral(t[1]!);
    }
    pages.push(recompose(text));
  }

  return {
    pages,
    all: pages.join("\n"),
    fonts: [...new Set([...latin.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/g)].map((m) => m[1]!))],
    cmapEntries: cmap.size,
    pageObjects: (latin.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
  };
}

// Fixed fixture. Row heights VARY on purpose: with uniform rows every page
// break lands at the same phase, which is exactly how a pagination bug hides
// (spec 394 U0 — an orphan check passed against 380 identical rows and only
// reproduced once the heights differed).
const LISTING_INPUT = {
  project: {
    code: "PRC-GOLD",
    name: "โครงการทดสอบรายงานลูกค้า",
    generatedAt: new Date("2026-01-15T00:00:00Z"),
    clientName: "บริษัท ทดสอบ จำกัด",
    siteAddress: "123 ถนนสุขุมวิท กรุงเทพมหานคร",
  },
  coverNote: "รายงานฉบับนี้สรุปความคืบหน้าประจำเดือน",
  includeEmptyWorkPackages: true,
  workPackages: Array.from({ length: 60 }, (_, i) => ({
    code: `W0${(i % 9) + 1}-${String(i + 1).padStart(3, "0")}`,
    name:
      i % 3 === 0
        ? `งานเทพื้นคอนกรีตชั้นที่ ${i + 1} โซนตะวันออก อาคารสำนักงานใหญ่ ส่วนต่อขยาย`
        : i % 3 === 1
          ? `งานติดตั้งระบบไฟฟ้าชั้น ${i + 1}`
          : `งานฉาบปูน ${i + 1}`,
    ...(i % 2 === 0 ? { statusLabel: "เสร็จสมบูรณ์" } : {}),
    photoGroups: [],
  })),
};

describe("report PDF golden (renderer-upgrade characterisation)", () => {
  it("decodes to real Thai text through the embedded Sarabun subset", async () => {
    const decoded = decodePdf(await buildReportPdf(LISTING_INPUT));

    // The decoder itself must not have silently found nothing — a zero here is
    // an instrument failure, not a passing document.
    expect(decoded.cmapEntries).toBeGreaterThan(100);
    expect(decoded.fonts).toHaveLength(1);
    expect(decoded.fonts[0]).toMatch(/\+Sarabun-Regular$/);

    // Header, cover note and a long Thai heading round-trip EXACTLY. This is
    // what breaks when a renderer changes subsetting or text encoding.
    expect(decoded.all).toContain("PRC-GOLD — โครงการทดสอบรายงานลูกค้า");
    expect(decoded.all).toContain("ลูกค้า: บริษัท ทดสอบ จำกัด");
    expect(decoded.all).toContain("รายงานฉบับนี้สรุปความคืบหน้าประจำเดือน");
    expect(decoded.all).toContain(
      "งานเทพื้นคอนกรีตชั้นที่ 1 โซนตะวันออก อาคารสำนักงานใหญ่ ส่วนต่อขยาย",
    );
    expect(decoded.all).toContain("เสร็จสมบูรณ์");
  });

  it("lists every work package exactly once and paginates to a stable page count", async () => {
    const decoded = decodePdf(await buildReportPdf(LISTING_INPUT));

    for (const wp of LISTING_INPUT.workPackages) {
      expect(decoded.all.split(wp.code).length - 1).toBe(1);
    }

    // Golden numbers for this fixture. A renderer bump that changes metrics
    // moves these — which is the signal this test exists to raise.
    expect(decoded.pageObjects).toBe(3);
    // The page-content heuristic must find every page, or the per-page
    // assertions below would be checking a subset without saying so.
    expect(decoded.pages).toHaveLength(decoded.pageObjects);
  });

  it("never orphans a work name from its code across a page break (spec 394 U0)", async () => {
    const decoded = decodePdf(await buildReportPdf(LISTING_INPUT));

    for (const wp of LISTING_INPUT.workPackages) {
      const namePage = decoded.pages.findIndex((p) => p.includes(wp.name));
      const codePage = decoded.pages.findIndex((p) => p.includes(wp.code));
      expect(namePage, `work name not found: ${wp.name}`).toBeGreaterThanOrEqual(0);
      expect(codePage, `code not found: ${wp.code}`).toBeGreaterThanOrEqual(0);
      expect(codePage, `${wp.code} was split from its work name across a page break`).toBe(
        namePage,
      );
    }
  });

  it("keeps the photo-section layout stable (one page per work package)", async () => {
    const decoded = decodePdf(
      await buildReportPdf({
        project: {
          code: "PRC-GOLD-2",
          name: "โครงการรูปภาพ",
          generatedAt: new Date("2026-01-15T00:00:00Z"),
        },
        workPackages: [
          {
            code: "W01-001",
            name: "งานเทพื้น",
            photoGroups: [{ label: "หลังทำงาน", photos: [TINY_PNG, TINY_PNG] }],
          },
          {
            code: "W02-002",
            name: "งานฉาบปูน",
            photoGroups: [{ label: null, photos: [TINY_PNG] }],
          },
        ],
      }),
    );

    // Header page + one page per photo work package.
    expect(decoded.pageObjects).toBe(3);
    expect(decoded.all).toContain("Photos: 2");
    expect(decoded.all).toContain("หลังทำงาน");
  });
});
