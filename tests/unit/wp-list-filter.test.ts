// Unit tests for the WP-list view filter (spec 56) — the 4-view
// segmented control that replaced search + hide-completed.

import { describe, it, expect } from "vitest";

import {
  WP_LIST_VIEWS,
  DEFAULT_WP_LIST_VIEW,
  filterByView,
  type WpListView,
} from "@/lib/work-packages/list-filter";

const ALL_STATUSES = [
  "not_started",
  "in_progress",
  "on_hold",
  "pending_approval",
  "complete",
] as const;

const wps = ALL_STATUSES.map((status, i) => ({ id: `wp-${i}`, status }));

function statusesFor(view: WpListView) {
  return filterByView(wps, view).map((wp) => wp.status);
}

describe("filterByView", () => {
  it("งานค้าง (outstanding) keeps everything except complete", () => {
    expect(statusesFor("outstanding")).toEqual([
      "not_started",
      "in_progress",
      "on_hold",
      "pending_approval",
    ]);
  });

  it("รอตรวจ keeps pending_approval only", () => {
    expect(statusesFor("pending_approval")).toEqual(["pending_approval"]);
  });

  it("เสร็จแล้ว keeps complete only", () => {
    expect(statusesFor("complete")).toEqual(["complete"]);
  });

  it("ทั้งหมด keeps everything", () => {
    expect(statusesFor("all")).toEqual([...ALL_STATUSES]);
  });
});

describe("view registry", () => {
  it("default view is งานค้าง — finished WPs hidden by default (operator call)", () => {
    expect(DEFAULT_WP_LIST_VIEW).toBe("outstanding");
  });

  it("exposes exactly the four views in display order with Thai labels", () => {
    expect(WP_LIST_VIEWS.map((v) => v.value)).toEqual([
      "outstanding",
      "pending_approval",
      "complete",
      "all",
    ]);
    expect(WP_LIST_VIEWS.map((v) => v.label)).toEqual([
      "งานค้าง",
      "รอตรวจ",
      "เสร็จแล้ว",
      "ทั้งหมด",
    ]);
  });
});
