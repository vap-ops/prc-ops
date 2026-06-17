// Spec 138 U2 — one tile of the desktop KPI hero row. Server-safe presentational
// component: renders a descriptor from buildWorklistKpis (icon chip + big value +
// label + caption), toned per the tile. The เกินกำหนด tile has an href → it renders
// as a chase-filter <Link> with a pressed ring; the rest are plain. Field-First
// tokens only (flat amber, NOT the mock's raw gradient).

import Link from "next/link";
import { AlertTriangle, Clock, Truck, Wallet, type LucideIcon } from "lucide-react";

import type {
  WorklistKpiIcon,
  WorklistKpiTile as Tile,
  WorklistKpiTone,
} from "@/lib/purchasing/worklist-kpis";

const ICON: Record<WorklistKpiIcon, LucideIcon> = {
  waiting: Clock,
  shipping: Truck,
  overdue: AlertTriangle,
  outstanding: Wallet,
};

// Per-tone class trio (card / value / icon-chip / caption). Hot is the amber hero
// (the icon sits directly on the fill, no chip); the rest are white/soft cards.
const TONE: Record<
  WorklistKpiTone,
  { card: string; value: string; chip: string; caption: string }
> = {
  hot: {
    card: "border-attn-press bg-attn text-on-attn",
    value: "text-on-attn",
    chip: "text-on-attn",
    caption: "text-on-attn/90",
  },
  shipping: {
    card: "border-edge bg-card text-ink",
    value: "text-action",
    chip: "bg-action-soft text-action",
    caption: "text-ink-muted",
  },
  danger: {
    card: "border-danger-edge bg-danger-soft text-danger-ink",
    value: "text-danger",
    chip: "bg-danger/15 text-danger",
    caption: "text-danger-ink",
  },
  neutral: {
    card: "border-edge bg-card text-ink",
    value: "text-ink",
    chip: "bg-sunk text-ink-secondary",
    caption: "text-ink-muted",
  },
};

export function WorklistKpiTile({ tile }: { tile: Tile }) {
  const tone = TONE[tile.tone];
  const Icon = ICON[tile.icon];
  const base = `rounded-card flex min-h-[92px] flex-col justify-between gap-3 border-[1.5px] p-4 ${tone.card}`;
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-semibold">{tile.label}</span>
        <span
          className={`inline-flex size-7 items-center justify-center rounded-lg ${
            tile.tone === "hot" ? "" : tone.chip
          }`}
        >
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <div>
        <div className={`text-3xl leading-none font-extrabold tabular-nums ${tone.value}`}>
          {tile.value}
        </div>
        <div className={`text-meta mt-1 font-medium ${tone.caption}`}>{tile.caption}</div>
      </div>
    </>
  );

  if (tile.href) {
    return (
      <Link
        href={tile.href}
        aria-pressed={tile.active ? "true" : "false"}
        className={`${base} focus-visible:ring-action transition-shadow focus:outline-none focus-visible:ring-2 ${
          tile.active ? "ring-action ring-2 ring-offset-1" : "hover:shadow-card"
        }`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
