import { describe, expect, it } from "vitest";

import { sanitizeDocFilename } from "@/lib/company-docs/upload-company-doc";

// Regression: feedback e6b48386 (2026-08-03) — a Thai-named PDF failed with
// "Invalid key: …/หน-งส-อร-บรอง-2608.pdf". Supabase Storage object keys reject
// non-ASCII, but the sanitizer kept every \p{L} (Thai base consonants) and only
// stripped the combining tone-marks. The fix restricts the key to ASCII while
// keeping a usable extension.
describe("sanitizeDocFilename", () => {
  // THE CLASS GUARD: no input may produce a non-ASCII storage key.
  const NON_ASCII = /[^\x00-\x7F]/;
  const inputs = [
    "หนังสือรับรอง 2608.pdf",
    "หนังสือรับรอง.pdf",
    "รับรอง",
    "会社の書類.pdf",
    "café menü.docx",
    "réçu.png",
    "‏عربى.pdf",
  ];
  for (const name of inputs) {
    it(`produces an ASCII-only key for ${name}`, () => {
      expect(NON_ASCII.test(sanitizeDocFilename(name))).toBe(false);
    });
  }

  it("keeps the extension when the base transliterates away (Thai + number)", () => {
    expect(sanitizeDocFilename("หนังสือรับรอง 2608.pdf")).toBe("2608.pdf");
  });

  it("falls back to document.<ext> when the whole base is non-ASCII", () => {
    expect(sanitizeDocFilename("หนังสือรับรอง.pdf")).toBe("document.pdf");
  });

  it("leaves an all-ASCII name unchanged", () => {
    expect(sanitizeDocFilename("real.pdf")).toBe("real.pdf");
    expect(sanitizeDocFilename("invoice_2026-08.PDF")).toBe("invoice_2026-08.PDF");
  });

  it("handles a name with no extension", () => {
    expect(sanitizeDocFilename("no-extension-file")).toBe("no-extension-file");
    expect(sanitizeDocFilename("รายงาน")).toBe("document");
  });

  it("preserves interior dots in the base", () => {
    expect(sanitizeDocFilename("v1.2.final.pdf")).toBe("v1.2.final.pdf");
  });

  it("never yields a bare dot segment for dot-only names", () => {
    expect(sanitizeDocFilename(".")).toBe("document");
    expect(sanitizeDocFilename("..")).toBe("document");
  });

  it("caps overly long names at 120 chars but keeps the extension", () => {
    const out = sanitizeDocFilename("a".repeat(300) + ".pdf");
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
