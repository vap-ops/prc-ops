"use client";

// Spec 193 — the in-app feedback form (bug report / feature request). 'use client':
// the type toggle, the type-aware guidance, the submit + thank-you state. The form
// asks for the minimum a person will actually fill (type, title, a guided details
// box, an optional screen); the high-value context CC needs — role, app version,
// device — is auto-attached by the server action, so the user never types it.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bug, Lightbulb } from "lucide-react";
import { submitFeedback } from "@/app/feedback/actions";
import { validateFeedback, type FeedbackType } from "@/lib/feedback/validate";
import { useToast } from "@/lib/ui/use-toast";
import { BUTTON_PRIMARY, CARD, FIELD_STACKED, INLINE_ALERT_TEXT } from "@/lib/ui/classes";

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
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className={`${CARD} border-done bg-done-soft border-l-4`}>
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

      <p className="text-ink-muted text-xs">
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
