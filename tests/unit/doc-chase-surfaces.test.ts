// Spec 380 U3 — source pins for the two server components vitest cannot render
// (the "gate lives in the page" class): comment-stripped, EXACT occurrence
// counts (≥2 is a floor that lets one real use vanish), one assertion per
// render branch so deleting a section reds instead of shipping invisible.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const page = strip(readFileSync("src/app/requests/docs/page.tsx", "utf8"));
const dash = strip(readFileSync("src/app/procurement/dashboard-body.tsx", "utf8"));

describe("chase page (/requests/docs) source pins", () => {
  it("gates on PURCHASING_ROLES — import plus exactly one requireRole use", () => {
    expect(count(page, "PURCHASING_ROLES")).toBe(2);
  });
  it("reads through the one loader and the one view builder", () => {
    expect(count(page, "loadDocChaseOrders")).toBe(2);
    expect(count(page, "buildDocChaseView")).toBe(2);
  });
  it("renders every branch: groups, ask+misflag line, doc chips, empty state, waived section", () => {
    expect(count(page, "DOC_CHASE_MISFLAG_HINT")).toBe(2);
    expect(count(page, "DOC_CHIP_SITE_PAPER")).toBe(2);
    expect(count(page, "DOC_CHIP_VENDOR_DOC")).toBe(2);
    expect(count(page, "DOC_CHASE_EMPTY_LABEL")).toBe(2);
    expect(count(page, "DOC_WAIVED_LABEL")).toBe(2);
  });
  it("rows door to the PR detail with the referrer threaded", () => {
    expect(count(page, "withBackFrom(`/requests/${r.id}`")).toBe(1);
  });
});

describe("/requests worklist doc-chase pins (U4)", () => {
  const reqPage = strip(readFileSync("src/app/requests/page.tsx", "utf8"));

  it("loads the SSOT and threads the verdict to BOTH renderers (grid record + phone card)", () => {
    expect(count(reqPage, "loadDocChaseOrders")).toBe(2);
    expect(count(reqPage, "docCoverage.get(r.id)")).toBe(2);
  });

  it("?docs=missing narrows the pipeline groups behind its own gate", () => {
    expect(count(reqPage, "docsMissingActive")).toBe(2);
    expect(count(reqPage, 'singleParam(docsParam) === "missing"')).toBe(1);
    expect(count(reqPage, "chipGroups")).toBe(3);
  });
});

describe("procurement dashboard doc-chase pins", () => {
  it("carries the chip label in strip AND card (plus the import)", () => {
    expect(count(dash, "DOC_MISSING_LABEL")).toBe(3);
  });
  it("the chip renders behind its own >0 gate AND joins the strip's outer OR", () => {
    // one in the outer wrapper condition, one on the chip itself — losing the
    // outer one hides the chip whenever late-risk and arrivals are both quiet
    // (the fact-check finding this pin exists for)
    expect(count(dash, "docsMissingTotal > 0")).toBe(2);
  });
  it("derives from the SSOT loader + per-project counter, and doors to the chase page", () => {
    expect(count(dash, "loadDocChaseOrders")).toBe(2);
    expect(count(dash, "countMissingByProject")).toBe(2);
    expect(count(dash, '"/requests/docs"')).toBe(1);
  });
});
