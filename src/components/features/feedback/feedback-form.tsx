"use client";

// Spec 193 — the in-app feedback form (bug report / feature request). 'use client':
// the type toggle, the type-aware guidance, the submit + thank-you state. The form
// asks for the minimum a person will actually fill (type, title, a guided details
// box, an optional screen); the high-value context CC needs — role, app version,
// device — is auto-attached by the server action, so the user never types it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, Lightbulb, ImagePlus, X } from "lucide-react";
import { submitFeedback } from "@/app/feedback/actions";
import { validateFeedback, type FeedbackType } from "@/lib/feedback/validate";
import { createClient as createBrowserClient } from "@/lib/db/browser";
import { useFormAbandon } from "@/lib/telemetry/use-form-abandon";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD_LAYOUT, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

// Spec 193 U2 — screenshots. Images only (a report is visual); the bucket caps
// these mimes. Upload is best-effort and post-submit: a failed image never blocks
// the (already-saved) text report.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};
const MAX_ATTACHMENTS = 4;

async function uploadAttachments(feedbackId: string, files: File[]): Promise<void> {
  const supabase = createBrowserClient();
  for (const file of files) {
    const ext = MIME_EXT[file.type];
    if (!ext) continue;
    const path = `feedback/${feedbackId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("feedback-attachments")
      .upload(path, file, { contentType: file.type });
    if (error) continue;
    await supabase.rpc("add_feedback_attachment", {
      p_feedback_id: feedbackId,
      p_storage_path: path,
    });
  }
}

const TYPES: ReadonlyArray<{ value: FeedbackType; label: string; icon: typeof Bug }> = [
  { value: "bug", label: "แจ้งปัญหา", icon: Bug },
  { value: "feature", label: "ขอฟีเจอร์", icon: Lightbulb },
];

const BODY_PLACEHOLDER: Record<FeedbackType, string> = {
  bug: "เล่าให้ละเอียด: คุณกำลังทำอะไรอยู่ → คาดว่าจะเกิดอะไรขึ้น → แต่จริง ๆ เกิดอะไรขึ้น",
  feature: "อยากให้ระบบทำอะไรได้ และช่วยแก้ปัญหาอะไร / ทำไมถึงอยากได้",
};

export function FeedbackForm() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [screen, setScreen] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Spec 244 U2b-3 — report form_abandon if the user starts a report then leaves
  // without submitting (a lost user voice = high-value friction).
  const abandon = useFormAbandon("feedback");

  if (done) {
    return (
      <div className={`${CARD_LAYOUT} border-done bg-done-soft border-l-4`}>
        <p className="text-done-ink text-sm font-semibold">ขอบคุณสำหรับความคิดเห็น 🙏</p>
        <p className="text-ink-secondary mt-1 text-sm">
          ทีมงานได้รับเรื่องของคุณแล้ว และจะนำไปปรับปรุง
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setTitle("");
            setBody("");
            setScreen("");
            setFiles([]);
            setError(null);
          }}
          className="text-action mt-3 text-sm font-medium underline-offset-2 hover:underline"
        >
          ส่งอีกเรื่อง
        </button>
      </div>
    );
  }

  function submit() {
    setError(null);
    const v = validateFeedback({ type, title, body, screen });
    if (v) {
      setError(v);
      return;
    }
    startTransition(async () => {
      const result = await submitFeedback({
        type,
        title,
        body,
        screen,
        pagePath: typeof document !== "undefined" ? document.referrer : "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The report is saved — this is a completed form, not an abandon.
      abandon.markSubmitted();
      // Best-effort: a failed image upload never blocks the saved text report.
      if (files.length > 0) await uploadAttachments(result.id, files);
      toast.success("ส่งแล้ว ขอบคุณ");
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="ประเภท"
        className="border-edge bg-card rounded-control flex gap-1 border p-1"
      >
        {TYPES.map((t) => {
          const active = t.value === type;
          const Icon = t.icon;
          return (
            <button
              key={t.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setType(t.value);
                setError(null);
              }}
              className={`rounded-control flex h-11 flex-1 items-center justify-center gap-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-fill text-on-fill"
                  : "text-ink-secondary hover:bg-sunk focus-visible:ring-action focus:outline-none focus-visible:ring-2"
              }`}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {t.label}
            </button>
          );
        })}
      </div>

      <label className="text-ink-secondary block text-sm font-medium">
        หัวข้อ
        <input
          value={title}
          maxLength={200}
          disabled={pending}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
            abandon.markDirty();
          }}
          placeholder={type === "bug" ? "สรุปปัญหาสั้น ๆ" : "สรุปสิ่งที่อยากได้สั้น ๆ"}
          className={FIELD_STACKED}
        />
      </label>

      <label className="text-ink-secondary block text-sm font-medium">
        รายละเอียด
        <textarea
          value={body}
          maxLength={4000}
          rows={5}
          disabled={pending}
          onChange={(e) => {
            setBody(e.target.value);
            setError(null);
            abandon.markDirty();
          }}
          placeholder={BODY_PLACEHOLDER[type]}
          className={`${FIELD_STACKED} resize-y`}
        />
      </label>

      <label className="text-ink-secondary block text-sm font-medium">
        หน้าจอหรือเมนูที่เกี่ยวข้อง (ถ้ามี)
        <input
          value={screen}
          maxLength={200}
          disabled={pending}
          onChange={(e) => setScreen(e.target.value)}
          placeholder="เช่น หน้ารายการงาน, ตั้งค่าโครงการ"
          className={FIELD_STACKED}
        />
      </label>

      {/* Spec 193 U2 — screenshots make a bug report actionable. Images only. */}
      <div className="flex flex-col gap-2">
        <span className="text-ink-secondary text-sm font-medium">แนบรูป (ถ้ามี)</span>
        {files.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt={`รูปแนบ ${i + 1}`}
                  className="rounded-control border-edge size-16 border object-cover"
                />
                {/* G12/F-010 sweep: the tap target is a transparent 44px circle
                    centred on the 20px badge, NOT a 44px badge — a blind
                    min-h-11 here would swallow most of a 64px thumbnail. The
                    -18px offsets keep the visible dot exactly where it was
                    (badge centre sits 4px in from the corner: 4 − 44/2 = −18).
                    Adjacent remove buttons sit 72px apart (64px thumb + gap-2),
                    so the slop circles never overlap each other; what they
                    overlap is neighbouring image, which is not interactive. */}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}
                  aria-label={`ลบรูปแนบ ${i + 1}`}
                  className="absolute -top-[18px] -right-[18px] inline-flex size-11 items-center justify-center rounded-full"
                >
                  <span className="bg-fill text-on-fill inline-flex size-5 items-center justify-center rounded-full">
                    <X aria-hidden className="size-3" />
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {files.length < MAX_ATTACHMENTS ? (
          <label className="border-edge-strong text-ink-secondary hover:bg-sunk focus-within:ring-action rounded-control inline-flex h-11 w-fit cursor-pointer items-center gap-2 border border-dashed px-4 text-sm font-medium focus-within:ring-2">
            <ImagePlus aria-hidden className="size-4" />
            เพิ่มรูป
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              multiple
              disabled={pending}
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((fs) => [...fs, ...picked].slice(0, MAX_ATTACHMENTS));
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>

      <p className="text-ink-secondary text-xs">
        ระบบจะแนบบทบาท เวอร์ชันแอป และอุปกรณ์ของคุณให้อัตโนมัติ เพื่อให้ทีมแก้ไขได้เร็วขึ้น
      </p>

      {error ? (
        <p role="alert" className={INLINE_ALERT_TEXT}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className={`w-full ${BUTTON_PRIMARY}`}
      >
        {pending ? "กำลังส่ง…" : "ส่ง"}
      </button>
    </div>
  );
}
