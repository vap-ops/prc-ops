import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationDeliveryHealthNotice } from "@/components/features/notifications/delivery-health-notice";
import { summarizeDeliveryHealth } from "@/lib/notifications/delivery-health";

// Spec 387 U2. The GATE (super_admin only) is held by the PAGE, which is a
// Server Component this suite cannot render — so it is pinned by a source scan
// below, not by an RTL case that would silently assert nothing (the spec 363 U1
// lesson: a correctly-named test of the CHILD is not coverage of the parent's
// branch).

const PAGE = readFileSync(join(process.cwd(), "src/app/settings/page.tsx"), "utf8");

/** Line-based comment strip: these files carry `https://` URLs, so stripping
 *  from the first `//` would eat real code. A doc comment naming a symbol must
 *  not satisfy a presence pin. */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("NotificationDeliveryHealthNotice", () => {
  it("renders NOTHING when the probe failed (null) — no nag on our own failure", () => {
    const { container } = render(<NotificationDeliveryHealthNotice health={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders NOTHING when the pipeline is healthy", () => {
    const health = summarizeDeliveryHealth({ terminal: 456, failed: 0, lastError: null });
    const { container } = render(<NotificationDeliveryHealthNotice health={health} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the counts and the verbatim cause when degraded", () => {
    const health = summarizeDeliveryHealth({
      terminal: 244,
      failed: 218,
      lastError: 'LINE 429: {"message":"You have reached your monthly limit."}',
    });
    render(<NotificationDeliveryHealthNotice health={health} />);
    expect(screen.getByTestId("notif-delivery-health")).toBeInTheDocument();
    expect(screen.getByText(/218 จาก 244/)).toBeInTheDocument();
    // the cause is the actionable half — a bare count does not tell the
    // operator whether to buy quota or fix a token
    expect(screen.getByText(/monthly limit/)).toBeInTheDocument();
  });

  it("is announced, and does NOT offer a retry it cannot honour", () => {
    const health = summarizeDeliveryHealth({ terminal: 7, failed: 7, lastError: null });
    render(<NotificationDeliveryHealthNotice health={health} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/กดลองใหม่ได้/)).not.toBeInTheDocument();
  });
});

describe("/settings wires the notice behind the super_admin gate", () => {
  it("renders the component (import PLUS a real usage)", () => {
    const code = stripComments(PAGE);
    expect(occurrences(code, "NotificationDeliveryHealthNotice")).toBe(2);
  });

  it("loads the health read only for super_admin", () => {
    const code = stripComments(PAGE);
    expect(occurrences(code, "loadDeliveryHealth")).toBe(2);
    // the gate itself — a service-role read must not run for every visitor
    expect(code).toMatch(/role === "super_admin"\s*\?\s*await loadDeliveryHealth/);
  });
});
