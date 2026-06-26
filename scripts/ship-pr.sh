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

title="${1:?usage: scripts/ship-pr.sh <title> [body]}"
body="${2:-}"
repo="VAP-Solution/prc-ops"

root="$(git rev-parse --show-toplevel)"
env_file="$root/../.github.env"
[ -f "$env_file" ] || { echo "missing $env_file (expected GITHUB_TOKEN=...)" >&2; exit 1; }
token="$(sed -n 's/^GITHUB_TOKEN=//p' "$env_file" | head -1)"
[ -n "$token" ] || { echo "no GITHUB_TOKEN in $env_file" >&2; exit 1; }

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" != "main" ] || { echo "refusing to open a PR from main — work on a branch" >&2; exit 1; }

# Push the branch (deploy key); idempotent.
git push -u origin "$branch" >/dev/null 2>&1 || git push origin "$branch"

# Open the PR (REST). Build/parse JSON with node since jq isn't installed.
payload="$(TITLE="$title" HEAD="$branch" BODY="$body" node -e 'process.stdout.write(JSON.stringify({title:process.env.TITLE,head:process.env.HEAD,base:"main",body:process.env.BODY}))')"
resp="$(curl -sS -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" "https://api.github.com/repos/$repo/pulls" -d "$payload")"
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
