// Spec 197 U1 — the store (คลัง) moved out of this global route into a
// per-project sub-route (/projects/[id]/store), reached from each project's
// header chip. This legacy top-level path is kept as a thin redirect to the
// projects hub so muscle-memory / old links resolve instead of 404ing; the
// store is now always entered through a project.

import { redirect } from "next/navigation";

export default function StorePage() {
  redirect("/projects");
}
