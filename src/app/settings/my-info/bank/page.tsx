// Spec 321 U8a — the login-keyed bank edit is now INSTANT and inline on
// /settings/my-info (ProfileBankSection: read card + edit-in-sheet), so this
// standalone approval-submit route is retired. Redirect anyone who lands here
// (a bookmark or an old link) to the my-info page — leaving it live would let a
// user stage a NEW approval request nobody drains (the exact bug U8a fixes). The
// full route + UserBankChangeForm removal + queue-kind cleanup lands with U8b.
import { redirect } from "next/navigation";

export default function MyInfoBankPage() {
  redirect("/settings/my-info");
}
