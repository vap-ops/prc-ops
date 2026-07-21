// Spec 334 U3 — the /team hub tile grid. `teamTilesForRole` is the pure SSOT for
// WHICH doors a role sees and each door's count bubble; the tone rules (D4:
// ownership, not severity) and the zero-suppression (a 0 count renders NO bubble)
// live HERE, not in JSX, so they are unit-tested in one place. TeamTiles renders
// the grid: link tiles are <Link>s (server-rendered); the two sheet-opener tiles
// (เพิ่มช่าง, QR สมัคร) carry no href and open the ONE AddTechnicianSheet via
// SheetOpenerButton — their visual is server-rendered here and handed to that client
// button as children, so no icon component crosses the RSC boundary. The per-tile
// audience is spec U3's "Per-tile audience" block, implemented exactly.

import Link from "next/link";
import {
  HardHat,
  IdCard,
  QrCode,
  UserCheck,
  UserPlus,
  UserRoundPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { SheetOpenerButton } from "@/components/features/sa/add-technician-sheet";
import { STAFF_APPROVAL_ROLES, WORKER_ROSTER_ROLES, type UserRole } from "@/lib/auth/role-home";
import { withBackFrom } from "@/lib/nav/back-href";
import { WORKER_ROSTER_LABEL } from "@/lib/i18n/labels";

// Single-surface tile labels — they render only in this grid, so they stay local
// per the UI-term SSOT rule. The one 2-surface name (the ช่าง roster label, also on
// /workers + the procurement home) is imported as WORKER_ROSTER_LABEL instead.
const REGISTRATIONS_LABEL = "คำขอสมัคร";
const UNASSIGNED_TILE_LABEL = "ยังไม่จัดทีม";
const ROSTER_TILE_LABEL = "รายชื่อทีม";
const ADD_TILE_LABEL = "เพิ่มช่าง";
const BADGES_TILE_LABEL = "บัตร QR";
const REGISTER_QR_TILE_LABEL = "QR สมัคร";
const PAYROLL_TILE_LABEL = "ค่าแรง";

export type TeamTileTone = "danger" | "warning" | "neutral";

export interface TeamTile {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Absent on the two sheet-opener tiles (they open the AddTechnicianSheet). */
  href?: string;
  /** Absent when the count is zero — a zero never renders a bubble (spec U3). */
  bubble?: { n: number; tone: TeamTileTone };
}

function tileBubble(n: number, tone: TeamTileTone): { n: number; tone: TeamTileTone } | undefined {
  return n > 0 ? { n, tone } : undefined;
}

function makeTile(
  key: string,
  label: string,
  icon: LucideIcon,
  opts: {
    href?: string | undefined;
    bubble?: { n: number; tone: TeamTileTone } | undefined;
  } = {},
): TeamTile {
  return {
    key,
    label,
    icon,
    ...(opts.href ? { href: opts.href } : {}),
    ...(opts.bubble ? { bubble: opts.bubble } : {}),
  };
}

/**
 * The pure SSOT: the ordered tiles a role sees on /team, each with a count bubble.
 * Per-tile audience (spec U3 "Per-tile audience"):
 *   • คำขอสมัคร — site_admin (→ /sa/registrations) OR STAFF_APPROVAL_ROLES (→
 *     /registrations); DANGER bubble (the SA/approver must act). Both hrefs thread
 *     the referrer so the destination's back chip returns to the hub.
 *   • ยังไม่จัดทีม + รายชื่อทีม + เพิ่มช่าง + บัตร QR + QR สมัคร — the crew pair
 *     (site_admin + super_admin = isCrew) only. ยังไม่จัดทีม + รายชื่อทีม carry a
 *     NEUTRAL bubble (D4: reference — no SA-reachable affordance assigns a crew yet).
 *   • the ช่าง roster + ค่าแรง — WORKER_ROSTER_ROLES, unchanged targets.
 * Zero-suppression and the tones live here, not in JSX — the testable contract.
 */
export function teamTilesForRole(ctx: {
  role: UserRole;
  isCrew: boolean;
  counts: { pendingRegistrations: number; unassigned: number; activeWorkers: number };
}): TeamTile[] {
  const { role, isCrew, counts } = ctx;
  const tiles: TeamTile[] = [];

  if (role === "site_admin" || STAFF_APPROVAL_ROLES.includes(role)) {
    // site_admin reads its own /sa queue (read-only); the approver tiers decide on
    // /registrations. Both thread ?from so the drill-down returns to the chip-less
    // hub — kept as two explicit withBackFrom literals so the referrer-threading
    // source guard sees each door (team-page.test.ts, moved here in spec 334).
    const href =
      role === "site_admin"
        ? withBackFrom("/sa/registrations", "/team")
        : withBackFrom("/registrations", "/team");
    tiles.push(
      makeTile("registrations", REGISTRATIONS_LABEL, UserCheck, {
        href,
        bubble: tileBubble(counts.pendingRegistrations, "danger"),
      }),
    );
  }

  if (isCrew) {
    tiles.push(
      makeTile("unassigned", UNASSIGNED_TILE_LABEL, UserRoundPlus, {
        href: "/team/roster",
        bubble: tileBubble(counts.unassigned, "neutral"),
      }),
      makeTile("roster", ROSTER_TILE_LABEL, Users, {
        href: "/team/roster",
        bubble: tileBubble(counts.activeWorkers, "neutral"),
      }),
      // No href → opens the AddTechnicianSheet in its "choose" branch.
      makeTile("add", ADD_TILE_LABEL, UserPlus),
      makeTile("badges", BADGES_TILE_LABEL, IdCard, { href: "/team/badges" }),
      // No href → opens the same sheet pre-branched to its QR ("has_phone") mode.
      makeTile("register-qr", REGISTER_QR_TILE_LABEL, QrCode),
    );
  }

  if (WORKER_ROSTER_ROLES.includes(role)) {
    tiles.push(
      makeTile("workers", WORKER_ROSTER_LABEL, HardHat, {
        href: withBackFrom("/workers", "/team"),
      }),
      makeTile("payroll", PAYROLL_TILE_LABEL, Wallet, {
        href: withBackFrom("/payroll", "/team"),
      }),
    );
  }

  return tiles;
}

// SaTools tile idiom — the shared visual for every door (link or opener).
const TILE_CLASS =
  "rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk relative flex min-h-20 flex-col gap-2 border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2";

const BUBBLE_TONE: Record<TeamTileTone, string> = {
  danger: "bg-danger text-on-fill",
  warning: "bg-attn-soft text-attn-ink border-attn-edge border",
  neutral: "bg-sunk text-ink-secondary border-edge border",
};

function TileBubble({ n, tone }: { n: number; tone: TeamTileTone }) {
  return (
    <span
      className={`text-meta absolute top-2 right-2 shrink-0 rounded-full px-2 py-0.5 font-bold tabular-nums ${BUBBLE_TONE[tone]}`}
    >
      {n}
    </span>
  );
}

function TileVisual({ tile }: { tile: TeamTile }) {
  const Icon = tile.icon;
  return (
    <>
      {tile.bubble ? <TileBubble n={tile.bubble.n} tone={tile.bubble.tone} /> : null}
      <Icon aria-hidden className="text-action size-6 shrink-0" />
      <span className="text-body text-ink font-medium">{tile.label}</span>
    </>
  );
}

function TeamTileCell({ tile }: { tile: TeamTile }) {
  if (tile.href) {
    return (
      <Link href={tile.href} className={TILE_CLASS}>
        <TileVisual tile={tile} />
      </Link>
    );
  }
  // The two sheet openers: เพิ่มช่าง opens "choose", QR สมัคร opens "has_phone".
  const mode = tile.key === "register-qr" ? "has_phone" : "choose";
  return (
    <SheetOpenerButton mode={mode} className={TILE_CLASS}>
      <TileVisual tile={tile} />
    </SheetOpenerButton>
  );
}

export function TeamTiles({ tiles }: { tiles: TeamTile[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles.map((t) => (
        <TeamTileCell key={t.key} tile={t} />
      ))}
    </div>
  );
}
