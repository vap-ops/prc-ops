# Spec 89 — Contacts v2 Unit 9: blacklist hidden from assignment pickers

Contacts v2. Code-only. The operator's core ask: a blacklisted crew must not be selectable for new work. Blacklist stays a status (never a delete, spec 83), so filtering happens at the **pickers**, never at history/payroll.

## Two picker surfaces

1. **WP owner picker** — the WP detail page (`/projects/[projectId]/work-packages/[workPackageId]`) fetches contractors (now incl. `status`) and passes a filtered list to `WpAssignmentPanel`: drop `status === "blacklisted"`, **except keep the WP's current owner** (an already-assigned, now-blacklisted contractor still lists — never blank an existing assignment). The header's `assignedContractor` lookup uses the full list. The panel is unchanged (it renders what it's given).

2. **DC-parent picker** — `/workers` fetches contractors with `status` + `contractor_category`. `WorkerRosterManager` filters the new-DC-worker dropdown to `contractor_category === "dc" && status !== "blacklisted"` (a DC worker is parented by a non-blacklisted DC crew), while the **full** list still resolves names for existing rows (a worker whose parent is blacklisted/non-DC still shows its name).

## Not touched

Payroll (`fetch-payroll`) and any history read are **unfiltered** — blacklisting is forward-looking only; immutable snapshots and past assignments stay intact.

## Tests / verification

`worker-roster-manager.test.tsx` +1 (DC picker shows only non-blacklisted DC crews). WP-page filtering is server logic (manual/acceptance). `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No DB change.
