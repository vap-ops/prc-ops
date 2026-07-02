# Spec 246 — SemVer release automation (semantic-release)

**Status:** shipped (this unit)
**Requested:** operator, 2026-07-02 — "the versioning is at 0.1.0, apply best practice to versioning control"

## Problem

`package.json` sat at `0.1.0` forever while ~240 PRs merged. The app stamps
`pkg.version` into every feedback row (`app_version`) and telemetry session, so
every bug report says `0.1.0` — useless for "which build were you on?" triage
(this bit report 58e4c8d8, where a deploy/cache-lag question couldn't be
answered). There was no changelog and no tags.

## Decision

Adopt **semantic-release**, driven by the Conventional Commits this repo already
enforces. Versions are _derived_, never hand-bumped:

- `fix:` → patch · `feat:` → minor · `BREAKING CHANGE` → major
- `docs:`/`test:`/`refactor:`/`chore:` → no release

On every push to `main` the Release workflow: bumps `package.json`, writes
`CHANGELOG.md`, tags `vX.Y.Z`, publishes a GitHub Release, and pushes one
`chore(release): X.Y.Z [skip ci]` commit back to `main`. Vercel redeploys that
commit, so the live app (and therefore every new feedback/telemetry row) carries
the real version.

Baseline: tag `v0.1.0` created on `d1aa0deb` (the pre-automation state) so the
first automated release continues the 0.x line. **Stay 0.x until beta go-live**,
then cut `1.0.0` deliberately (a `feat!:`/BREAKING commit or a manual
`--release-as`-style decision at that time).

## Units

- **U1 (this unit, code-only + workflow):** `.releaserc.json` + `.github/workflows/release.yml`
  - dev-deps (`semantic-release`, `@semantic-release/changelog`, `@semantic-release/git`)
  - baseline tag. Workflow skips green with a warning until the `RELEASE_TOKEN`
    secret exists.
- **Operator one-time action:** add repo secret `RELEASE_TOKEN` (a PAT with
  `contents: write` that can push to protected `main`; the existing pipeline PAT
  qualifies). The API refuses to let the pipeline PAT write secrets (403), so
  this is manual by design.

## Verification checklist

- [x] `semantic-release --dry-run` loads config + all plugins, correctly skips off-main branches
- [x] `v0.1.0` baseline tag pushed
- [ ] After `RELEASE_TOKEN` exists: first `fix:` merge to main produces `v0.1.1` (tag + GitHub Release + CHANGELOG + release commit), and a new feedback row records `app_version = 0.1.1` after the redeploy

## Out of scope

- CalVer, release trains, manual approval gates for releases
- Worker (`worker/`) versioning (separate package; version it if/when it needs one)
- Backfilling CHANGELOG for pre-automation history (the git log + closed PRs are the record)
