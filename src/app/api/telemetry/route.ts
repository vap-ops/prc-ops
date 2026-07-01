// Spec 244 U1b / ADR 0068 (Tier B) — the client-telemetry ingest. Accepts a
// batch of interaction events from the SA usage tracker and writes them via the
// user's RLS server client (so RLS insert-own + the DB stamp trigger enforce
// identity — the client never sends actor_id/actor_role, and cannot spoof it).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db/server";
import type { Database, Json } from "@/lib/db/database.types";
import type { TelemetryEventType } from "@/lib/telemetry/session";

type InteractionInsert = Database["public"]["Tables"]["interaction_events"]["Insert"];

const EVENT_TYPES: readonly TelemetryEventType[] = [
  "session_start",
  "heartbeat",
  "session_end",
  "route_view",
  "feature_touch",
];
const MAX_EVENTS = 100;
const MAX_CONTEXT_CHARS = 4000; // bound the jsonb so a client can't bloat storage

interface CleanEvent {
  session_id: string;
  event_type: TelemetryEventType;
  route: string | null;
  context: Json;
  app_version: string | null;
  client_ts: string | null;
}

// Untrusted input from the browser — validate shape + bound every string; drop
// anything malformed rather than trusting it.
function sanitize(raw: unknown): CleanEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const sid = e.session_id;
  const type = e.event_type;
  if (typeof sid !== "string" || sid.length === 0 || sid.length > 100) return null;
  if (typeof type !== "string" || !EVENT_TYPES.includes(type as TelemetryEventType)) return null;
  let context: Json = null;
  if (typeof e.context === "object" && e.context !== null && !Array.isArray(e.context)) {
    // bound the serialized size; drop an oversized context but keep the event
    const serialized = JSON.stringify(e.context);
    if (serialized.length <= MAX_CONTEXT_CHARS) context = e.context as Json;
  }
  return {
    session_id: sid,
    event_type: type as TelemetryEventType,
    route: typeof e.route === "string" ? e.route.slice(0, 300) : null,
    context,
    app_version: typeof e.app_version === "string" ? e.app_version.slice(0, 50) : null,
    client_ts: typeof e.client_ts === "string" ? e.client_ts.slice(0, 40) : null,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "no events" }, { status: 400 });
  }
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ error: "too many events" }, { status: 413 });
  }

  const supabase = await createClient();
  const { data: claimData } = await supabase.auth.getClaims();
  const userId = claimData?.claims.sub;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { data: userRow } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!userRow) {
    return NextResponse.json({ error: "unknown user" }, { status: 401 });
  }

  const rows: InteractionInsert[] = [];
  for (const raw of events) {
    const s = sanitize(raw);
    if (!s) continue;
    // actor_id/actor_role are also force-stamped by the DB trigger from the
    // session; we pass the real (type-required) values — identity is never taken
    // from the client, so it cannot be spoofed. RLS insert-own applies.
    rows.push({
      actor_id: userId,
      actor_role: userRow.role,
      session_id: s.session_id,
      event_type: s.event_type,
      route: s.route,
      context: s.context,
      app_version: s.app_version,
      client_ts: s.client_ts,
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid events" }, { status: 400 });
  }

  const { error } = await supabase.from("interaction_events").insert(rows);
  if (error) {
    return NextResponse.json({ error: "insert failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, accepted: rows.length }, { status: 202 });
}
