"use server";

// WP assignment actions (spec 28 Part A / ADR 0032). Authorization is
// the DB's: owner_id flows through the existing PM/super work_packages
// UPDATE policy (0 rows for anyone else); members INSERT/DELETE have
// their own PM/super policies with added_by pinned to auth.uid().
// The actions only validate shape and relay.

import "server-only";

import { revalidatePath } from "next/cache";
import { createClient as createServerSupabase } from "@/lib/db/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AssignmentResult = { ok: true } | { ok: false; error: string };

function wpPath(projectId: string, workPackageId: string): string {
  return `/sa/projects/${projectId}/work-packages/${workPackageId}`;
}

export async function setWorkPackageOwner(input: {
  projectId: string;
  workPackageId: string;
  ownerId: string | null;
}): Promise<AssignmentResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    (input.ownerId !== null && !UUID_REGEX.test(input.ownerId))
  ) {
    return { ok: false, error: "บันทึกผู้รับผิดชอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("work_packages")
    .update({ owner_id: input.ownerId })
    .eq("id", input.workPackageId)
    .select("id");
  if (error || !data || data.length === 0) {
    return { ok: false, error: "บันทึกผู้รับผิดชอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(wpPath(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function addWorkPackageMember(input: {
  projectId: string;
  workPackageId: string;
  userId: string;
}): Promise<AssignmentResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.userId)
  ) {
    return { ok: false, error: "เพิ่มสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { error } = await supabase.from("work_package_members").insert({
    work_package_id: input.workPackageId,
    user_id: input.userId,
    added_by: user.id,
  });
  if (error) {
    // 23505 = already a member — surface as success-shaped no-op copy.
    if (error.code === "23505") {
      return { ok: false, error: "เป็นสมาชิกอยู่แล้ว" };
    }
    return { ok: false, error: "เพิ่มสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(wpPath(input.projectId, input.workPackageId));
  return { ok: true };
}

export async function removeWorkPackageMember(input: {
  projectId: string;
  workPackageId: string;
  userId: string;
}): Promise<AssignmentResult> {
  if (
    !UUID_REGEX.test(input.workPackageId) ||
    !UUID_REGEX.test(input.projectId) ||
    !UUID_REGEX.test(input.userId)
  ) {
    return { ok: false, error: "ลบสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { error } = await supabase
    .from("work_package_members")
    .delete()
    .eq("work_package_id", input.workPackageId)
    .eq("user_id", input.userId);
  if (error) {
    return { ok: false, error: "ลบสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidatePath(wpPath(input.projectId, input.workPackageId));
  return { ok: true };
}
