import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReachabilityChip } from "@/components/features/roles/reachability-chip";

// Spec 386 U5. The page-level wiring (which columns are read, and that the
// bot-unset caveat renders) is pinned by source scan below: /settings/roles is a
// Server Component this suite cannot render, so an RTL test of the CHILD would
// assert nothing about it (the spec 363 U1 lesson).

const PAGE = readFileSync(join(process.cwd(), "src/app/settings/roles/page.tsx"), "utf8");

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

describe("ReachabilityChip", () => {
  it("labels each state", () => {
    render(<ReachabilityChip reach="telegram" />);
    expect(screen.getByTestId("reach-telegram")).toHaveTextContent("Telegram");
  });

  it("styles UNKNOWN neutrally, never as a warning", () => {
    render(<ReachabilityChip reach="unknown" />);
    const chip = screen.getByTestId("reach-unknown");
    expect(chip).toHaveTextContent("ยังไม่ทราบ");
    // the whole point: an unprobed user must not look like a failure
    expect(chip.className).not.toContain("attn");
    expect(chip.className).not.toContain("danger");
  });

  it("styles NONE as the warning state — that one IS a problem", () => {
    render(<ReachabilityChip reach="none" />);
    expect(screen.getByTestId("reach-none").className).toContain("attn");
  });
});

describe("/settings/roles wires the roster tracker", () => {
  it("reads both contact columns", () => {
    const code = stripComments(PAGE);
    expect(code).toContain("telegram_chat_id, line_oa_friend");
  });

  it("classifies and summarises (import PLUS a real usage each)", () => {
    const code = stripComments(PAGE);
    expect(occurrences(code, "classifyReachability")).toBe(2);
    expect(occurrences(code, "summarizeReachability")).toBe(2);
  });

  it("warns that a Telegram chip is NOT delivery while the bot is unconfigured", () => {
    const code = stripComments(PAGE);
    // without this the roster implies a bound user is a reached user, which is
    // false until spec 386 U0 lands
    expect(occurrences(code, "REACH_BOT_UNSET")).toBe(2);
    expect(code).toContain("serverEnv.TELEGRAM_BOT_TOKEN");
  });

  it("keeps the unknown-is-not-unreachable hint on screen", () => {
    const code = stripComments(PAGE);
    expect(occurrences(code, "REACH_UNKNOWN_HINT")).toBe(2);
  });
});
