// Spec 313 U1: the crew surface moved to the /team hub. Thin redirect kept
// ≥1 release so muscle memory + old links keep working.
import { redirect } from "next/navigation";

export default function SaCrewRedirect() {
  redirect("/team");
}
