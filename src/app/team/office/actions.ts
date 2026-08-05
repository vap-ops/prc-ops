"use server";

// Spec 397 U5 — the office team's form entry points.
//
// Thin wrappers over the muster actions (which own validation and the Thai error
// mapping) so the page can stay a zero-client-JS Server Component: POST form →
// action → redirect back with an outcome CODE, the same shape /team/attendance
// uses. Nothing to hydrate, which also means it works on the in-app browser where
// hydration does not run.
//
// ⚠️ CODES, never sentences. The first cut of this file put the mapped Thai
// message in the URL and the page rendered it verbatim inside its own
// <ErrorNotice> — unbounded, forgeable, and rendered in the app's red danger box
// on an authenticated page. That is in-app spoofing, and it is precisely what
// spec 397 U3's `reopen-return.ts` was written to avoid; this file repeated it
// while its own comment claimed otherwise. The page owns every string.

import "server-only";

import { redirect } from "next/navigation";

import { bangkokTodayIso } from "@/lib/dates";
import { musterScan, openMusterTeam, undoMusterScan } from "@/lib/muster/actions";

const HERE = "/team/office";

export type OfficeOutcome =
  | "opened"
  | "added"
  | "out"
  | "removed"
  /** The caller's role may not do this (a permanent refusal). */
  | "denied"
  /** The worker is already mustered somewhere today — the scan RPC refuses. */
  | "alreadyin"
  /** Anything else the database refused. */
  | "failed";

function back(outcome: OfficeOutcome): never {
  redirect(`${HERE}?o=${outcome}`);
}

/**
 * The muster actions return Thai (they serve the cockpit, which renders it
 * directly). This surface needs a code, so classify on the few distinctions that
 * change what the reader should DO — and fall back to `failed` rather than
 * guessing, so a reworded message degrades to a generic instead of a wrong claim.
 */
function classify(error: string): OfficeOutcome {
  if (error.includes("ไม่มีสิทธิ์")) return "denied";
  if (error.includes("ทีมสำนักงาน") || error.includes("ทีมอื่น") || error.includes("ทีมของ")) {
    return "alreadyin";
  }
  return "failed";
}

export async function openOfficeTeam(formData: FormData): Promise<void> {
  const r = await openMusterTeam({
    projectId: String(formData.get("projectId") ?? ""),
    date: bangkokTodayIso(),
    // Leadless on purpose: the spec's lead is the `site_owner` and there are none
    // yet, so requiring one would make the team unopenable (U4's CHECK permits it
    // for this kind only).
    leadWorkerId: null,
    kind: "office",
    revalidate: HERE,
  });
  back(r.ok ? "opened" : classify(r.error));
}

export async function addOfficeMember(formData: FormData): Promise<void> {
  const r = await musterScan({
    teamId: String(formData.get("teamId") ?? ""),
    workerId: String(formData.get("workerId") ?? ""),
    mode: "in",
    // `manual` is the truth: nobody scanned a badge here. The audit report shows
    // the method, so claiming `qr` would put a lie in the record.
    method: "manual",
    session: "regular",
    revalidate: HERE,
  });
  back(r.ok ? "added" : classify(r.error));
}

export async function checkOutOfficeMember(formData: FormData): Promise<void> {
  const r = await musterScan({
    teamId: String(formData.get("teamId") ?? ""),
    workerId: String(formData.get("workerId") ?? ""),
    mode: "out",
    method: "manual",
    session: "regular",
    revalidate: HERE,
  });
  back(r.ok ? "out" : classify(r.error));
}

/**
 * Remove a row added by mistake — the ESCAPE HATCH, and it is not optional.
 *
 * The picker lists people, and a mis-tap is not a cosmetic error: a ช่าง added
 * here has their real crew check-in refused for the rest of the day
 * (`muster_scan_in` allows one team per worker per day), and if the day is then
 * closed, `derive_muster_labor` books NOTHING for them, because the office team
 * binds no work package — they silently lose the day's wage. Checking them out
 * only stamps `out_at`; it does not undo the mistake. The cockpit's undo cannot
 * reach these rows either, since its board excludes office teams (U4).
 */
export async function removeOfficeMember(formData: FormData): Promise<void> {
  const r = await undoMusterScan({
    workerId: String(formData.get("workerId") ?? ""),
    date: bangkokTodayIso(),
    session: "regular",
    revalidate: HERE,
  });
  back(r.ok ? "removed" : classify(r.error));
}
