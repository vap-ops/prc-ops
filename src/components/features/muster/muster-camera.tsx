"use client";

// Spec 306 U3 — the QR camera layer for the muster cockpit. Uses the native
// BarcodeDetector (Android Chrome / the PWA fleet); the cockpit only mounts this
// when `"BarcodeDetector" in window`, so an unsupported browser never sees it and
// falls back to manual tap-add (spec: lost/phoneless badge ≠ absent). The decoded
// value is the worker id (the same opaque payload the phone card + printed badge
// carry). jsQR (iOS fallback) is a deferred follow-up — manual add covers it now.
//
// Not unit-tested: getUserMedia + BarcodeDetector don't exist in jsdom. Verified
// on a real device. Kept in its own file so that constraint is isolated.

import { useEffect, useRef, useState } from "react";

interface BarcodeLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function MusterCamera({
  onDetected,
  onClose,
}: {
  onDetected: (workerId: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function run() {
      try {
        const Detector = (window as unknown as { BarcodeDetector: new (o: object) => BarcodeLike })
          .BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (stopped) return; // closed mid-detect → don't fire a stale scan
            const value = codes[0]?.rawValue;
            if (value) {
              onDetected(value);
              return;
            }
          } catch {
            // transient decode error — keep scanning
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("เปิดกล้องไม่ได้ — ใช้การแตะเพิ่มช่างแทนได้");
      }
    }
    run();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4">
        {error ? (
          <p className="text-on-brand text-center text-sm">{error}</p>
        ) : (
          <video
            ref={videoRef}
            aria-label="กล้องสแกน QR"
            className="w-full rounded-lg"
            muted
            playsInline
          />
        )}
        <button
          type="button"
          onClick={onClose}
          className="bg-card text-ink min-h-11 w-full rounded-lg px-4 text-sm font-bold"
        >
          ปิดกล้อง
        </button>
      </div>
    </div>
  );
}
