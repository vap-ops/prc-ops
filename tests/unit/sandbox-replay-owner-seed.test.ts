// Writing failing test first.
//
// Sandbox Sync (spec 294) replays committed migrations against the sandbox
// mirror — a DB whose tables can be EMPTY where prod's are populated. Migration
// 20260813075881 derives the PRI seed's created_by from an existing
// equipment_owners row; on any DB with zero owner rows that derivation used to
// raise P0001, which aborted `db push` mid-chain and turned every later
// migration unappliable (observed: every Sandbox Sync run red from 2026-07-30
// 20:43 to 2026-07-31). Prod is ledger-protected from edits to this file, so
// these pins guard the REPLAY contract only: the derivation must keep a
// fallback chain that ends in skip-with-notice, never in an exception.
//
// If you are about to remove the fallback because "prod always has rows":
// prod is not the audience — the sandbox mirror, full_reset, and every
// schema-only preview branch replay this file against an empty database.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION = "supabase/migrations/20260813075881_equipment_owner_pri_default.sql";

describe("20260813075881 — PRI owner seed must survive an empty-database replay", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("keeps the prod path: created_by inherited from the oldest owner row", () => {
    expect(sql).toContain("select created_by into v_creator from public.equipment_owners");
  });

  it("falls back to the oldest users row when no owner rows exist", () => {
    expect(sql).toContain("select id into v_creator from public.users");
  });

  it("skips the seed with a notice AND a return when no users exist either", () => {
    // The pair is the guard: a notice without the return falls through into an
    // insert whose created_by is null (23502) and the wedge is back. Anchored
    // to `raise notice` so a comment quoting the phrase cannot satisfy it.
    expect(sql).toMatch(/raise notice[^;]*skipping PRI seed[^;]*;\s*return;/);
  });

  it("the empty-table wedge is gone: this file raises no exception at all", () => {
    // Bare needle on purpose (not quote-wrapped): any resurrected raise with
    // this message must fail, whatever the surrounding quoting.
    expect(sql).not.toContain("no existing equipment_owners row");
    // Absolute: an applied, ledger-frozen seed migration that raises on data
    // state is a replay landmine whatever the message says. Keep comments in
    // the migration free of the phrase — documenting the hazard re-arms this.
    expect(sql).not.toMatch(/raise\s+exception/i);
  });
});
