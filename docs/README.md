# docs/ — index

What each doc is and when to read it. **Binding** docs override defaults and
must be followed; **living** docs track current state; **reference** docs
inform; **historical** docs are spent (kept for rationale, not current rules).

## Folders (each has its own index)

| Folder           | Index                                                | What                                                  | Status    |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------- | --------- |
| `decisions/`     | [`decisions/README.md`](decisions/README.md)         | Architecture Decision Records (40 ADRs, through 0043) | binding   |
| `feature-specs/` | [`feature-specs/README.md`](feature-specs/README.md) | Numbered, locked feature specs (one per unit)         | binding   |
| `policies/`      | —                                                    | Binding process policies                              | binding   |
| `specs/`         | —                                                    | Original v1 entity/data specs                         | reference |

## Top-level docs

| Doc                                                                    | What it is                                                        | When to read                                              | Status     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| [`v2-handoff.md`](v2-handoff.md)                                       | Start-here context bridge — the whole system in brief, with links | First, on any new session                                 | reference  |
| [`progress-tracker.md`](progress-tracker.md)                           | Per-unit log; the tail holds current state + open-questions queue | Read the tail before/while working a unit                 | living     |
| [`progress-archive.md`](progress-archive.md)                           | Archived tracker history (units before Spec 21)                   | Only when you need old-unit detail                        | historical |
| [`site-map.md`](site-map.md)                                           | Every route, its gate, arrival path, and back target              | Before any nav/route change — **update it the same unit** | binding    |
| [`ui-conventions.md`](ui-conventions.md)                               | The canonical UI rules (chrome, primitives, tokens, layout)       | Before any UI work — hand-rolled copies are review-reject | binding    |
| [`sdd-2026-06.md`](sdd-2026-06.md)                                     | Full software design description (post-spec-65)                   | When you need the whole-system design picture             | reference  |
| [`policies/change-management.md`](policies/change-management.md)       | DB/schema/Storage/role change process                             | Before any DB change                                      | binding    |
| [`specs/v1-entities.md`](specs/v1-entities.md)                         | The original five v1 entities                                     | Background on the core data model                         | reference  |
| [`go-live-checklist.md`](go-live-checklist.md)                         | v1 go-live + dry-run operational checklist                        | Pre-launch / dry-run                                      | reference  |
| [`architecture-revision-2026-06.md`](architecture-revision-2026-06.md) | Entrepreneur-lens revision; its decisions became ADRs 0034–0036   | Background on the AppSheet-sunset/tenancy direction       | historical |
| [`ceo-review-2026-06.md`](ceo-review-2026-06.md)                       | Executive 3-lens review + prioritized "now/next" moves            | Strategic priorities context                              | historical |
| [`app-feel-options.md`](app-feel-options.md)                           | Options for making the app feel native (the app-feel roadmap)     | App-feel design work                                      | advisory   |
| [`design-directions-2026-06.md`](design-directions-2026-06.md)         | The "looks generated" re-skin proposal; its pick became spec 38   | Background on the re-skin only                            | historical |

Binding rules and project workflow live in [`../CLAUDE.md`](../CLAUDE.md) — read
that first; the docs here are the detail it points into.
