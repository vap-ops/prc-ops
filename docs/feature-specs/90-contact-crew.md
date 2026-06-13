# Spec 90 — Contacts v2 Unit 8: crew on a contractor's detail page

Contacts v2. Code-only. The operator's "teammates under that subcon": on a contractor/DC contact's detail page, show the DC workers parented by it and let PM add one.

## ContactCrewSection (client)

On `/contacts/contractors/[id]`: lists the crew (names only) + an add form (name + day rate). Add reuses `createWorker({ name, workerType: "dc", dayRate, contractorId })` — the worker roster's existing RPC-backed action; a **day rate is required** at creation (the RPC needs it). Rates are **never displayed** here (money stays on `/workers`); the add form only collects a rate to onboard the worker. toast + `router.refresh()` on success.

The detail page (server, PM-gated) fetches the crew (`workers` where `contractor_id = id AND worker_type = 'dc'`, user session, id + name only — no money column) and renders the section only for the `contractors` route (clients/suppliers/service providers have no crew).

## Tests / verification

`contact-crew-section.test.tsx` (RED first): lists existing crew; add calls `createWorker` with `{workerType:"dc", contractorId, dayRate}`. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No DB change (reuses spec-46 workers + create_worker). Acceptance = operator phone. **Seam:** removing/re-parenting a crew member from the contact screen (today: deactivate on /workers).
