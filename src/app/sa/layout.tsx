// Spec 244 U1b — scope usage telemetry to the site-admin (SA) surfaces. Server
// Component: reads the client-safe kill switch and wraps the SA pages (which stay
// server-rendered as children) in the client tracker provider. No <html>/<body>
// here — the root layout owns those.

import type { ReactNode } from "react";
import { clientEnv } from "@/lib/env";
import { TelemetryProvider } from "@/components/features/telemetry/telemetry-provider";

export default function SaLayout({ children }: { children: ReactNode }) {
  return (
    <TelemetryProvider enabled={clientEnv.NEXT_PUBLIC_TELEMETRY_ENABLED !== "false"}>
      {children}
    </TelemetryProvider>
  );
}
