// Spec 265 U2 — the pure view-model behind the shared LineIdentityBlock, plus
// the "not yet synced" copy. LINE identity (display name + original avatar +
// "last checked" time) is LINE-owned ground truth, refreshed on every login
// (ADR 0020 / spec 265 U1). This helper decides the ONE thing both surfaces
// (/registrations/[id] and /settings/roles/[id]) must agree on: is this a real
// sync, or has the person not logged in since the columns shipped?
//
// synced keys on line_synced_at ALONE (a login always stamps it): a LINE
// profile with no name/picture is still a real check. When line_synced_at is
// NULL (never synced — spec 265 § backfill: no backfill, populates on next
// login) the block renders the notSyncedLabel empty state, not empty fields.

import { formatThaiDateTime, LINE_IDENTITY_NOT_SYNCED_LABEL } from "@/lib/i18n/labels";

export interface LineIdentityInput {
  lineDisplayName: string | null;
  lineAvatarUrl: string | null;
  lineSyncedAt: string | null;
}

export interface LineIdentityView {
  /** True once the person has logged in since U1 (line_synced_at present). */
  synced: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  /** "ตรวจล่าสุด {Bangkok date}", or null when never synced. */
  syncedAtLabel: string | null;
  /** The "not yet synced" empty-state copy (SSOT), for the never-synced case. */
  notSyncedLabel: string;
}

export function buildLineIdentityView(input: LineIdentityInput): LineIdentityView {
  const synced = input.lineSyncedAt !== null;
  return {
    synced,
    displayName: input.lineDisplayName,
    avatarUrl: input.lineAvatarUrl,
    syncedAtLabel: synced ? `ตรวจล่าสุด ${formatThaiDateTime(input.lineSyncedAt as string)}` : null,
    notSyncedLabel: LINE_IDENTITY_NOT_SYNCED_LABEL,
  };
}
