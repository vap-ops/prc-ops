// Spec 287 — `/api/health` liveness probe. A dependency-free 200 an uptime
// monitor can poll; also reports the running build version (`pkg.version`, the
// same source spec 246 stamps into feedback/telemetry). Liveness only — no DB,
// no service-role, no auth — so it stays off the danger-path and adds no attack
// surface. GA gap register G5.

import { NextResponse } from "next/server";

import pkg from "../../../../package.json";

// The probe must reflect the live process, never a statically-cached response.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    status: "ok",
    version: pkg.version,
    timestamp: new Date().toISOString(),
  });
}
