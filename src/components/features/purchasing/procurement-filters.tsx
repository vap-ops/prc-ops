"use client";

// Spec 110 — the procurement worklist filter bar: supplier + project + status
// pickers. Overdue lives on the เกินกำหนด summary tile (a server-rendered Link).
// Each picker pushes a URL via buildWorklistQuery so the filters compose and
// the view is deep-linkable (the ?mine / spec-56 pattern). Procurement-only.

import { useRouter } from "next/navigation";
import { FIELD_SELECT } from "@/lib/ui/classes";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import {
  buildWorklistQuery,
  type ProcurementFilter,
  type ProjectOption,
} from "@/lib/purchasing/worklist-filter";
import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// Buyer-relevant statuses; rejected/cancelled are last — their job here is to
// surface the rows the pipeline bands drop (the operator-chosen status filter).
const STATUS_OPTIONS: ReadonlyArray<PurchaseRequestStatus> = [
  "requested",
  "approved",
  "purchased",
  "on_route",
  "delivered",
  "site_purchased",
  "rejected",
  "cancelled",
];

export function ProcurementFilters({
  filter,
  suppliers,
  projects,
}: {
  filter: ProcurementFilter;
  suppliers: ReadonlyArray<string>;
  projects: ReadonlyArray<ProjectOption>;
}) {
  const router = useRouter();
  const go = (next: ProcurementFilter) => router.push(buildWorklistQuery(next));
  const hasAny =
    filter.supplier !== null ||
    filter.projectId !== null ||
    filter.status !== null ||
    filter.overdue;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-ink-secondary text-meta font-medium">ผู้ขาย</span>
        <select
          aria-label="กรองตามผู้ขาย"
          className={`${FIELD_SELECT} w-44`}
          value={filter.supplier ?? ""}
          onChange={(e) => go({ ...filter, supplier: e.target.value || null })}
        >
          <option value="">ทั้งหมด</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {projects.length > 1 ? (
        <label className="flex flex-col gap-1">
          <span className="text-ink-secondary text-meta font-medium">โครงการ</span>
          <select
            aria-label="กรองตามโครงการ"
            className={`${FIELD_SELECT} w-44`}
            value={filter.projectId ?? ""}
            onChange={(e) => go({ ...filter, projectId: e.target.value || null })}
          >
            <option value="">ทั้งหมด</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-ink-secondary text-meta font-medium">สถานะ</span>
        <select
          aria-label="กรองตามสถานะ"
          className={`${FIELD_SELECT} w-40`}
          value={filter.status ?? ""}
          onChange={(e) =>
            go({ ...filter, status: (e.target.value || null) as PurchaseRequestStatus | null })
          }
        >
          <option value="">ทั้งหมด</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {PURCHASE_REQUEST_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      {hasAny ? (
        <button
          type="button"
          onClick={() => router.push("/requests")}
          className="text-action hover:bg-sunk focus-visible:ring-action inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2"
        >
          ล้างตัวกรอง
        </button>
      ) : null}
    </div>
  );
}
