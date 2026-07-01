// Spec 244 U1b / ADR 0068 (Tier B) — the pure, DOM-free core of the client
// usage tracker: the event shape, a builder, and a bounded batch buffer. Kept
// separate from tracker.ts (the DOM/timer/beacon shell) so the decision logic
// is unit-testable. Mirrors the `interaction_events` table (spec 244 U1a): the
// client never sends actor_id/actor_role — the DB stamp trigger sets identity
// server-side, so a client cannot spoof who an event belongs to.

export type TelemetryEventType =
  | "session_start"
  | "heartbeat"
  | "session_end"
  | "route_view"
  | "feature_touch";

export interface TelemetryEvent {
  session_id: string;
  event_type: TelemetryEventType;
  route: string | null;
  context: Record<string, unknown> | null;
  app_version: string | null;
  client_ts: string; // ISO 8601, device clock
}

export interface MakeEventOpts {
  route?: string | null;
  context?: Record<string, unknown> | null;
  appVersion?: string | null;
}

export function makeEvent(
  sessionId: string,
  type: TelemetryEventType,
  opts: MakeEventOpts,
  nowIso: string,
): TelemetryEvent {
  return {
    session_id: sessionId,
    event_type: type,
    route: opts.route ?? null,
    context: opts.context ?? null,
    app_version: opts.appVersion ?? null,
    client_ts: nowIso,
  };
}

// A bounded FIFO buffer. Normal path: flush at `maxBatch`. If flushes keep
// failing (offline in the field), it grows only to `hardCap`, then drops the
// OLDEST events — telemetry is best-effort, never a memory leak, never blocks.
export class EventBuffer {
  private buf: TelemetryEvent[] = [];

  constructor(
    private readonly maxBatch = 20,
    private readonly hardCap = 200,
  ) {}

  add(e: TelemetryEvent): void {
    this.buf.push(e);
    if (this.buf.length > this.hardCap) {
      this.buf.splice(0, this.buf.length - this.hardCap);
    }
  }

  get size(): number {
    return this.buf.length;
  }

  shouldFlush(): boolean {
    return this.buf.length >= this.maxBatch;
  }

  drain(): TelemetryEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }
}
