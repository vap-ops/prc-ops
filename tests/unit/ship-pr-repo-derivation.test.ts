import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// scripts/ship-pr.sh is the MANDATED ship path for every change (CLAUDE.md
// "Operating environment"). Its owner/repo slug feeds the REST PR-create call.
// It used to be the literal `VAP-Solution/prc-ops`, which ADR 0083's preflight
// sweep found would break every post-transfer ship: an authenticated POST to a
// transferred repo gets a 301 that this curl does not follow, and following it
// would demote POST to GET, so no PR is created either way.
//
// The slug is now DERIVED from the origin remote (with a SHIP_REPO override), so
// the single shared .git/config heals the main repo and all ~21 linked worktrees
// at once. This test executes the REAL derivation block extracted from the
// script — not a copy — so the two cannot drift.

// Each derivation case spawns a REAL `bash -c` (msys on the Windows dev box) to
// run the extracted block, and the block itself forks `sed`. That process-
// creation cost is IRREDUCIBLE without either reimplementing the block in JS
// (which would defeat "test the real block, not a copy") or weakening the
// suite. Measured on this box (idle): 15 sequential spawns ≈ 1.7s, and the
// slowest single test makes 4 spawns and already exceeds vitest's 5000ms
// default under suite CPU load. Cheaper shapes were measured and REJECTED:
// batching all cases into one bash process with subshells is a wash (1623 vs
// 1633ms — msys fork() costs the same as a bash -c spawn), running them
// concurrently wins only ~1.4× at the price of 15 extra concurrent processes on
// an already-loaded box, and a zero-fork `exit`-override is unsound (`return`
// unwinds the overridden `exit`, not its caller). So the fix is an explicit
// per-suite timeout (the 3rd arg to `describe`, which cascades to every child
// test) — NOT a raise of the suite-wide default, which is generous on CI Linux
// and only tight here. CI stays green 15/15; this is Windows-box-only.
const SPAWN_HEAVY_TIMEOUT_MS = 30_000;

const shipPr = readFileSync(resolve(process.cwd(), "scripts/ship-pr.sh"), "utf8");

/** The derivation block, delimited in the script by marker comments. */
function derivationBlock(): string {
  const match = shipPr.match(
    /# >>> repo-derivation \(tested by ship-pr-repo-derivation\.test\.ts\)\n([\s\S]*?)# <<< repo-derivation/,
  );
  if (!match || !match[1]) {
    throw new Error("could not find the repo-derivation block markers in scripts/ship-pr.sh");
  }
  return match[1];
}

/** Run the real block with a given origin URL; return the slug or null if it exited non-zero. */
function derive(originUrl: string, env: Record<string, string> = {}): string | null {
  const script = `
set -euo pipefail
git() { [ "$1" = remote ] && printf '%s' "\${FAKE_ORIGIN}"; }
${derivationBlock()}
printf '%s' "$repo"
`;
  try {
    return execFileSync("bash", ["-c", script], {
      // Inherit the real env (the repo's ProcessEnv typing requires its keys),
      // then blank SHIP_REPO/GITHUB_REPOSITORY so an ambient value from the
      // developer's shell or CI cannot mask a derivation bug.
      env: {
        ...process.env,
        SHIP_REPO: "",
        GITHUB_REPOSITORY: "",
        FAKE_ORIGIN: originUrl,
        ...env,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

describe(
  "ship-pr.sh owner/repo derivation",
  () => {
    it("derives from the remote forms git actually produces", () => {
      expect(derive("git@github.com:VAP-Solution/prc-ops.git")).toBe("VAP-Solution/prc-ops");
      expect(derive("https://github.com/NewOrg/prc-ops.git")).toBe("NewOrg/prc-ops");
      expect(derive("https://github.com/NewOrg/prc-ops")).toBe("NewOrg/prc-ops");
      expect(derive("ssh://git@github.com/NewOrg/prc-ops.git")).toBe("NewOrg/prc-ops");
    });

    it("handles GitHub org SSH-certificate remotes — the exact shape ADR 0083 transfers into", () => {
      // Orgs using SSH CAs hand out remotes with a numeric user, e.g. org-1234@.
      expect(derive("org-1234@github.com:NewOrg/prc-ops.git")).toBe("NewOrg/prc-ops");
      expect(derive("ssh://org-99@github.com/NewOrg/prc-ops.git")).toBe("NewOrg/prc-ops");
    });

    it("refuses a lookalike host rather than POSTing the token somewhere else", () => {
      expect(derive("https://evil.com/x/github.com/attacker/repo.git")).toBeNull();
      expect(derive("git@gitlab.com:Other/thing.git")).toBeNull();
    });

    it("refuses relative/dot owners that would build a path-traversing API URL", () => {
      expect(derive("../prc-ops")).toBeNull();
      expect(derive("./prc-ops")).toBeNull();
    });

    it("refuses an empty or shapeless remote instead of guessing", () => {
      expect(derive("")).toBeNull();
      expect(derive("not-a-url")).toBeNull();
    });

    it("honours an explicit SHIP_REPO override but still validates its shape", () => {
      expect(
        derive("git@github.com:VAP-Solution/prc-ops.git", { SHIP_REPO: "Manual/Override" }),
      ).toBe("Manual/Override");
      expect(
        derive("git@github.com:VAP-Solution/prc-ops.git", { SHIP_REPO: "garbage" }),
      ).toBeNull();
    });

    it("does not let an ambient GITHUB_REPOSITORY silently retarget the PR", () => {
      // The push goes to `origin`; if the PR-create used an ambient env var
      // instead, the two could point at different repos. Origin wins.
      expect(
        derive("git@github.com:VAP-Solution/prc-ops.git", { GITHUB_REPOSITORY: "Someone/Else" }),
      ).toBe("VAP-Solution/prc-ops");
    });
    // 3rd arg = per-suite timeout, cascades to every `it` above (see the block
    // comment on SPAWN_HEAVY_TIMEOUT_MS). Scoped to this file so the suite-wide
    // 5000ms default is untouched.
  },
  SPAWN_HEAVY_TIMEOUT_MS,
);
