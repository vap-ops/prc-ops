// Feedback 1d648880 + 7d9d2c2b — the projects-hub filter bar. Server-safe
// presentational component (no 'use client', no handlers): every chip is a plain
// deep-linkable <Link>, mirroring the procurement worklist chips
// (worklist-status-chips.tsx). Two facets — status and client; sorting was
// retired (feedback 7d9d2c2b: "remove all sorting, default sort, focus on
// filtering"). The descriptors come from list-view.ts so the logic stays
// unit-tested. The project search is a plain GET <form> (?q=) — also no JS —
// that preserves the active facets via hidden inputs and deep-links like the chips.

import Link from "next/link";
import { Search, X } from "lucide-react";

import {
  PROJECT_CLIENT_ALL,
  type ProjectStatusChip,
  type ProjectClientChip,
  type ProjectStatusFilter,
} from "@/lib/projects/list-view";

interface ProjectsFilterBarProps {
  statusChips: ProjectStatusChip[];
  clientChips: ProjectClientChip[];
  /** Current search text (controls the input's initial value). */
  query: string;
  /** Active facets — preserved across a search submit via hidden inputs. */
  status: ProjectStatusFilter;
  client: string;
  /** Href that clears the search but keeps the active facets. */
  searchClearHref: string;
}

const CHIP_BASE =
  "focus-visible:ring-action inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px";
const CHIP_ON = "border-fill bg-fill text-on-fill font-semibold";
const CHIP_OFF = "border-edge-strong bg-card text-ink-secondary hover:bg-sunk";

function FilterChip({ chip }: { chip: ProjectStatusChip | ProjectClientChip }) {
  return (
    <Link
      href={chip.href}
      aria-pressed={chip.active}
      className={`${CHIP_BASE} ${chip.active ? CHIP_ON : CHIP_OFF}`}
    >
      <span className="text-sm">{chip.label}</span>
      <span
        className={`text-meta inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold ${
          chip.active ? "bg-on-fill/20 text-on-fill" : "bg-sunk text-ink-secondary"
        }`}
      >
        {chip.count}
      </span>
    </Link>
  );
}

// -mx-5 px-5 bleeds the scroll row to the screen edges.
const ROW =
  "-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [touch-action:pan-x_pinch-zoom] [&::-webkit-scrollbar]:hidden";

export function ProjectsFilterBar({
  statusChips,
  clientChips,
  query,
  status,
  client,
  searchClearHref,
}: ProjectsFilterBarProps) {
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      {/* Project search — a plain GET form (?q=). Hidden inputs carry the active
          facets so a search doesn't drop them; submits on Enter or the button. */}
      <form method="get" action="/projects" role="search" className="relative">
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {client !== PROJECT_CLIENT_ALL ? (
          <input type="hidden" name="client" value={client} />
        ) : null}
        <Search
          aria-hidden
          className="text-ink-secondary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ค้นหาชื่อหรือรหัสโครงการ"
          aria-label="ค้นหาโครงการ"
          enterKeyHint="search"
          className="border-edge-strong bg-card text-ink placeholder:text-ink-secondary focus-visible:ring-action h-11 w-full rounded-full border pr-20 pl-9 text-sm focus:outline-none focus-visible:ring-2"
        />
        {query ? (
          <Link
            href={searchClearHref}
            aria-label="ล้างการค้นหา"
            className="text-ink-secondary hover:bg-sunk hover:text-ink focus-visible:ring-action absolute top-1/2 right-12 grid size-7 -translate-y-1/2 place-items-center rounded-full focus:outline-none focus-visible:ring-2"
          >
            <X className="size-4" />
          </Link>
        ) : null}
        <button
          type="submit"
          className="bg-fill text-on-fill focus-visible:ring-action absolute top-1/2 right-1.5 inline-flex h-8 -translate-y-1/2 items-center rounded-full px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          ค้นหา
        </button>
      </form>

      {/* Status filter — archived is hidden under "ทั้งหมด" and reachable only
          via its own chip. */}
      <div role="group" aria-label="กรองตามสถานะ" className={ROW}>
        {statusChips.map((chip) => (
          <FilterChip key={chip.key} chip={chip} />
        ))}
      </div>

      {/* Client filter — "ทั้งหมด", a chip per client present, and a no-client
          bucket when any project lacks one. */}
      <div role="group" aria-label="กรองตามลูกค้า" className={ROW}>
        {clientChips.map((chip) => (
          <FilterChip key={chip.key} chip={chip} />
        ))}
      </div>
    </div>
  );
}
