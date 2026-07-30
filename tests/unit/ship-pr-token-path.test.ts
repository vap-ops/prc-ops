import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

// scripts/ship-pr.sh is the ONLY working push path in this repo: the org disables
// deploy keys and `origin` is credential-less HTTPS, so the fine-grained PAT it
// reads out of ../.github.env is the single credential that ships anything
// (ADR 0083 §5). If it cannot find that file, the session cannot ship AT ALL.
//
// It used to resolve the token as `$(git rev-parse --show-toplevel)/../.github.env`.
// That is correct for the main repo and for a SIBLING worktree (`../prc-ops-<lane>`),
// which is how every worktree was created when the script was written — but an
// APP-MANAGED worktree lives INSIDE the repo, at `.claude/worktrees/<name>`, so
// `$root/..` resolves to `.claude/worktrees/` and the token is nowhere near it.
// Hit live shipping #871 from such a worktree; the workaround was to copy the
// token in and delete it after, which leaves a secret transiently on disk.
//
// The token now resolves against the MAIN worktree root, derived from the common
// git dir, which is the same directory for the main repo, a sibling worktree and a
// nested one alike. This test executes the REAL block extracted from the script —
// not a copy — so the two cannot drift.

const shipPr = readFileSync(resolve(process.cwd(), "scripts/ship-pr.sh"), "utf8");

/** The token-resolution block, delimited in the script by marker comments. */
function tokenBlock(): string {
  const match = shipPr.match(
    /# >>> token-path \(tested by ship-pr-token-path\.test\.ts\)\n([\s\S]*?)# <<< token-path/,
  );
  if (!match || !match[1]) {
    throw new Error("could not find the token-path block markers in scripts/ship-pr.sh");
  }
  return match[1];
}

