// Spec 373 §6 — the verify assembly line, pure. The pay-gate made per-voucher
// verification the accounting bottleneck; the chain turns N vouchers into a
// linked walk instead of N round-trips. Input = the pending events of ONE
// source in the RPC's own order (oldest first); the current voucher may itself
// still be pending, so it is excluded — a door must never lead to itself.

export function pickNextPending(
  pendingEvents: ReadonlyArray<{ source_id: string }>,
  currentId: string,
): string | null {
  return pendingEvents.find((e) => e.source_id !== currentId)?.source_id ?? null;
}
