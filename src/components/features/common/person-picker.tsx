"use client";

// Spec 363 U4 slice 1b — PersonPicker: the plain, people-shaped sibling of
// ScopedCatalogItemPicker (spec 180/228). Slice 1 moved the เบิก sheet's material
// field off a native <select> and onto a searchable BottomSheet, but left the
// ผู้รับ field on the OS wheel — so two adjacent fields asking for the same kind
// of answer used two different idioms, which is what the operator reported on
// 2026-07-27 ("we want the uxui to be consistent").
//
// Deliberately PLAIN (operator call, same day): search + names, no thumbnails and
// no filter chips. A person on this surface has neither a picture nor a category,
// and at the live roster size (30 workers on the pilot project) a search box alone
// is the whole fix — chips would be surface to get wrong for no gain.
//
// เปลี่ยน re-opens the sheet WITHOUT clearing: opening a picker must not destroy
// the current answer if the user backs out. Clearing is its own explicit row.

import { Fragment, useState } from "react";
import { Search, UserRound, UserX } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT } from "@/lib/ui/classes";

export interface PersonOption {
  id: string;
  name: string;
}

const LABEL = "text-sm font-medium text-ink";

// Wrap the matched substring so the picker shows WHY a row matched — the same
// affordance the material picker gives, and the reason a search box beats a wheel.
function highlight(text: string, query: string) {
  if (query.length === 0) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <Fragment>
      {text.slice(0, idx)}
      <span className="text-action font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </Fragment>
  );
}

export function PersonPicker({
  label,
  people,
  selectedId,
  onChange,
  disabled = false,
  triggerLabel,
  clearLabel,
  searchPlaceholder,
  sheetTitle,
}: {
  label: string;
  people: readonly PersonOption[];
  /** "" means nobody is chosen. */
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  triggerLabel: string;
  /** The explicit "nobody" row, e.g. ไม่ระบุ. */
  clearLabel: string;
  searchPlaceholder: string;
  sheetTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = selectedId ? (people.find((p) => p.id === selectedId) ?? null) : null;
  const q = query.trim().toLowerCase();
  const matches = q.length > 0 ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;

  // Reset the query on close so a reopen never resumes a stale filter and shows
  // a list that looks empty (the same trap the material picker closes).
  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(id: string) {
    onChange(id);
    close();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>

      {selected ? (
        <div className="rounded-control border-edge-strong bg-card flex min-h-11 items-center gap-3 border px-3 py-2">
          <UserRound aria-hidden className="text-ink-muted size-5 shrink-0" />
          <span className="text-ink min-w-0 flex-1 text-sm font-medium">{selected.name}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            className="text-action focus-visible:ring-action shrink-0 rounded text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
          >
            เปลี่ยน
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="rounded-control border-edge-strong bg-card text-ink-secondary hover:bg-page focus-visible:ring-action flex h-11 w-full items-center gap-2 border px-3 text-left text-sm shadow-xs focus:outline-none focus-visible:ring-2"
        >
          <Search aria-hidden className="text-ink-muted size-5 shrink-0" />
          {triggerLabel}
        </button>
      )}

      <BottomSheet open={open} title={sheetTitle} onClose={close}>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              aria-hidden
              className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${FIELD_INPUT} pl-10`}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
            />
          </div>

          {matches.length > 0 ? (
            <ul className="flex flex-col">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose(p.id)}
                    className="border-edge hover:bg-page focus-visible:ring-action flex min-h-11 w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0 focus:outline-none focus-visible:ring-2"
                  >
                    <UserRound aria-hidden className="text-ink-muted size-5 shrink-0" />
                    <span className="text-ink min-w-0 flex-1 text-sm">{highlight(p.name, q)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-secondary px-1 py-4 text-sm">ไม่พบชื่อที่ค้นหา</p>
          )}

          {/* The explicit "nobody" answer. Kept OUT of the filtered list so a
              query can never hide the only way to undo a wrong pick. */}
          <button
            type="button"
            onClick={() => choose("")}
            className="border-edge-strong text-ink-secondary hover:bg-page focus-visible:ring-action rounded-control flex min-h-11 w-full items-center gap-3 border border-dashed px-3 text-left text-sm focus:outline-none focus-visible:ring-2"
          >
            <UserX aria-hidden className="text-ink-muted size-5 shrink-0" />
            {clearLabel}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
