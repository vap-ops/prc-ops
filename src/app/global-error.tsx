"use client";

import { useEffect, useRef, useState } from "react";
import { boundaryRetryKey, hasRecentRetry, recordRetry } from "@/lib/errors/boundary-retry";
import { trackFriction } from "@/lib/telemetry/friction";
import { errorMessageForTelemetry } from "@/lib/telemetry/session";
import {
  ERROR_BOUNDARY_BODY,
  ERROR_BOUNDARY_CODE_PREFIX,
  ERROR_BOUNDARY_HOME,
  ERROR_BOUNDARY_RECURRED_BODY,
  ERROR_BOUNDARY_RECURRED_TITLE,
  ERROR_BOUNDARY_RETRY,
  ERROR_BOUNDARY_TITLE,
} from "@/lib/i18n/labels";

// Root-layout error boundary (spec 15 item G). error.tsx covers segment
// errors but NOT a throw inside the root layout itself — without this
// file those still reach Next.js's built-in English page. Next.js
// requires global-error to be a Client Component and to render its own
// <html>/<body>; the root layout (and its font variables / globals.css)
// is not mounted when this renders, hence the inline styles and the
// system-font fallback. Copy is imported from labels.ts (the 2+-places
// SSOT rule — error.tsx shares it), which is a pure client-safe module.
//
// F-027 telemetry: HONESTLY a likely no-op today — React unmounts the
// failed tree (including TelemetryProvider, whose cleanup nulls the
// friction sink) before mounting this boundary, so the call lands only in
// the narrow case where the sink survived. Kept because it is free and a
// direct-POST fallback can be wired behind the same call later; do NOT
// read a zero global_error_boundary count as "no root crashes".
//
// F-012 honest-copy split applies here too, via the same boundary-retry
// store. The recurred exit is a plain <a href="/"> — nothing above this
// boundary is guaranteed alive, so a full document load is the only exit
// that depends on nothing.

const styles = {
  body: {
    margin: 0,
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#09090b",
    color: "#f4f4f5",
    fontFamily: "Sarabun, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    textAlign: "center" as const,
    padding: "0 1.5rem",
  },
  title: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  bodyText: { fontSize: "0.875rem", color: "#a1a1aa", margin: "1rem 0 1.5rem" },
  control: {
    cursor: "pointer",
    borderRadius: "0.375rem",
    border: "none",
    backgroundColor: "#27272a",
    color: "#f4f4f5",
    padding: "0.625rem 1.25rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    fontFamily: "inherit",
    textDecoration: "none",
    display: "inline-block",
  },
  code: { fontSize: "0.75rem", color: "#a1a1aa", marginTop: "1.25rem" },
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const key = boundaryRetryKey(error);
  const [recurred] = useState(() => hasRecentRetry(key));
  const code = error.digest ?? error.name;

  const emitted = useRef(false);
  useEffect(() => {
    if (emitted.current) return;
    emitted.current = true;
    trackFriction("js_error", {
      where: "global_error_boundary",
      message: errorMessageForTelemetry(error),
      digest: error.digest ?? null,
      recurred,
    });
  }, [error, recurred]);

  function onRetry() {
    recordRetry(key);
    reset();
  }

  return (
    <html lang="th">
      <body style={styles.body}>
        <div style={{ maxWidth: "28rem" }}>
          {recurred ? (
            <>
              <h1 style={styles.title}>{ERROR_BOUNDARY_RECURRED_TITLE}</h1>
              <p role="alert" style={styles.bodyText}>
                {ERROR_BOUNDARY_RECURRED_BODY}
              </p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                  nothing above this boundary is guaranteed alive (the root
                  layout crashed); a full document load is the only exit that
                  depends on nothing. */}
              <a href="/" style={styles.control}>
                {ERROR_BOUNDARY_HOME}
              </a>
              <p style={styles.code}>
                {ERROR_BOUNDARY_CODE_PREFIX}: {code}
              </p>
            </>
          ) : (
            <>
              <h1 style={styles.title}>{ERROR_BOUNDARY_TITLE}</h1>
              <p style={styles.bodyText}>{ERROR_BOUNDARY_BODY}</p>
              <button type="button" onClick={onRetry} style={styles.control}>
                {ERROR_BOUNDARY_RETRY}
              </button>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
