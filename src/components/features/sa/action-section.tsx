// Spec 218 U2 — the "ต้องแก้ไข" section on the SA home. Every WP that needs the
// SA's correction (rework / ให้แก้ไข / ไม่อนุมัติ), pinned above งานของฉัน, each row
// self-explaining (why + who + which round) with a one-tap path to the photo
// capture. Color carries severity: amber = needs a fix, red = rejected (mirrors
// AttentionCard's tone language, the app's single callout SSOT).

import Link from "next/link";
import { Camera, RotateCcw, PencilLine, Ban } from "lucide-react";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { APPROVAL_DECISION_LABEL, REWORK_SOURCE_LABEL } from "@/lib/i18n/labels";
import { reworkRoundTag } from "@/lib/photos/rework-round";
import type { SaActionItem, SaActionKind } from "@/lib/sa/action-list";

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
  if (item.kind !== "rework") return KIND_META[item.kind].chip;
  const parts = [KIND_META.rework.chip];
  if (item.round) parts.push(reworkRoundTag(item.round));
  if (item.source) parts.push(REWORK_SOURCE_LABEL[item.source]);
  return parts.join(" · ");
}

export function SaActionSection({
  items,
  backHref = "/sa",
}: {
  items: ReadonlyArray<SaActionItem>;
  backHref?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-danger flex items-center gap-1.5 font-semibold">
        <RotateCcw aria-hidden className="size-4" />
        ต้องแก้ไข
        <span className="bg-danger text-on-fill ml-0.5 rounded-full px-2 py-0.5 text-[0.625rem] font-extrabold">
          {items.length}
        </span>
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const meta = KIND_META[item.kind];
          const t = TONE[meta.tone];
          const photoHref = withBackFrom(
            `${workPackageHref(item.projectId, item.id)}#wp-photos`,
            backHref,
          );
          return (
            <li
              key={item.id}
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
                  <Camera aria-hidden className="size-4" />
                  {meta.cta}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
