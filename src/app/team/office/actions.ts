"use server";

// Spec 397 U5 — the office team's three form entry points.
//
// Thin wrappers over the muster actions (which own validation and the Thai error
// mapping) so the page can stay a zero-client-JS Server Component: POST form →
// action → redirect back with the outcome, the same shape /team/attendance uses.
// Nothing to hydrate, which also means it works on the in-app browser where
// hydration does not run.

import "server-only";

import { redirect } from "next/navigation";

import { bangkokTodayIso } from "@/lib/dates";
import { musterScan, openMusterTeam } from "@/lib/muster/actions";

const HERE = "/team/office";

/** Outcome codes, never a sentence — the page owns the copy (spec 397 U3's rule). */
export type OfficeOutcome = "opened" | "added" | "out" | "failed";

function back(outcome: OfficeOutcome, detail?: string): never {
  const q = new URLSearchParams({ o: outcome });
  if (detail) q.set("m", detail);
  redirect(`${HERE}?${q.toString()}`);
}

export async function openOfficeTeam(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const r = await openMusterTeam({
    projectId,
    date: bangkokTodayIso(),
    // Leadless on purpose: the spec's lead is the `site_owner` and there are none
    // yet, so requiring one would make the team unopenable (U4's CHECK permits it
    // for this kind only).
    leadWorkerId: null,
    kind: "office",
    revalidate: HERE,
  });
  back(r.ok ? "opened" : "failed", r.ok ? undefined : r.error);
}

export async function addOfficeMember(formData: FormData): Promise<void> {
  const teamId = String(formData.get("teamId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const r = await musterScan({
    teamId,
    workerId,
    mode: "in",
    // `manual` is the truth: nobody scanned a badge here. The audit report shows
    // the method, so claiming `qr` would put a lie in the record.
    method: "manual",
    session: "regular",
    revalidate: HERE,
  });
  back(r.ok ? "added" : "failed", r.ok ? undefined : r.error);
}

export async function checkOutOfficeMember(formData: FormData): Promise<void> {
  const teamId = String(formData.get("teamId") ?? "");
  const workerId = String(formData.get("workerId") ?? "");
  const r = await musterScan({
    teamId,
    workerId,
    mode: "out",
    method: "manual",
    session: "regular",
    revalidate: HERE,
  });
  back(r.ok ? "out" : "failed", r.ok ? undefined : r.error);
}
