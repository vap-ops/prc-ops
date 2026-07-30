// Spec 380 U5 — source pins for /requests/[requestId]/page.tsx (a Server
// Component vitest cannot render). The one property that matters: the
// RECEIVE card's DocTypeInvoiceUploader carries wideTypes (the honest
// delivery_note/other superset — fresh-eyes catch, see
// doc-type-invoice-uploader.tsx), the standalone card does NOT (it expects a
// real accounting doc by then).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const page = strip(readFileSync("src/app/requests/[requestId]/page.tsx", "utf8"));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("PR detail page doc-type wiring pins (spec 380 U5)", () => {
  it("mounts DocTypeInvoiceUploader exactly twice (receive card + standalone card)", () => {
    expect(count(page, "<DocTypeInvoiceUploader")).toBe(2);
  });

  it("wideTypes appears exactly once — only the receive card carries it", () => {
    expect(count(page, "wideTypes")).toBe(1);
  });

  it("wideTypes sits between the receive-card gate marker and the standalone-card marker", () => {
    const receiveIdx = page.indexOf("RECEIPT_PAPER_PROMPT");
    const wideIdx = page.indexOf("wideTypes");
    const standaloneIdx = page.indexOf("showStandaloneInvoiceCard");
    expect(receiveIdx).toBeGreaterThan(-1);
    expect(wideIdx).toBeGreaterThan(receiveIdx);
    expect(wideIdx).toBeLessThan(standaloneIdx);
  });

  it("both mounts derive their default from the same SSOT, never a local literal", () => {
    expect(count(page, "defaultInvoiceDocType(status)")).toBe(2);
  });
});
