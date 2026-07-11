// Spec 32 / ADR 0037 — runtime-safe exhaustiveness guard shared by the
// notification event-type switches (resolveRecipients, composeNotification).
//
// Passing `eventType` here type-checks ONLY when every known case is handled, so
// `eventType` narrows to `never` in an exhaustive `default`. Adding a value to
// the `notification_event_type` union therefore BREAKS THE BUILD here until a
// matching case is added — the compile-time exhaustiveness benefit is kept.
//
// At RUNTIME the default fires solely for an event the compiled code predates: a
// DB enum value written to notification_outbox ahead of this deploy (the house
// "migration + trigger pushed before the consuming code ships" window — e.g.
// spec 277 P1a's site_issue_reported was live on the DB before PR #443 merged).
// The only safe behaviour there is a NO-OP SKIP — never a throw, because the
// outbox is drained as one shared batch (approvals, PRs, feedback): a single
// unhandled event that threw would 500 the whole drain and stall every other
// notification until the row expired.
export function warnUnknownNotificationEvent(eventType: never): void {
  console.warn(
    `[notifications] unrecognized event type ${JSON.stringify(eventType)} — skipping; ` +
      "the deployed code predates this DB enum value (deploy the handler to route it)",
  );
}
