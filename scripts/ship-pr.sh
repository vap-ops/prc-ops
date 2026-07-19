#!/usr/bin/env bash
# Autonomous-build ship gate — open a gated PR for the current branch → main and
# request auto-merge, using the pipeline's fine-grained PAT (kept OUTSIDE the repo at
# ../.github.env; never commit a token). The pipeline pushes a branch and calls this
# instead of pushing to main. CI runs on the PR: a clean code-only PR auto-merges
# itself once green; a PR that trips the danger-path guard fails that required check
# and waits for the operator's manual merge.
#
# Usage:  scripts/ship-pr.sh "<title>" ["<body>"]
# Needs:  node on PATH (no jq on this box); the SSH deploy key for the branch push.
set -euo pipefail

# This box keeps node outside the default PATH (cloud-PC quirk — see the
# cloud-pc-quirks memory). Make it resolvable so the JSON build/parse below works
# regardless of the caller's PATH; a no-op when node is already on PATH (e.g. CI).
command -v node >/dev/null 2>&1 || PATH="/c/Program Files/nodejs:$PATH"

title="${1:?usage: scripts/ship-pr.sh <title> [body]}"
body="${2:-}"
# >>> repo-derivation (tested by ship-pr-repo-derivation.test.ts)
# owner/repo is DERIVED from `origin`, never hardcoded (ADR 0083): the API path
# must follow the repo if it is transferred to an org. GitHub's redirect does NOT
# rescue a hardcoded path — an authenticated POST gets a 301 this curl does not
# follow, and following it would demote POST to GET, so no PR is created either
# way. Deriving also means the ONE shared .git/config heals every worktree at
# once, instead of each needing this tracked file rebased.
#
# `origin` wins over any ambient env var on purpose: the branch is pushed to
# `origin`, so taking the PR target from elsewhere could open the PR against a
# different repo than the one just pushed to. SHIP_REPO is the explicit escape
# hatch and is shape-checked like any other value.
origin_url=""
repo="${SHIP_REPO:-}"
if [ -z "$repo" ]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  # Host-anchored: <user>@github.com:owner/repo(.git) — <user> covers org SSH-CA
  # remotes (org-1234@github.com:...) — or https://[user@]github.com/owner/repo.
  repo="$(printf '%s' "$origin_url" | sed -E 's#^(ssh://)?[A-Za-z0-9._-]+@github\.com[:/]##; s#^https://([^/@]+@)?github\.com/##; s#\.git$##')"
fi
# Anchored at STRING ends (not per line, which `grep -E '^…$'` would allow), and
# `.`/`..` owners are rejected so a relative remote can never build a
# path-traversing API URL.
if ! [[ "$repo" =~ ^[A-Za-z0-9_-][A-Za-z0-9._-]*/[A-Za-z0-9_-][A-Za-z0-9._-]*$ ]]; then
  echo "cannot derive a github owner/repo — got '${repo:-empty}' (SHIP_REPO='${SHIP_REPO:-unset}', origin='${origin_url:-unset}')" >&2
  exit 1
fi
# <<< repo-derivation

root="$(git rev-parse --show-toplevel)"
env_file="$root/../.github.env"
[ -f "$env_file" ] || { echo "missing $env_file (expected GITHUB_TOKEN=...)" >&2; exit 1; }
token="$(sed -n 's/^GITHUB_TOKEN=//p' "$env_file" | head -1)"
[ -n "$token" ] || { echo "no GITHUB_TOKEN in $env_file" >&2; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "main" ] || { echo "refusing to open a PR from main — work on a branch" >&2; exit 1; }

# Conflict probe (2026-07-09): a PR must PROVE it merges clean before shipping —
# "merges clean" is a mechanical fact, not a claim. git merge-tree --write-tree
# exits non-zero and lists conflicted paths when the merge would conflict.
if [ -z "${SHIP_SKIP_CONFLICT_PROBE:-}" ]; then
  if ! git fetch origin main --quiet; then
    echo "conflict probe: could not fetch origin/main (network/auth?) — fix connectivity or set SHIP_SKIP_CONFLICT_PROBE=1" >&2
    exit 1
  fi
  # merge-tree exits 1 for a real conflict; anything else non-zero is a probe error.
  set +e
  git merge-tree --write-tree FETCH_HEAD HEAD >/dev/null 2>&1
  probe=$?
  set -e
  if [ "$probe" -eq 1 ]; then
    {
      echo "CONFLICT vs origin/main — this branch does not merge clean."
      echo "Rebase first (git rebase FETCH_HEAD) or set SHIP_SKIP_CONFLICT_PROBE=1 to override. Conflicted output:"
      git merge-tree --write-tree --no-messages FETCH_HEAD HEAD 2>/dev/null | tail -n +2 || true
    } >&2
    exit 1
  elif [ "$probe" -ne 0 ]; then
    echo "conflict probe: git merge-tree failed (exit $probe) — not a conflict; investigate or set SHIP_SKIP_CONFLICT_PROBE=1" >&2
    exit 1
  fi
fi

# Push the branch (deploy key); idempotent.
git push -u origin "$branch" >/dev/null 2>&1 || git push origin "$branch"

# Open the PR (REST). Build/parse JSON with node since jq isn't installed.
# Pipe the payload via stdin (--data @-), NOT -d "$payload": this box's mingw curl
# mangles a JSON arg (GitHub then 400s "Problems parsing JSON"); stdin is byte-clean.
payload="$(TITLE="$title" HEAD="$branch" BODY="$body" node -e 'process.stdout.write(JSON.stringify({title:process.env.TITLE,head:process.env.HEAD,base:"main",body:process.env.BODY}))')"
resp="$(printf '%s' "$payload" | curl -sS -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" "https://api.github.com/repos/$repo/pulls" --data @-)"
read -r node_id number url <<<"$(RESP="$resp" node -e 'const r=JSON.parse(process.env.RESP);process.stdout.write(`${r.node_id||""} ${r.number||""} ${r.html_url||""}`)')"
if [ -z "$node_id" ]; then
  echo "PR open failed: $(RESP="$resp" node -e 'const r=JSON.parse(process.env.RESP);process.stdout.write(r.message||JSON.stringify(r))')" >&2
  exit 1
fi

# Request native auto-merge (squash). Requires branch protection + "Allow auto-merge";
# until those are on it errors harmlessly and the operator merges the green PR manually.
am="$(NODE_ID="$node_id" node -e 'process.stdout.write(JSON.stringify({query:"mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){pullRequest{number}}}",variables:{id:process.env.NODE_ID}}))' \
  | curl -sS -X POST -H "Authorization: Bearer $token" -H "Content-Type: application/json" https://api.github.com/graphql -d @-)"
if RESP="$am" node -e 'process.exit(JSON.parse(process.env.RESP).errors?1:0)'; then
  echo "PR #$number opened + auto-merge requested → $url"
else
  echo "PR #$number opened → $url  (auto-merge not active yet; merge it once branch protection + Allow auto-merge are on)"
fi
