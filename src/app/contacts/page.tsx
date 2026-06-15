// Spec 99 — Contacts was split into three group screens (customers / vendors /
// crews). Bare /contacts now redirects to the first group so old links + the
// bottom-bar /contacts match keep resolving.

import { redirect } from "next/navigation";

export default function ContactsPage() {
  redirect("/contacts/customers");
}
