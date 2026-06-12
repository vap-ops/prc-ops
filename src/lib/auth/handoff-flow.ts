// Spec 43 / ADR 0041 — pure flow resolution for the LINE callback.
// Precedence is load-bearing: a valid state cookie always selects the
// ADR 0012 browser flow; only when no cookie matches is a pending,
// unexpired login_handoffs row honored. Everything else is invalid.

export type CallbackFlow =
  | { kind: "browser" }
  | { kind: "handoff"; rowId: string }
  | { kind: "invalid" };

export function resolveCallbackFlow(args: {
  stateParam: string | null;
  stateCookie: string | null;
  handoffRow: { id: string; status: string; expires_at: string } | null;
  nowMs: number;
}): CallbackFlow {
  const { stateParam, stateCookie, handoffRow, nowMs } = args;
  if (!stateParam) return { kind: "invalid" };
  if (stateCookie && stateCookie === stateParam) return { kind: "browser" };
  if (handoffRow && handoffRow.status === "pending" && Date.parse(handoffRow.expires_at) > nowMs) {
    return { kind: "handoff", rowId: handoffRow.id };
  }
  return { kind: "invalid" };
}
