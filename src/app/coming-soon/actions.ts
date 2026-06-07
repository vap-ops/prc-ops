"use server";

// Server action for the /coming-soon display-name self-edit panel.
// Feature spec 05 / ADR 0017.
//
// The privileged write happens inside the public.update_my_display_name
// SECURITY DEFINER RPC. This action is the thin glue around it: it
// resolves the caller's session, validates the input UX-side, and
// calls the RPC on the **session (anon-key) client** — NOT the admin
// client. The RPC's own SECURITY DEFINER is what grants write access;
// the caller's session supplies auth.uid().

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/db/server";
import { validateDisplayName } from "@/lib/profile/validate-display-name";

export type UpdateDisplayNameResult = { ok: true; value: string } | { ok: false; error: string };

export async function updateDisplayName(input: string): Promise<UpdateDisplayNameResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const result = validateDisplayName(input);
  if (!result.ok) {
    return result;
  }

  const { error } = await supabase.rpc("update_my_display_name", {
    p_full_name: result.value,
  });
  if (error) {
    console.error("[updateDisplayName] rpc failed", {
      userId: user.id,
      code: error.code,
      message: error.message,
    });
    return { ok: false, error: "Couldn't save. Please try again." };
  }

  revalidatePath("/coming-soon");
  return { ok: true, value: result.value };
}
