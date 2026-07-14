// Spec 318 U3 — pure drain-side mute filter (ADR 0037 pipeline). The drain
// builds one muted-key set per batch (enabled=false rows only — absence of a
// preference row means ON) and filters each row's resolved recipients before
// contact mapping. Locked events (safety alerts) bypass the filter: the RPC
// refuses to store a mute for them, and this guard keeps even a manually
// inserted row from silencing one.

import { LOCKED_NOTIFICATION_EVENTS, type NotificationEventType } from "./notification-catalog";

export function mutedKey(userId: string, eventType: NotificationEventType): string {
  return `${userId}:${eventType}`;
}

export function filterMutedRecipients(
  recipients: readonly string[],
  eventType: NotificationEventType,
  mutedKeys: ReadonlySet<string>,
): string[] {
  if (LOCKED_NOTIFICATION_EVENTS.includes(eventType)) return [...recipients];
  return recipients.filter((id) => !mutedKeys.has(mutedKey(id, eventType)));
}
