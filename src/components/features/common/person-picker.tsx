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
//
// ⚠️ The RESTING label states the current answer (ไม่ระบุ), it does not command
// ("เลือกผู้รับ"). The native <select> it replaces displayed its value at rest, so
// a command-only trigger would make a deliberately-blank OPTIONAL field read as an
// unfilled required one — a signal the old control carried and this one must too.
// The material picker's trigger IS a command, correctly: that field is required
// and has no valid empty answer. The asymmetry is semantic, not accidental.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Search, UserRound, UserX, TriangleAlert } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT } from "@/lib/ui/classes";

export interface PersonOption {
  id: string;
  name: string;
}

const LABEL = "text-sm font-medium text-ink";

// Wrap the matched substring so the picker shows WHY a row matched — the same
// affordance the material picker gives, and the reason a search box beats a wheel.
function highlight(text: string, query: string): ReactNode {
  if (query.length === 0) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-action font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function PersonPicker({
  label,
  people,
  selectedId,
  onChange,
  disabled = false,
  restingLabel,
  clearLabel,
  searchPlaceholder,
  sheetTitle,
  emptyRosterLabel,
}: {
  label: string;
  people: readonly PersonOption[];
  /** "" means nobody is chosen. */
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** What the field reads at rest, i.e. the CURRENT answer when nobody is picked. */
  restingLabel: string;
  /** The explicit "nobody" row, e.g. ไม่ระบุ. */
  clearLabel: string;
  searchPlaceholder: string;
  sheetTitle: string;
  /** Shown when there is nobody to pick at all — distinct from "search found nothing". */
  emptyRosterLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelId = useId();
  const selfId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  const selected = selectedId ? (people.find((p) => p.id === selectedId) ?? null) : null;
  // A selectedId the roster no longer contains must NOT fall through to the
  // unselected branch: the parent still holds the id and still submits it, so the
  // field would read "nobody" while the payload named someone (reachable when a
  // router.refresh() drops a worker while a draft row is open).
  const orphaned = selectedId !== "" && selected === null;
  const q = query.trim().toLowerCase();
  const matches = q.length > 0 ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;

  // Focus the search on open, mirroring the material picker — otherwise picking a
  // person costs an extra tap that picking a material does not, which is the very
  // inconsistency this unit exists to remove. rAF so the panel's own
  // focus-on-open has already run.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Reset the query on close so a reopen never resumes a stale filter and shows
  // a list that looks empty (the same trap the material picker closes). Focus
  // returns to the trigger so Tab resumes mid-form instead of at <body>.
  //
  // ⚠️ The refocus CANNOT happen inside close(): choosing a person calls
  // onChange first, so the parent swaps the unselected trigger for the เปลี่ยน
  // control — and at close() time triggerRef still points at the button that is
  // about to unmount, sending focus to <body>. Restore after the branch settles.
  function close() {
    restoreFocusRef.current = true;
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [open]);

  function choose(id: string) {
    onChange(id);
    close();
  }

  const nameProps = { "aria-labelledby": `${labelId} ${selfId}` };

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className={LABEL}>
        {label}
      </span>

      {selected || orphaned ? (
        <div className="rounded-control border-edge-strong bg-card flex min-h-11 items-center gap-3 border px-3 py-2">
          {orphaned ? (
            <TriangleAlert aria-hidden className="text-attn-press size-5 shrink-0" />
          ) : (
            <UserRound aria-hidden className="text-ink-muted size-5 shrink-0" />
          )}
          <span
            className={`min-w-0 flex-1 text-sm font-medium ${orphaned ? "text-attn-ink" : "text-ink"}`}
          >
            {orphaned ? "ผู้รับที่เลือกไว้ไม่อยู่ในรายชื่อแล้ว" : selected!.name}
          </span>
          <button
            ref={triggerRef}
            id={selfId}
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            {...nameProps}
            className="text-action focus-visible:ring-action shrink-0 rounded text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 disabled:no-underline disabled:opacity-60"
          >
            เปลี่ยน
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          id={selfId}
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          {...nameProps}
          className="rounded-control border-edge-strong bg-card text-ink hover:bg-page focus-visible:ring-action flex h-11 w-full items-center gap-2 border px-3 text-left text-sm shadow-xs focus:outline-none focus-visible:ring-2 disabled:opacity-60"
        >
          <Search aria-hidden className="text-ink-muted size-5 shrink-0" />
          {restingLabel}
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
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={disabled}
              className={`${FIELD_INPUT} pl-10`}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoComplete="off"
            />
          </div>

          {people.length === 0 ? (
            // Distinct from a failed search: nothing was searched, there is simply
            // nobody to pick. Saying "not found" here blames the query.
            <p className="text-ink-secondary px-1 py-4 text-sm">{emptyRosterLabel}</p>
          ) : matches.length > 0 ? (
            <ul className="flex flex-col">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose(p.id)}
                    disabled={disabled}
                    className="border-edge hover:bg-page focus-visible:ring-action flex min-h-11 w-full items-center gap-3 border-b px-1 py-2.5 text-left last:border-b-0 focus:outline-none focus-visible:ring-2 disabled:opacity-60"
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
            disabled={disabled}
            className="border-edge-strong text-ink-secondary hover:bg-page focus-visible:ring-action rounded-control flex min-h-11 w-full items-center gap-3 border border-dashed px-3 text-left text-sm focus:outline-none focus-visible:ring-2 disabled:opacity-60"
          >
            <UserX aria-hidden className="text-ink-muted size-5 shrink-0" />
            {clearLabel}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
