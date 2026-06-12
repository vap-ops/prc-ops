// WP-list view filter (spec 56). Four views replace the old search box
// + hide-completed checkbox; งานค้าง is the default — a site admin
// opening a project sees outstanding work, finished WPs on request.
// Pure module so the segmented control maps over WP_LIST_VIEWS and any
// future list surface imports instead of copying.

import type { Database } from "@/lib/db/database.types";

export type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

export type WpListView = "outstanding" | "pending_approval" | "complete" | "all";

export const DEFAULT_WP_LIST_VIEW: WpListView = "outstanding";

export const WP_LIST_VIEWS: ReadonlyArray<{ value: WpListView; label: string }> = [
  { value: "outstanding", label: "งานค้าง" },
  { value: "pending_approval", label: "รอตรวจ" },
  { value: "complete", label: "เสร็จแล้ว" },
  { value: "all", label: "ทั้งหมด" },
];

export function filterByView<T extends { status: WorkPackageStatus }>(
  workPackages: ReadonlyArray<T>,
  view: WpListView,
): T[] {
  switch (view) {
    case "outstanding":
      return workPackages.filter((wp) => wp.status !== "complete");
    case "pending_approval":
      return workPackages.filter((wp) => wp.status === "pending_approval");
    case "complete":
      return workPackages.filter((wp) => wp.status === "complete");
    case "all":
      return [...workPackages];
  }
}
