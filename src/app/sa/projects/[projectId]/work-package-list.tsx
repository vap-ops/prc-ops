"use client";

// Client Component: text filter over an already-loaded WP list. Spec
// locks the filter at ~80 rows, so all filtering is in-memory (no
// server search, no debounce).

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

const WP_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  on_hold: "On hold",
  complete: "Complete",
  pending_approval: "Pending approval",
};

export interface WorkPackageListItem {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface WorkPackageListProps {
  projectId: string;
  workPackages: ReadonlyArray<WorkPackageListItem>;
}

export function WorkPackageList({ projectId, workPackages }: WorkPackageListProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workPackages;
    return workPackages.filter(
      (wp) => wp.code.toLowerCase().includes(q) || wp.name.toLowerCase().includes(q),
    );
  }, [query, workPackages]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        type="search"
        placeholder="Filter by code or name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-500"
        aria-label="Filter work packages"
      />

      {filtered.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
          {workPackages.length === 0 ? "No work packages yet." : "No matches."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((wp) => (
            <li key={wp.id}>
              <Link
                href={`/sa/projects/${projectId}/work-packages/${wp.id}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-zinc-500">{wp.code}</p>
                  <p className="truncate text-base font-medium text-zinc-100">{wp.name}</p>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                  {WP_STATUS_LABEL[wp.status] ?? wp.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
