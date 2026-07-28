"use client";

// Spec 363 U7 / 368 U4 — the shared คืนเครื่องมือ sheet + condition-photo
// capture strip. One component, two doors (the WP ของ tab passes via="wp_tab",
// the store section via="store") — same RPC, same evidence contract, so the
// two surfaces cannot drift. Before-photos are minted ON OPEN (page-render
// signed URLs die in 120s), the strip is epoch-guarded (a stale upload
// resolution can never re-arm a submit with another loan's evidence), and the
// submit is ref-guarded against same-frame double-taps.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  checkInEquipment,
  fetchLoanPhotoUrls,
  type EquipmentUsageVia,
} from "@/lib/equipment/usage-actions";
import { uploadConditionPhotos } from "@/lib/equipment/photo-upload";
import { bangkokTodayIso } from "@/lib/dates";

export interface ReturnableLoan {
  logId: string;
  itemName: string;
  holderName: string;
  days: number;
}

export function agingLabel(days: number): string {
  return days <= 0 ? "ยืมวันนี้" : `ยืม ${days} วัน`;
}

interface StripPhoto {
  path: string;
  previewUrl: string;
}

export function usePhotoStrip() {
  const [photos, setPhotos] = useState<readonly StripPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epochRef = useRef(0);
  const pick = async (files: File[]) => {
    const epoch = epochRef.current;
    setBusy(true);
    setError(null);
    const previews = files.map((f) => URL.createObjectURL(f));
    const res = await uploadConditionPhotos(files);
    if (epochRef.current !== epoch) {
      previews.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    setBusy(false);
    if (res.ok) {
      setPhotos((prev) => [
        ...prev,
        ...res.paths.map((path, i) => ({ path, previewUrl: previews[i] ?? "" })),
      ]);
    } else {
      previews.forEach((u) => URL.revokeObjectURL(u));
      setError(res.error);
    }
  };
  const reset = () => {
    epochRef.current += 1;
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setBusy(false);
    setError(null);
  };
  return { photos, busy, error, pick, reset };
}

export function PhotoCaptureStrip({
  label,
  strip,
}: {
  label: string;
  strip: ReturnType<typeof usePhotoStrip>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`strip-${label}`} className="text-ink-secondary text-meta">
        {label} (อย่างน้อย 1 รูป)
      </label>
      <input
        id={`strip-${label}`}
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void strip.pick(files);
          e.target.value = "";
        }}
      />
      <div className="flex [touch-action:pan-x_pinch-zoom] items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={strip.busy}
          aria-busy={strip.busy}
          className="border-edge-strong rounded-control text-ink flex h-16 w-16 shrink-0 items-center justify-center border border-dashed text-2xl"
          aria-label={`เปิดกล้อง — ${label}`}
        >
          {strip.busy ? "…" : "+"}
        </button>
        {strip.photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.path}
            src={p.previewUrl}
            alt={`${label} ${i + 1}`}
            className="h-16 w-16 shrink-0 rounded object-cover"
          />
        ))}
      </div>
      {strip.error ? (
        <p aria-live="polite" className="text-danger text-meta">
          {strip.error}
        </p>
      ) : null}
    </div>
  );
}

export function EquipmentReturnSheet({
  loan,
  via,
  revalidate,
  onClose,
}: {
  loan: ReturnableLoan | null;
  via: EquipmentUsageVia;
  revalidate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Keyed by logId so switching loans shows loading, never another loan's
  // photos — and the effect needs no synchronous reset (react-hooks rule).
  const [before, setBefore] = useState<{ logId: string; urls: readonly string[] } | null>(null);
  const submitRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const strip = usePhotoStrip();

  const logId = loan?.logId ?? null;
  useEffect(() => {
    if (!logId) return;
    let live = true;
    void fetchLoanPhotoUrls(logId).then((r) => {
      if (live) setBefore({ logId, urls: r.ok ? r.urls : [] });
    });
    return () => {
      live = false;
    };
  }, [logId]);

  const close = () => {
    setError(null);
    setBefore(null);
    strip.reset();
    onClose();
  };

  const submit = async () => {
    if (!loan || strip.photos.length === 0 || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setError(null);
    const res = await checkInEquipment({
      logId: loan.logId,
      checkinDate: bangkokTodayIso(),
      revalidate,
      via,
      photoPaths: strip.photos.map((p) => p.path),
    });
    submitRef.current = false;
    setSubmitting(false);
    if (res.ok) {
      close();
    } else {
      setError(res.error);
    }
    router.refresh();
  };

  return (
    <BottomSheet open={loan !== null} title="คืนเครื่องมือ" onClose={close}>
      {loan ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-ink text-sm font-medium">{loan.itemName}</p>
            <p className="text-ink-secondary text-meta">
              {agingLabel(loan.days)} · {loan.holderName}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-ink-secondary text-meta">รูปตอนยืม (เทียบสภาพ)</p>
            {before === null || before.logId !== loan.logId ? (
              <p className="text-ink-muted text-meta">กำลังโหลดรูป…</p>
            ) : before.urls.length === 0 ? (
              <p className="text-ink-muted text-meta">ไม่มีรูปตอนยืม</p>
            ) : (
              <div className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto">
                {before.urls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={u}
                    src={u}
                    alt={`รูปตอนยืม ${i + 1}`}
                    className="h-16 w-16 shrink-0 rounded object-cover"
                  />
                ))}
              </div>
            )}
          </div>
          <PhotoCaptureStrip label="รูปสภาพตอนคืน" strip={strip} />
          {error ? (
            <p aria-live="polite" className="text-danger text-meta">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={strip.photos.length === 0 || strip.busy || submitting}
            className="bg-action text-on-fill rounded-control min-h-11 w-full text-sm font-semibold disabled:opacity-50"
          >
            บันทึกการคืน
          </button>
        </div>
      ) : null}
    </BottomSheet>
  );
}
