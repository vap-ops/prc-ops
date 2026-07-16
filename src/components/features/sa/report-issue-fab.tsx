"use client";

// Spec 277 P1a — the red แจ้งปัญหา FAB + report sheet on the SA home. Stacks
// directly ABOVE the neutral ถ่ายรูป CameraFab (both fixed bottom-right) so the two
// read as an action pair, not a collision — and a floating entry is needed because
// the ปัญหาวันนี้ section is conditional (nothing to tap when the day has no issues).
//
// Two-phase submit (like the feedback flow): reportSiteIssue creates the issue, then
// each photo uploads to the private `site-issues` bucket under issue/{issueId}/… and
// is recorded via addSiteIssueAttachment. Photos go through the shared
// preparePhotoForUpload pipeline (spec 34 downscale + mime-normalized blob type).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, TriangleAlert } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { createClient } from "@/lib/db/browser";
import { preparePhotoForUpload } from "@/lib/photos/downscale";
import { photoExtToMime } from "@/lib/photos/path";
import { SITE_ISSUES_BUCKET } from "@/lib/storage/buckets";
import {
  SITE_ISSUE_TYPES,
  SITE_ISSUE_TYPE_ICON,
  type SiteIssueType,
} from "@/lib/site-issues/identity";
import {
  SITE_ISSUE_TYPE_LABEL,
  REPORT_ISSUE_LABEL,
  ISSUE_NOTE_PLACEHOLDER,
  ISSUE_ADD_PHOTO_LABEL,
  ISSUE_SUBMIT_LABEL,
} from "@/lib/i18n/labels";
import { reportSiteIssue, addSiteIssueAttachment } from "@/app/sa/report-issue-actions";

// Same corner + size as CameraFab (bottom-24), lifted one FAB-height up (bottom-40),
// in the danger palette so "problem" reads distinct from the amber camera.
const FAB_CLASS =
  "fixed bottom-40 right-5 z-30 flex size-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-danger text-on-fill shadow-card transition-colors hover:bg-danger-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 active:translate-y-px";

export function ReportIssueFab({ projectId }: { projectId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SiteIssueType | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to file against (SA with no visible project) → no entry point.
  if (!projectId) return null;

  function close() {
    setOpen(false);
    setType(null);
    setNote("");
    setFiles([]);
    setError(null);
  }

  async function handleSubmit() {
    if (!type || submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await reportSiteIssue({ projectId: projectId!, issueType: type, note });
    if (!res.ok) {
      setError(res.error);
      setSubmitting(false);
      return;
    }

    // Photos are best-effort: the issue is already filed. Prepare each through the
    // shared pipeline (spec 34 downscale + mime-validate + normalize the blob type
    // so the upload sends a real image mime — feedback 10a15ebe: an empty blob type
    // on iOS Safari would ride as application/octet-stream and the bucket's
    // allowed_mime_types would reject it), then upload + record the row.
    if (files.length > 0) {
      const supabase = createClient();
      for (const file of files) {
        const prepared = await preparePhotoForUpload(file);
        if (!prepared) {
          setError("ไฟล์รูปบางส่วนไม่รองรับ (ใช้ JPEG, PNG, WebP หรือ HEIC)");
          continue;
        }
        const storagePath = `issue/${res.issueId}/${crypto.randomUUID()}.${prepared.ext}`;
        const { error: upErr } = await supabase.storage
          .from(SITE_ISSUES_BUCKET)
          .upload(storagePath, prepared.blob, {
            contentType: photoExtToMime(prepared.ext),
            upsert: false,
          });
        if (upErr) {
          setError("อัปโหลดรูปบางส่วนไม่สำเร็จ");
          continue;
        }
        const attachRes = await addSiteIssueAttachment({ siteIssueId: res.issueId, storagePath });
        if (!attachRes.ok) setError(attachRes.error);
      }
    }

    setSubmitting(false);
    close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        aria-label={REPORT_ISSUE_LABEL}
        onClick={() => setOpen(true)}
        className={FAB_CLASS}
      >
        <TriangleAlert aria-hidden className="size-6 shrink-0" />
        <span className="text-[0.5rem] font-extrabold">{REPORT_ISSUE_LABEL}</span>
      </button>

      <BottomSheet open={open} title={REPORT_ISSUE_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {SITE_ISSUE_TYPES.map((t) => {
              const Icon = SITE_ISSUE_TYPE_ICON[t];
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setType(t)}
                  className={`rounded-control focus-visible:ring-action flex items-center gap-2 border px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 ${
                    active
                      ? "border-danger bg-danger-soft text-danger-ink font-semibold"
                      : "border-edge bg-card text-ink hover:bg-sunk"
                  }`}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{SITE_ISSUE_TYPE_LABEL[t]}</span>
                </button>
              );
            })}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={ISSUE_NOTE_PLACEHOLDER}
            className="rounded-control border-edge bg-card text-ink placeholder:text-ink-muted focus-visible:ring-action w-full border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2"
          />

          <label className="rounded-control border-edge bg-page text-ink-secondary hover:bg-sunk focus-within:ring-action flex h-11 cursor-pointer items-center justify-center gap-2 border text-sm font-medium focus-within:ring-2">
            <Camera aria-hidden className="size-4 shrink-0" />
            {ISSUE_ADD_PHOTO_LABEL}
            {files.length > 0 ? ` (${files.length})` : ""}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>

          {error ? <p className="text-danger text-sm font-medium">{error}</p> : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!type || submitting}
            className="bg-danger text-on-fill hover:bg-danger-strong focus-visible:ring-danger rounded-md px-4 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "กำลังส่ง…" : ISSUE_SUBMIT_LABEL}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
