// Spec 390 U2 — pure per-CHANNEL preference logic (ADR 0037 pipeline).
//
// The drain fans out over one recipient list to BOTH channels, so a user bound
// to LINE and Telegram receives every notification twice. This module is the
// filter that fixes it, plus the client-side mirror of the DB floor.
//
// Two contracts, both deliberate:
//
// 1. Absence of a preference row = ON (the notification_preferences convention).
//    Only deviations are stored, so the drain reads `enabled = false` rows only.
//
// 2. Unlike filterMutedRecipients, locked events are NOT exempt. The DB floor
//    guarantees a user always keeps a channel that could deliver, so a bypass
//    would buy nothing real while resurrecting the duplicate for exactly the
//    event class nobody wants twice.
//
// ⚠️ `reachableChannels` / `canDisableChannel` MUST stay in step with
// public.set_notification_channel_preference (migration 20260813075896). They
// exist so the UI can grey out a switch the RPC would refuse; if they drift, the
// page either offers a switch that errors on tap or greys out one that is
// perfectly legal. The unit tests mirror the pgTAP fixtures case for case.

export const NOTIFICATION_CHANNELS = ["line", "telegram"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type ChannelBindingInput = {
  lineBound: boolean;
  /** users.line_oa_friend — null means NEVER PROBED, not unreachable. */
  lineFriendFlag: boolean | null;
  telegramBound: boolean;
  disabled: ReadonlySet<NotificationChannel>;
};

export function channelKey(userId: string, channel: NotificationChannel): string {
  return `${userId}:${channel}`;
}

export function filterChannelTargets(
  userIds: readonly string[],
  channel: NotificationChannel,
  disabledKeys: ReadonlySet<string>,
): string[] {
  return userIds.filter((id) => !disabledKeys.has(channelKey(id, channel)));
}

/**
 * The channels that could ACTUALLY deliver to this user — not the ones they are
 * merely bound to.
 *
 * LINE returns 403 to a non-OA-friend, so `line_oa_friend = false` is bound AND
 * undeliverable. A `null` flag counts as reachable: it refreshes only at LINE
 * login, so null means never probed, and refusing on it would freeze the switch
 * for the users we simply have no evidence about.
 *
 * Enabled state is deliberately NOT consulted — this answers "can it deliver",
 * not "did they want it".
 */
export function reachableChannels(input: ChannelBindingInput): Set<NotificationChannel> {
  const out = new Set<NotificationChannel>();
  if (input.lineBound && input.lineFriendFlag !== false) out.add("line");
  if (input.telegramBound) out.add("telegram");
  return out;
}

/**
 * May the user switch this channel off?
 *
 * Mirrors the SQL floor exactly, including its stand-down: when NOTHING is
 * reachable there is nothing left to protect, and refusing would tell a user
 * they are about to lose a channel that already delivers nothing.
 */
export function canDisableChannel(
  input: ChannelBindingInput,
  channel: NotificationChannel,
): boolean {
  const reachable = reachableChannels(input);
  if (reachable.size === 0) return true;
  for (const other of reachable) {
    if (other !== channel && !input.disabled.has(other)) return true;
  }
  return false;
}

/**
 * The predicate callers should actually use, mirroring the RPC's `if not
 * p_enabled and ...` guard: the floor only ever applies to a DISABLE. Turning a
 * channel back on can never strand anyone, so it is always permitted.
 *
 * `canDisableChannel` alone is a footgun — gating an enable on it would leave a
 * user who had switched everything off unable to switch anything back on.
 */
export function canSetChannel(
  input: ChannelBindingInput,
  channel: NotificationChannel,
  enabled: boolean,
): boolean {
  return enabled ? true : canDisableChannel(input, channel);
}