const tmpRoot = mkdtempSync(join(tmpdir(), "shipprtok-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

/** bash sees git-style forward slashes even on Windows. */
const sh = (p: string) => p.replaceAll("\\", "/");

/**
 * A throwaway checkout layout mirroring this box:
 *
 *   <container>/.github.env          <- the token, OUTSIDE every repo
 *   <container>/prc-ops/            <- main worktree, .git is a real dir
 *   <container>/prc-ops/.claude/worktrees/<name>/   <- app-managed worktree
 *   <container>/prc-ops-<lane>/     <- sibling worktree
 */
function layout(name: string, opts: { token?: string | null; legacyToken?: string } = {}) {
  const container = join(tmpRoot, name);
  const mainRoot = join(container, "prc-ops");
  const nested = join(mainRoot, ".claude", "worktrees", "wt1");
  const sibling = join(container, "prc-ops-lane");
  for (const d of [join(mainRoot, ".git"), nested, sibling]) mkdirSync(d, { recursive: true });
  if (opts.token !== null) {
    writeFileSync(
      join(container, ".github.env"),
      `GITHUB_TOKEN=${opts.token ?? "canonical-tok"}\n`,
    );
  }
  if (opts.legacyToken !== undefined) {
    // What `$root/..` points at for the nested worktree.
    writeFileSync(
      join(mainRoot, ".claude", "worktrees", ".github.env"),
      `GITHUB_TOKEN=${opts.legacyToken}\n`,
    );
  }
  return {
    commonGitDir: sh(join(mainRoot, ".git")),
    roots: { main: sh(mainRoot), nested: sh(nested), sibling: sh(sibling) },
  };
}

/** Run the real block for a given worktree root. Returns the token, or null on exit≠0. */
function resolveToken(
  root: string,
  commonGitDir: string,
): { token: string; envFile: string } | null {
  const script = `
set -euo pipefail
git() {
  case "$*" in
    "rev-parse --show-toplevel") printf '%s' "\${FAKE_ROOT}" ;;
    *--git-common-dir*) printf '%s' "\${FAKE_COMMON_GIT_DIR}" ;;
    *) echo "unexpected git call: $*" >&2; return 1 ;;
  esac
}
${tokenBlock()}
printf '%s\\n%s' "$token" "$env_file"
`;
  try {
    const out = execFileSync("bash", ["-c", script], {
      env: { ...process.env, FAKE_ROOT: root, FAKE_COMMON_GIT_DIR: commonGitDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [token = "", envFile = ""] = out.split("\n");
    return { token, envFile };
  } catch {
    return null;
  }
}

/** stderr of a run expected to fail, for asserting the diagnostic. */
function failureOutput(root: string, commonGitDir: string): string {
  const script = `
set -euo pipefail
git() {
  case "$*" in
    "rev-parse --show-toplevel") printf '%s' "\${FAKE_ROOT}" ;;
    *--git-common-dir*) printf '%s' "\${FAKE_COMMON_GIT_DIR}" ;;
    *) return 1 ;;
  esac
}
${tokenBlock()}
`;
  try {
    execFileSync("bash", ["-c", script], {
      env: { ...process.env, FAKE_ROOT: root, FAKE_COMMON_GIT_DIR: commonGitDir },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (e) {
    const err = e as { stderr?: string };
    return err.stderr ?? "";
  }
}

describe("ship-pr.sh token resolution", () => {
  it("finds the token from the MAIN worktree — the layout that always worked", () => {
    const { roots, commonGitDir } = layout("main-case");
    expect(resolveToken(roots.main, commonGitDir)?.token).toBe("canonical-tok");
  });

  it("finds the token from a SIBLING worktree — ../prc-ops-<lane>, also always worked", () => {
    const { roots, commonGitDir } = layout("sibling-case");
    expect(resolveToken(roots.sibling, commonGitDir)?.token).toBe("canonical-tok");
  });

  it("finds the token from an APP-MANAGED worktree nested at .claude/worktrees/<name>", () => {
    // The regression: `$root/..` is `.claude/worktrees/`, which holds no token, so
    // the script died with "missing .../.claude/worktrees/.github.env" and the
    // session could not ship at all.
    const { roots, commonGitDir } = layout("nested-case");
    expect(resolveToken(roots.nested, commonGitDir)?.token).toBe("canonical-tok");
  });

  it("still prefers a token sitting beside the worktree, so no working setup changes", () => {
    // Back-compat is deliberate: the legacy candidate is tried FIRST, so any
    // checkout that resolves today keeps resolving to the very same file.
    const { roots, commonGitDir } = layout("legacy-case", { legacyToken: "legacy-tok" });
    expect(resolveToken(roots.nested, commonGitDir)?.token).toBe("legacy-tok");
    // …while a worktree with no adjacent token still reaches the canonical one.
    expect(resolveToken(roots.sibling, commonGitDir)?.token).toBe("canonical-tok");
  });

  it("refuses to ship when no token exists anywhere, naming every path it tried", () => {
    const { roots, commonGitDir } = layout("absent-case", { token: null });
    expect(resolveToken(roots.nested, commonGitDir)).toBeNull();
    // A diagnostic naming only one candidate is what made this bug confusing: it
    // pointed inside `.claude/worktrees/`, a place nobody should put a token, and
    // said nothing about the path that actually holds one. Both are named now.
    const err = failureOutput(roots.nested, commonGitDir);
    expect(err).toContain("GITHUB_TOKEN");
    expect(err).toContain(`${roots.nested}/../.github.env`);
    expect(err).toContain(`${roots.main}/../.github.env`);
  });

  it("refuses a token file that exists but carries no GITHUB_TOKEN line", () => {
    const { roots, commonGitDir } = layout("blank-case", { token: null });
    writeFileSync(join(tmpRoot, "blank-case", ".github.env"), "# nothing useful here\n");
    expect(resolveToken(roots.nested, commonGitDir)).toBeNull();
    expect(failureOutput(roots.nested, commonGitDir)).toContain("no GITHUB_TOKEN");
  });
});
