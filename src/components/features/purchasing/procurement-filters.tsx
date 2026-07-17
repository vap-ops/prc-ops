"use client";

// Spec 110 — the procurement worklist filter bar: supplier + project pickers.
// Overdue lives on the เกินกำหนด summary tile (a server-rendered Link); the
// status filter moved to the spec-138 U3 status-chip row (band pills). Each
// picker pushes a URL via buildWorklistQuery so the filters compose and the view
// is deep-linkable (the ?mine / spec-56 pattern). Procurement-only.
//
// Feedback 26425c1e (procurement_manager) + 17cba555 (PD): a product-name search
// box — a debounced ?q= that composes with the pickers (filters the worklist by
// item_description substring, server-side, over the whole set — the "54-item
// list, zero search" complaint).

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FIELD_INPUT, FIELD_SELECT } from "@/lib/ui/classes";
import {
  PRODUCT_SEARCH_LABEL,
  PRODUCT_SEARCH_PLACEHOLDER,
  PROJECT_FILTER_ARIA,
} from "@/lib/i18n/labels";
import {
  buildWorklistQuery,
  type ProcurementFilter,
  type ProjectOption,
} from "@/lib/purchasing/worklist-filter";

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

  // Local, debounced product-name search, seeded from the URL. The only in-mount
  // path that clears filter.query externally is the ล้างตัวกรอง button (every
  // other control preserves ?q= via buildWorklistQuery), so that handler resets
  // the local value directly — no state-syncing effect needed.
  const [q, setQ] = useState(filter.query ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // EVERY navigation cancels a pending debounced search push first — otherwise a
  // search timer set before the user changes another control (supplier/project)
  // would fire afterward with its stale captured filter and clobber that change.
  const go = (next: ProcurementFilter) => {
    if (timer.current) clearTimeout(timer.current);
    router.push(buildWorklistQuery(next));
  };
  const pushNow = (next: string) => go({ ...filter, query: next.trim() || null });
  const onSearchChange = (next: string) => {
    setQ(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ ...filter, query: next.trim() || null }), 350);
  };

  const hasAny =
    filter.supplier !== null ||
    filter.projectId !== null ||
    filter.status !== null ||
    filter.band !== null ||
    filter.overdue ||
    (filter.query?.trim() ?? "") !== "";

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-ink-secondary text-meta font-medium">{PRODUCT_SEARCH_LABEL}</span>
        <input
          type="search"
          inputMode="search"
          aria-label={PRODUCT_SEARCH_LABEL}
          placeholder={PRODUCT_SEARCH_PLACEHOLDER}
          className={`${FIELD_INPUT} w-52`}
          value={q}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              pushNow(q);
            }
          }}
        />
      </label>

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
            aria-label={PROJECT_FILTER_ARIA}
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

      {hasAny ? (
        <button
          type="button"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current);
            setQ("");
            router.push("/requests");
          }}
          className="text-action hover:bg-sunk focus-visible:ring-action inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2"
        >
          ล้างตัวกรอง
        </button>
      ) : null}
    </div>
  );
}
