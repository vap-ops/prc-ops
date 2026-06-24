// Spec 197 U2 — the standalone /stock-count surface is retired. ตรวจนับ is now
// unified into the per-project คลัง page: a per-row spot count plus a
// ตรวจนับทั้งคลัง full-stocktake pass, both hitting the same record_stock_count.
// This legacy top-level path is kept as a thin redirect to the projects hub so
// muscle-memory / old links resolve; counting is reached through a project's
// คลัง chip.

import { redirect } from "next/navigation";

export default function StockCountPage() {
  redirect("/projects");
}
