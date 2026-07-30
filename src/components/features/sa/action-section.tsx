"use client";

// Spec 218 U2 — the "ต้องแก้ไข" section on the SA home. Every WP that needs the
// SA's correction (rework / ให้แก้ไข / ไม่อนุมัติ), pinned above งานของฉัน, each row
// self-explaining (why + who + which round) with a one-tap path to the photo
// capture. Color carries severity: amber = needs a fix, red = rejected (mirrors
// AttentionCard's tone language, the app's single callout SSOT).
//
// Spec 384 U1 — that "each row self-explaining" design is right for 1–3 items and
// wrong for 16. The PM reviews in SWEEPS (16 on 07-21, 12 on 07-27, 13 on 07-28),
// so the SA receives a dozen-plus bounces at once carrying the same reason and the
// same next action, and this section was rendering ~6,000px of near-identical
// cards above the muster strip, today's plan and the tools. It now shows the rows
// nobody came back to (older than STALE_ACTION_DAYS) in an always-open band, and
// collapses each fresh reason batch to a single row. Nothing is removed and
// nothing leaves the page — 'use client' buys only the collapse state.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Camera, ChevronRight, RotateCcw, PencilLine, Ban } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  REVISION_REASON_GUIDANCE,
  REWORK_SOURCE_LABEL,
  actionGroupCountLabel,
  staleActionBandLabel,
} from "@/lib/i18n/labels";
import { reworkRoundTag } from "@/lib/photos/rework-round";
import type { ApprovalRevisionReason } from "@/lib/db/enums";
import {
  groupSaActions,
  STALE_ACTION_DAYS,
  type SaActionGroup,
  type SaActionGroupKey,
  type SaActionItem,
  type SaActionKind,
} from "@/lib/sa/action-list";

const KIND_META: Record<
  SaActionKind,
  { chip: string; tone: "amber" | "red"; Icon: typeof RotateCcw; cta: string }
> = {
  // Spec 353 — the two DECISION chips are single-sourced from APPROVAL_DECISION_LABEL
  // (the PM form + attention card read the same map), so this worklist can't drift.
  // `rework` is a STATUS, not a decision, so it keeps its own label.
  rejected: { chip: APPROVAL_DECISION_LABEL.rejected, tone: "red", Icon: Ban, cta: "ถ่ายรูปเพิ่ม" },
  rework: { chip: "งานแก้ไข", tone: "amber", Icon: RotateCcw, cta: "ถ่ายรูปหลังแก้ไข" },
  revision: {
    chip: APPROVAL_DECISION_LABEL.needs_revision,
    tone: "amber",
    Icon: PencilLine,
    cta: "ถ่ายรูปเพิ่ม",
  },
};

const TONE = {
  amber: {
    bar: "border-l-attn",
    ground: "bg-attn-soft border-attn-edge",
    chip: "bg-attn text-on-attn",
  },
  red: {
    bar: "border-l-danger",
    ground: "bg-danger-soft border-danger-edge",
    chip: "bg-danger text-on-fill",
  },
} as const;

function chipLabel(item: SaActionItem): string {
  // Spec 355 — a reasoned bounce chips the REASON alone: prefixing the generic
  // decision label would read "ถ่ายรูปใหม่ · งานยังไม่เสร็จ" (retake · not finished)
  // — self-contradictory for premature. Reasonless rows keep the decision chip.
  if (item.kind === "revision" && item.revisionReason) {
    return APPROVAL_REVISION_REASON_LABEL[item.revisionReason];
  }
  if (item.kind !== "rework") return KIND_META[item.kind].chip;
  const parts = [KIND_META.rework.chip];
  if (item.round) parts.push(reworkRoundTag(item.round));
  if (item.source) parts.push(REWORK_SOURCE_LABEL[item.source]);
  return parts.join(" · ");
}

// Spec 355 — the row CTA follows the reason (mismatch = remove-and-reshoot, never
// "add more"); historical reasonless rows keep the generic per-kind CTA.
function ctaLabel(item: SaActionItem): string {
  if (item.kind === "revision" && item.revisionReason) {
    return REVISION_REASON_GUIDANCE[item.revisionReason].cta;
  }
  return KIND_META[item.kind].cta;
}

// Spec 355 — premature's action is finishing the WORK: its row lands on the WP
// detail (where the reasoned card explains), not the capture zone, and its CTA
// pill drops the camera. Every other row keeps the photo jump.
function isPrematureRow(item: SaActionItem): boolean {
  return item.kind === "revision" && item.revisionReason === "premature";
}

/**
 * Spec 384 U1 — a group this size or smaller renders OPEN, with no toggle.
 * Hiding two cards behind a chevron costs the SA more taps than it saves pixels,
 * and `rework` is a 2-row group on live data.
 */
const GROUP_OPEN_MAX = 3;

/**
 * The group heading. Every arm reads an existing SSOT — the reason map for a
 * reasoned bounce, KIND_META (itself sourced from APPROVAL_DECISION_LABEL) for
 * everything else — so a heading can never disagree with the chips beneath it.
 */
function groupLabel(key: SaActionGroupKey): string {
  if (key === "rejected" || key === "rework" || key === "revision") return KIND_META[key].chip;
  return APPROVAL_REVISION_REASON_LABEL[key.slice("revision:".length) as ApprovalRevisionReason];
}

