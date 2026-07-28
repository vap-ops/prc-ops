// Spec 216 — the rework-round dimension: stamping new photos (write side) and
// reading them back grouped by cycle (read side).
//
// after_fix (หลังแก้ไข) photos belong to the WP's *current* rework cycle, so they
// carry the WP's rework_round — and so do defect photos (spec 248): they insert
// after the reopen RPC bumps the counter, so the current round IS the round they
// open. Every original-cycle phase (before/during/after) stays round 0. All pure
// — unit-testable without a Supabase mock.

import type { PhotoPhase, ReworkSource } from "@/lib/db/enums";
import { AFTER_FIX_LEGACY_LABEL, PHOTO_PHASE_LABEL } from "@/lib/i18n/labels";
import type { PhotoLogRow } from "@/lib/photos/current-photos";

const ROUND_STAMPED_PHASES: ReadonlyArray<PhotoPhase> = ["after_fix", "defect"];

export function photoReworkRoundFor(phase: PhotoPhase, wpReworkRound: number): number {
  return ROUND_STAMPED_PHASES.includes(phase) ? wpReworkRound : 0;
}

// "รอบ N" — the user-facing tag for a rework cycle. SSOT: the capture tile and the
// per-round gallery headings both use it, so the term never drifts.
export function reworkRoundTag(round: number): string {
  return `รอบ ${round}`;
}

// The heading for a per-round หลังแก้ไข gallery section. Round 0 (legacy after_fix
// rows captured before the round counter existed) shows the plain label — no
// "รอบ 0". Spec 217: an optional source label (ตรวจภายใน / ลูกค้าแจ้ง) is appended
// when known; legacy rounds with no source omit it.
export function afterFixRoundHeading(
  baseLabel: string,
  round: number,
  sourceLabel?: string | null,
): string {
  const base = round >= 1 ? `${baseLabel} — ${reworkRoundTag(round)}` : baseLabel;
  return sourceLabel ? `${base} · ${sourceLabel}` : base;
}

// Which NAME an after_fix group carries — the round decides, not the phase.
//
// Operator directive 2026-07-28: "hide rework and only show it if there is a rework
// rejection". An after_fix group at round 0 was never opened by a rework rejection;
// it is the pre-spec-353 free-capture legacy (21 WPs / 151 photos, measured on prod).
// The photos stay — they are evidence of real work — but they stop being called
// หลังแก้ไข on a WP where nothing was ever fixed.
//
// Keyed on the GROUP's round, not the WP's: a WP that genuinely reworked can still
// carry a round-0 legacy group, and that group is still not rework evidence.
// Composes with afterFixRoundHeading, which supplies "รอบ N" and the source suffix.
export function afterFixSectionLabel(round: number): string {
  return round >= 1 ? PHOTO_PHASE_LABEL.after_fix : AFTER_FIX_LEGACY_LABEL;
}

// The user-facing NAME of a group of photos in one phase — the single home of the
// phase→name rule, so the four surfaces that render it (the SA's capture zone, the
// PM's review detail, the ประวัติ timeline and the removal trace) cannot drift.
// Only after_fix is round-sensitive; every other phase is its own label. An unknown
// phase degrades to ITSELF rather than blank — the enum can grow, and an empty
// heading would hide that photos exist at all.
export function photoSectionLabel(phase: string, wpReworkRound: number): string {
  if (phase === "after_fix") return afterFixSectionLabel(wpReworkRound);
  return PHOTO_PHASE_LABEL[phase as keyof typeof PHOTO_PHASE_LABEL] ?? phase;
}

export interface AfterFixRoundGroup {
  round: number;
  photos: PhotoLogRow[];
}

// Group after_fix photos by their rework cycle, rounds ascending; input order is
// preserved within each round. The caller passes the current (non-superseded,
// non-tombstone) after_fix rows from selectCurrentPhotosByPhase.
export function groupAfterFixByRound(rows: ReadonlyArray<PhotoLogRow>): AfterFixRoundGroup[] {
  const byRound = new Map<number, PhotoLogRow[]>();
  for (const r of rows) {
    const bucket = byRound.get(r.rework_round);
    if (bucket) bucket.push(r);
    else byRound.set(r.rework_round, [r]);
  }
  return Array.from(byRound.keys())
    .sort((a, b) => a - b)
    .map((round) => ({ round, photos: byRound.get(round) ?? [] }));
}

// Map each rework round to the defect reason that opened it, parsed from the
// `wp_reopened_for_defect` audit_log rows (their payload carries reason + round,
// spec 216 U1). Rows missing a numeric round or a string reason are skipped.
export function reworkReasonsFromAuditRows(
  rows: ReadonlyArray<{ payload: unknown }>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const r of rows) {
    const p = r.payload;
    if (typeof p !== "object" || p === null) continue;
    const { round, reason } = p as { round?: unknown; reason?: unknown };
    if (typeof round === "number" && typeof reason === "string" && reason.length > 0) {
      map.set(round, reason);
    }
  }
  return map;
}

// Map each rework round to its source (internal/client, spec 217), parsed from the
// same `wp_reopened_for_defect` audit rows. Legacy reopens (pre-217) carry no
// source and are skipped — callers render no source label for those rounds.
export function reworkSourcesFromAuditRows(
  rows: ReadonlyArray<{ payload: unknown }>,
): Map<number, ReworkSource> {
  const map = new Map<number, ReworkSource>();
  for (const r of rows) {
    const p = r.payload;
    if (typeof p !== "object" || p === null) continue;
    const { round, source } = p as { round?: unknown; source?: unknown };
    if (typeof round === "number" && (source === "internal" || source === "client")) {
      map.set(round, source);
    }
  }
  return map;
}
