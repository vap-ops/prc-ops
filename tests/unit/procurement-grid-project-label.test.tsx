// Feedback #19206 (procurement_manager, 2026-08-08) — the desktop grid pools every
// project's approved requests into one รอสั่งซื้อ band (live: 25 rows from PRC-2026-007
// + 6 from PRC-2026-008) and names the project on NO row, so the two sites read as one
// merged list. The phone card already carries the label (spec 301f / 311 U1); this pins
// the same label on the grid row, under the same ">1 named project" rule the page holds.

import { readFileSync } from "node:fs";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";

const TODAY = "2026-06-15";

function row(
  over: Partial<ProcurementGridRecord> & Pick<ProcurementGridRecord, "id" | "status">,
): ProcurementGridRecord {
  return {
    pr_number: 1,
    item_description: "ปูนซีเมนต์",
    priority: "normal",
    quantity: 1,
    unit: "ถุง",
    supplier: null,
    amount: null,
    eta: null,
    needed_by: null,
    requested_at: "2026-06-01T00:00:00Z",
    decided_at: null,
    purchased_at: null,
    shipped_at: null,
    delivered_at: null,
    work_package_id: "wp",
    wp_code: null,
    wp_category_code: null,
    category_match: null,
    wp_name: null,
    project_id: null,
    project_name: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    doc_coverage: null,
    purchase_order_id: null,
    po_number: null,
    category_id: null,
    category_name: null,
    ...over,
  } satisfies ProcurementGridRecord;
}

describe("ProcurementGrid — per-row project label (feedback #19206)", () => {
  it("names each row's own project when the band pools more than one site", () => {
    const rows = [
      row({
        id: "a",
        status: "approved",
        item_description: "เหล็กเส้น",
        project_id: "p7",
        project_name: "TFM นายาว เพชรบูรณ์",
      }),
      row({
        id: "b",
        status: "approved",
        item_description: "สีรองพื้น",
        project_id: "p8",
        project_name: "TFM กกกระทอน เพชรบูรณ์",
      }),
    ];
    render(<ProcurementGrid groups={groupByProcurementBand(rows)} today={TODAY} />);

    // Per-row, not merely present somewhere on the page: a label that rendered on
    // the wrong row would leave the buyer exactly as confused as no label at all.
    const steelCell = screen.getByText("เหล็กเส้น").closest("td");
    expect(steelCell).not.toBeNull();
    expect(within(steelCell as HTMLElement).getByText("TFM นายาว เพชรบูรณ์")).toBeInTheDocument();
    expect(within(steelCell as HTMLElement).queryByText("TFM กกกระทอน เพชรบูรณ์")).toBeNull();

    const paintCell = screen.getByText("สีรองพื้น").closest("td");
    expect(paintCell).not.toBeNull();
    expect(
      within(paintCell as HTMLElement).getByText("TFM กกกระทอน เพชรบูรณ์"),
    ).toBeInTheDocument();
    expect(within(paintCell as HTMLElement).queryByText("TFM นายาว เพชรบูรณ์")).toBeNull();
  });

  it("keeps the row lean when the page supplies no project name (single-project world)", () => {
    const rows = [row({ id: "a", status: "approved", item_description: "เหล็กเส้น" })];
    render(<ProcurementGrid groups={groupByProcurementBand(rows)} today={TODAY} />);

    const cell = screen.getByText("เหล็กเส้น").closest("td");
    expect(cell).not.toBeNull();
    // The whole meta line is what must stay unchanged — assert on its text, so a
    // stray empty chip element would still show up as an added separator.
    expect(within(cell as HTMLElement).queryByText(/TFM/)).toBeNull();
  });
});

// The phone's half of this fix (PhonePoBasket renders the same รอสั่งซื้อ band) is
// pinned in tests/unit/phone-po-basket.test.tsx, which already carries the app-router
// mock that surface needs.

// The wiring lives in a Server Component vitest cannot render, so it is pinned at
// the source (comment-stripped, EXACT counts — a floor would let one of the two
// sites vanish silently). House pattern: doc-chase-surfaces.test.ts.
describe("/requests threads the project name into the grid record", () => {
  const strip = (src: string) =>
    src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  const page = strip(readFileSync("src/app/requests/page.tsx", "utf8"));

  it("sets project_name on the grid record exactly once", () => {
    expect(count(page, "project_name:")).toBe(1);
  });

  it("uses the SAME >1-named-project rule as the phone card — both sites, no second rule", () => {
    // Card (spec 311 U1) + grid record. A drop to 1 means one surface lost the
    // label; a rise means somebody wrote a competing gate instead of reusing it.
    expect(count(page, "showProjectOnCards && r.project_id")).toBe(2);
  });
});
