// Spec 313 U1: moved with its parent to /team/badges. Thin redirect kept
// ≥1 release so muscle memory + old links keep working.
import { redirect } from "next/navigation";

export default function SaCrewBadgesRedirect() {
  redirect("/team/badges");
}
