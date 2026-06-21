# Spec 174 — Project Google-Maps link (precise pin)

**Operator request (2026-06-22):** "Add Pinned map, or attach link from gMap."
Chosen (one question): **attach a link from gMap** — paste the Google-Maps "Share"
URL on the project; the ⓘ info sheet's "open in Maps" link then opens the EXACT
pin, replacing the spec-173 address-search fallback. (An embedded/pinned map needs
a Google Maps API key + captured coordinates — declined for now; the pasted link
is zero-setup and opens the native Maps app to the precise pin.)

## Design

`projects.gmap_url` (nullable text). Edited on project settings (PM-tier, where
`site_address` is edited); read by everyone who reads the project (incl.
procurement, spec 173). The ⓘ sheet's map link prefers `gmap_url` (exact pin) and
falls back to the spec-173 address-search URL when unset.

- **Migration 20260798:** add `gmap_url` + a CHECK (`https://`-only, a DB backstop);
  DROP+CREATE `update_project_settings` with a trailing `p_gmap_url` param (mirrors
  `p_site_address`: null preserves, `''` clears), re-applying the EXECUTE grants the
  DROP reset.
- **Migration 20260799:** grant SELECT on the new column — `projects` carries
  COLUMN-level SELECT grants (budget excluded for money isolation), so the column
  did NOT inherit SELECT; granted to authenticated + anon (mirrors `site_address`).
- **Migration 20260800:** revoke `anon` EXECUTE on the recreated RPC — Supabase's
  default privileges auto-grant EXECUTE on new functions to anon, which the
  DROP+CREATE silently restored; the pre-174 RPC had anon revoked (pgTAP 32 pins it).
- **Validator** `validateGmapUrl` (`validate-settings.ts`): empty → null; else must
  parse as an `https:` URL on a Google host (exact `google.com` / `goo.gl` /
  `maps.app.goo.gl`, or suffix `.google.com` / `.google.co.th` / `.goo.gl`).
  Rejects `javascript:`, non-https, and look-alike domains (`google.com.evil.com`).
  Cap 2048. Rendered as an `<a href target=_blank>`, so the host lock matters.
- **Settings:** `gmapUrl` joins the single `updateProjectSettings` payload; the form
  gets a URL input ("ลิงก์ Google Maps", paste-the-share-link hint).
- **Display:** the project detail page computes
  `mapsUrl = project.gmap_url ?? <address-search URL> ?? null` and passes it to the
  existing ⓘ `ProjectInfoButton` link (no component change — spec 173 already took
  `mapsUrl`).

## Tests

- pgTAP (file 32, +3): PM sets `gmap_url` via the RPC and it lands; a non-https
  value is rejected by the column CHECK (23514); the privilege pin updated to the
  11-arg signature (authenticated EXECUTE, anon not).
- Unit: `validateGmapUrl` (valid share/place links; rejects non-Google / non-https /
  look-alike / `javascript:` / over-length). `settings-form` seeds + submits the link.

## Out of scope

- Embedded / static pinned map + geo coordinates (no geo columns; needs an API key).
- Reverse-deriving coordinates from the pasted URL.
- A map on any non-project screen.
