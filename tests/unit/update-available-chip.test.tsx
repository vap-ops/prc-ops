// Writing failing test first.
//
// Spec 339 U2b — the non-forcing update chip for APPROVED users.
//
// U2a (shipped) auto-reloads the unapproved cohort, who have no task in flight.
// Approved users must never be reloaded out from under in-flight work, so they
// get an offer instead of an action: a dismissible chip that reloads only on tap.
//
// Live grounding 2026-07-30: of 15 users active in the last 3 days, **14 were
// running a stale bundle** — one technician 31 releases behind. The only existing
// signal was U1's passive line inside /settings → เกี่ยวกับ, a page site admins
// opened 70 times in 14 days against 810 visits to /sa. The detection was right;
// its placement could not reach anyone.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  shouldOfferUpdate,
  UpdateAvailableChip,
} from "@/components/features/chrome/update-available-chip";

describe("shouldOfferUpdate (spec 339 U2b)", () => {
  const base = { clientVersion: "0.239.0", deployedVersion: "0.270.0", dismissedFor: null };

  it("offers when the running bundle is behind the deployed one", () => {
    expect(shouldOfferUpdate(base)).toBe(true);
  });

  it("stays silent when the versions match", () => {
    expect(shouldOfferUpdate({ ...base, clientVersion: "0.270.0" })).toBe(false);
  });

  it("ignores the build sha Vercel appends", () => {
    // `NEXT_PUBLIC_APP_VERSION` carries `0.270.0+7f3a1c2`; /api/health never does.
    // Comparing them raw would report every up-to-date device as stale — the chip
    // would then be permanently on screen for everyone, which is worse than absent.
    expect(shouldOfferUpdate({ ...base, clientVersion: "0.270.0+7f3a1c2" })).toBe(false);
  });

  it("stays silent when the client version is unknown", () => {
    // Unset in dev/test (env.ts marks it optional). Unknown is not stale.
    expect(shouldOfferUpdate({ ...base, clientVersion: null })).toBe(false);
    expect(shouldOfferUpdate({ ...base, clientVersion: "" })).toBe(false);
  });

  it("stays silent when the probe failed", () => {
    // Offline or a 500 — never nag on the strength of a failed request.
    expect(shouldOfferUpdate({ ...base, deployedVersion: null })).toBe(false);
  });

  it("stays silent once dismissed for THAT deployed version", () => {
    expect(shouldOfferUpdate({ ...base, dismissedFor: "0.270.0" })).toBe(false);
  });

  it("offers again when a NEWER version ships after a dismiss", () => {
    // Dismissing 0.270.0 must not mute 0.271.0 — otherwise one tap silences every
    // future release for the life of the session.
    expect(shouldOfferUpdate({ ...base, dismissedFor: "0.269.0" })).toBe(true);
  });
});

describe("spec 339 U2b — mounted in the app chrome", () => {
  // The root layout is a Server Component vitest cannot render, and the whole
  // point of the unit is WHERE this lives: the same comparison already existed
  // on /settings and reached nobody. Dropping the mount would leave every test
  // above green while restoring the original defect, so the mount is pinned.
  const src = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("renders in the root layout, ungated", () => {
    expect(src.split("UpdateAvailableChip").length - 1).toBe(2); // import + one usage
    expect(src).toMatch(/\n\s*<UpdateAvailableChip \/>\n/);
  });
});

describe("<UpdateAvailableChip> (spec 339 U2b)", () => {
  it("renders nothing when there is no update", () => {
    const { container } = render(<UpdateAvailableChip clientVersion="0.270.0" probed="0.270.0" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the update with a reload action and a dismiss", () => {
    render(<UpdateAvailableChip clientVersion="0.239.0" probed="0.270.0" />);
    expect(screen.getByRole("button", { name: /อัปเดต/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ปิด/ })).toBeInTheDocument();
  });

  it("announces itself politely, never assertively", () => {
    // A background release is not an emergency and must not interrupt a screen
    // reader mid-sentence; `role="alert"` is reserved for real events.
    render(<UpdateAvailableChip clientVersion="0.239.0" probed="0.270.0" />);
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent(/เวอร์ชันใหม่/);
  });
});