export function SaActionSection({
  items,
  staleBeforeIso,
  backHref = "/sa",
}: {
  items: ReadonlyArray<SaActionItem>;
  /** Spec 384 U1 — rows older than this are banded out and always shown. */
  staleBeforeIso: string;
  backHref?: string;
}) {
  const { stale, groups } = useMemo(
    () => groupSaActions({ items, staleBeforeIso }),
    [items, staleBeforeIso],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<SaActionGroupKey>>(new Set());

  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-danger flex items-center gap-1.5 font-semibold">
        <RotateCcw aria-hidden className="size-4" />
        ต้องแก้ไข
        {/* The TOTAL, not what is on screen: a count that shrank as she collapsed
            her own work away would be the one number here that cannot be trusted. */}
        <span className="bg-danger text-on-fill ml-0.5 rounded-full px-2 py-0.5 text-[0.625rem] font-extrabold">
          {items.length}
        </span>
      </h2>

      {/* The band nobody came back to. Always open, full cards, oldest first —
          these are the rows actually being dropped, and they are never part of a
          fresh sweep (the ages are bimodal with an empty gap at 4–5 days). */}
      {stale.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-meta text-danger font-semibold">
            {staleActionBandLabel(STALE_ACTION_DAYS, stale.length)}
          </h3>
          <ul className="flex flex-col gap-3">
            {stale.map((item) => (
              <ActionRow key={item.id} item={item} backHref={backHref} />
            ))}
          </ul>
        </div>
      ) : null}

      {groups.map((group) => (
        <ActionGroup
          key={group.key}
          group={group}
          backHref={backHref}
          open={group.items.length <= GROUP_OPEN_MAX || expanded.has(group.key)}
          onToggle={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (!next.delete(group.key)) next.add(group.key);
              return next;
            })
          }
        />
      ))}
    </section>
  );
}

function ActionGroup({
  group,
  open,
  onToggle,
  backHref,
}: {
  group: SaActionGroup;
  open: boolean;
  onToggle: () => void;
  backHref: string;
}) {
  const label = groupLabel(group.key);
  const count = actionGroupCountLabel(group.items.length);
  const contentId = `sa-action-group-${group.key.replace(":", "-")}`;
  const collapsible = group.items.length > GROUP_OPEN_MAX;

  return (
    <div className="flex flex-col gap-3">
      {/* Both arms are an h3, so the section's structure reads the same to a
          screen reader whether or not this particular group happened to be big
          enough to collapse — the band above is an h3 too. */}
      {collapsible ? (
        <h3>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={contentId}
            className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-card flex min-h-12 w-full items-center gap-3 border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2"
          >
            <ChevronRight
              aria-hidden
              className={`text-ink-secondary size-4 shrink-0 transition-transform motion-reduce:transition-none ${
                open ? "rotate-90" : ""
              }`}
            />
            <span className="text-body text-ink min-w-0 flex-1 font-semibold break-words">
              {label}
            </span>
            <span className="text-meta text-ink-muted shrink-0">{count}</span>
          </button>
        </h3>
      ) : (
        <h3 className="text-meta text-ink-secondary flex items-baseline justify-between gap-3 font-semibold">
          <span className="min-w-0 break-words">{label}</span>
          <span className="text-ink-muted shrink-0 font-normal">{count}</span>
        </h3>
      )}
      {open ? (
        <ul id={contentId} className="flex flex-col gap-3">
          {group.items.map((item) => (
            <ActionRow key={item.id} item={item} backHref={backHref} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One ต้องแก้ไข card. Unchanged by spec 384 — 355 got the card right; this unit
 *  only changes how many of them are on screen at once. */
function ActionRow({ item, backHref }: { item: SaActionItem; backHref: string }) {
  const meta = KIND_META[item.kind];
  const t = TONE[meta.tone];
  const photoHref = withBackFrom(
    isPrematureRow(item)
      ? workPackageHref(item.projectId, item.id)
      : `${workPackageHref(item.projectId, item.id)}#wp-photos`,
    backHref,
  );
  return (
    <li
      className={`rounded-card border border-l-[5px] ${t.ground} ${t.bar} shadow-card overflow-hidden`}
    >
      <Link
        href={photoHref}
        className="focus-visible:ring-action block px-4 py-3 focus:outline-none focus-visible:ring-2"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-body text-ink font-bold break-words">{item.name}</p>
          <span
            className={`text-meta ${t.chip} shrink-0 rounded-full px-2 py-0.5 font-bold whitespace-nowrap`}
          >
            {chipLabel(item)}
          </span>
        </div>
        <p className="text-meta text-ink-muted mt-0.5">
          <span className="font-mono">{item.code}</span>
          {item.projectCode ? ` · ${item.projectCode} ${item.projectName}` : ""}
        </p>
        {item.reason ? (
          <p className="text-body text-ink-secondary mt-1.5 break-words">
            <span className="text-ink-muted">
              {item.kind === "rework" ? "ข้อบกพร่อง: " : "หมายเหตุ: "}
            </span>
            {item.reason}
          </p>
        ) : null}
        <span className="bg-attn-press text-on-attn rounded-control mt-3 flex h-10 w-full items-center justify-center gap-1.5 text-sm font-bold">
          {isPrematureRow(item) ? null : <Camera aria-hidden className="size-4" />}
          {ctaLabel(item)}
        </span>
      </Link>
    </li>
  );
}
