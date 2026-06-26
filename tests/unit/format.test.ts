// Money-format SSOT (architecture-quality audit rank 1 + rank 9). One home for
// every baht/round2 formatter — `src/lib/format.ts` — replacing the ~30
// hand-rolled copies that drifted into 4 idioms (one name `baht` → 3 outputs).
// This file is BOTH the behavioural spec for the module and the anti-drift
// guard: no module outside format.ts may re-declare a money formatter.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { baht, bahtCompact, bahtUnit, bahtWithSymbol, round2 } from "@/lib/format";

describe("format — money SSOT", () => {
  describe("baht — Thai-grouped, always 2dp, no symbol (the canonical body)", () => {
    it("groups thousands and pins 2 decimals", () => {
      expect(baht(1234.5)).toBe("1,234.50");
      expect(baht(1_000_000)).toBe("1,000,000.00");
      expect(baht(0)).toBe("0.00");
    });
  });

  describe("bahtWithSymbol — ฿ prefix, 2dp, sign before the symbol", () => {
    it("prefixes ฿ and always shows 2dp", () => {
      expect(bahtWithSymbol(4600)).toBe("฿4,600.00");
      expect(bahtWithSymbol(88)).toBe("฿88.00");
    });
    it("puts a loss's minus before the ฿ (accounting convention, not ฿-)", () => {
      expect(bahtWithSymbol(-240)).toBe("-฿240.00");
    });
  });

  describe("bahtCompact — ฿ prefix, rounded to whole baht (compact spend chips)", () => {
    it("rounds to whole baht with grouping", () => {
      expect(bahtCompact(1500)).toBe("฿1,500");
      expect(bahtCompact(1_234_567.8)).toBe("฿1,234,568");
      expect(bahtCompact(0)).toBe("฿0");
    });
  });

  describe("bahtUnit — trailing ' บาท' unit, up to 2dp (no forced trailing zeros)", () => {
    it("suffixes บาท and trims to at most 2 decimals", () => {
      expect(bahtUnit(1234.5)).toBe("1,234.5 บาท");
      expect(bahtUnit(1000)).toBe("1,000 บาท");
      expect(bahtUnit(1234.567)).toBe("1,234.57 บาท");
    });
  });

  describe("round2 — 2dp numeric rounding for money compares", () => {
    it("rounds to 2 decimals as a number (kills float noise)", () => {
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(1234.567)).toBe(1234.57);
      expect(round2(100)).toBe(100);
    });
    it("rounds half up at the 2nd decimal (moved from labor-payments)", () => {
      expect(round2(1900.004)).toBe(1900);
      expect(round2(1900.005)).toBe(1900.01);
      expect(round2(1899.995)).toBe(1900);
    });
  });
});

// ---- anti-drift guard: format.ts is the ONLY home for money formatters ----

const SRC = join(process.cwd(), "src");

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSrc(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const sources = walkSrc(SRC).map((abs) => ({
  rel: relative(SRC, abs),
  text: readFileSync(abs, "utf8"),
}));

describe("format — single definition site (no shotgun-surgery drift)", () => {
  // The whole point of the SSOT: a future precision/locale change is a
  // one-file edit. A second local `baht`/`round2` re-opens the drift this
  // audit closed, so ban any such declaration outside format.ts.
  const FORMAT = join("lib", "format.ts");
  const reDecl = /\b(?:const|function)\s+(?:baht|bahtCompact|bahtWithSymbol|bahtUnit|round2)\b/;

  it("no module re-rolls a local money formatter", () => {
    const offenders = sources.filter((f) => f.rel !== FORMAT && reDecl.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });
});
