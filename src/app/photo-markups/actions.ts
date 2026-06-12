"use server";

// Photo-markup server actions (spec 51). Markup is overlay data on a
// photo_logs row — the Storage object is never touched. The table is
// append-only with tombstone removal (ADR 0004/0009/0015); RLS owns
// role gating, the creator pin, and creator-only removal — these
// actions only validate shape and relay under the session client.

import "server-only";

import { createClient as createServerSupabase } from "@/lib/db/server";
import type { Json } from "@/lib/db/database.types";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { validatePhotoMarkup, type MarkupStroke } from "@/lib/photos/validate-markup";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PhotoMarkupRow {
  id: string;
  strokes: MarkupStroke[] | null;
  comment: string | null;
  createdByName: string;
  createdAt: string;
  isMine: boolean;
}

export type ListPhotoMarkupsResult =
  | { ok: true; markups: PhotoMarkupRow[] }
  | { ok: false; error: string };

export async function listPhotoMarkups(input: {
  photoLogId: string;
}): Promise<ListPhotoMarkupsResult> {
  if (!UUID_REGEX.test(input.photoLogId)) {
    return { ok: false, error: "โหลดความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { data, error } = await supabase
    .from("photo_markups_current")
    .select("id, strokes, comment, created_by, created_at")
    .eq("photo_log_id", input.photoLogId)
    .order("created_at", { ascending: true });
  if (error || !data) {
    return { ok: false, error: "โหลดความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const names = await fetchDisplayNames(
    Array.from(
      new Set(data.map((m) => m.created_by).filter((id): id is string => typeof id === "string")),
    ),
    "[photo-markups]",
  );

  return {
    ok: true,
    markups: data.flatMap((m) => {
      if (!m.id || !m.created_at) return [];
      return [
        {
          id: m.id,
          // The DB CHECK guarantees strokes is a JSON array on content
          // rows; the cast narrows the generated Json type.
          strokes: (m.strokes as unknown as MarkupStroke[] | null) ?? null,
          comment: m.comment ?? null,
          createdByName: (m.created_by ? names.get(m.created_by) : null) ?? "—",
          createdAt: m.created_at,
          isMine: m.created_by === user.id,
        },
      ];
    }),
  };
}

export type MarkupActionResult = { ok: true } | { ok: false; error: string };

export async function addPhotoMarkup(input: {
  photoLogId: string;
  strokes: ReadonlyArray<MarkupStroke> | null;
  comment: string | null;
}): Promise<MarkupActionResult> {
  if (!UUID_REGEX.test(input.photoLogId)) {
    return { ok: false, error: "บันทึกความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  const validated = validatePhotoMarkup({ strokes: input.strokes, comment: input.comment });
  if (!validated.ok) return validated;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  const { error } = await supabase.from("photo_markups").insert({
    photo_log_id: input.photoLogId,
    // The validator guarantees a plain JSON-serializable shape; the
    // generated Json type just can't see through the interface.
    strokes: validated.value.strokes as unknown as Json,
    comment: validated.value.comment,
    created_by: user.id,
  });
  if (error) {
    return { ok: false, error: "บันทึกความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true };
}

export async function removePhotoMarkup(input: { markupId: string }): Promise<MarkupActionResult> {
  if (!UUID_REGEX.test(input.markupId)) {
    return { ok: false, error: "ลบความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" };

  // Read the target under caller RLS to mirror its parent into the
  // tombstone (the composite FK requires same parent); creator-only is
  // enforced by the INSERT policy, not here.
  const { data: target } = await supabase
    .from("photo_markups")
    .select("id, photo_log_id")
    .eq("id", input.markupId)
    .maybeSingle();
  if (!target) {
    return { ok: false, error: "ลบความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const { error } = await supabase.from("photo_markups").insert({
    photo_log_id: target.photo_log_id,
    superseded_by: target.id,
    created_by: user.id,
  });
  if (error) {
    return { ok: false, error: "ลบความเห็นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
  return { ok: true };
}
