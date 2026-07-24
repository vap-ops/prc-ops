"use client";

// Spec 306 U3 + U3b — the QR camera layer for the muster cockpit. Two decode
// paths behind one loop: the native BarcodeDetector where it exists (Android
// Chrome / the PWA fleet), else a jsQR canvas fallback (iOS Safari/PWA has
// getUserMedia but no BarcodeDetector — the day-1 pilot phone). The cockpit
// mounts this whenever hasScannerSupport() (either path); an unsupported
// browser still falls back to manual tap-add (spec: lost/phoneless badge ≠
// absent). The decoded value is the worker id (the same opaque payload the
// phone card + printed badge carry — black-on-white, so jsQR runs dontInvert).
//
// The camera loop is not unit-tested: getUserMedia/BarcodeDetector/video don't
// exist in jsdom. The jsQR decode itself IS — tests/unit/muster-jsqr-decode
// round-trips a badge payload through qrcode→jsQR. Kept in its own file so the
// untestable surface stays isolated.

import { useEffect, useRef, useState } from "react";
import { hasNativeDetector } from "@/lib/muster/scanner-support";

interface BarcodeLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

// Fallback tuning: decode at most every DECODE_MS (jsQR on a full frame is CPU
// work an older iPhone pays per call) over a frame downscaled to ≤ DECODE_W px
// wide — plenty for a hand-held badge filling the viewfinder.
const DECODE_MS = 180;
const DECODE_W = 480;

export function MusterCamera({
  onDetected,
  onClose,
}: {
  onDetected: (workerId: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest-ref for the scan callback: the cockpit passes an inline arrow, and
  // keying the camera-init effect on it would tear down + re-acquire the camera
  // (and on iOS possibly re-prompt) on every parent re-render while the scanner
  // is open (fresh-eyes U3b). The effect runs once per mount; the ref always
  // sees the current handler.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // Closed while an await was in flight (permission prompt, video attach):
    // the cleanup ran with `stream` still null, so the bailing arm must stop
    // the tracks itself or the camera indicator stays lit (fresh-eyes U3b).
    const bail = () => {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    async function run() {
      try {
        // Pick the decode path BEFORE opening the camera so a missing fallback
        // module surfaces as the same "can't scan" copy, not a live camera that
        // silently never decodes.
        const native = hasNativeDetector();
        let decode: (video: HTMLVideoElement) => Promise<string | null>;
        if (native) {
          const Detector = (
            window as unknown as { BarcodeDetector: new (o: object) => BarcodeLike }
          ).BarcodeDetector;
          const detector = new Detector({ formats: ["qr_code"] });
          decode = async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
        } else {
          const { default: jsQR } = await import("jsqr");
          if (stopped) return;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("no 2d context");
          decode = async (video) => {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (!vw || !vh) return null;
            const scale = Math.min(1, DECODE_W / vw);
            const w = Math.max(1, Math.round(vw * scale));
            const h = Math.max(1, Math.round(vh * scale));
            if (canvas.width !== w || canvas.height !== h) {
              canvas.width = w;
              canvas.height = h;
            }
            ctx.drawImage(video, 0, 0, w, h);
            const frame = ctx.getImageData(0, 0, w, h);
            return jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
          };
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) return bail(); // closed while the permission prompt was up
        const video = videoRef.current;
        if (!video) return bail();
        video.srcObject = stream;
        await video.play();
        if (stopped) return bail();

        let lastDecode = 0;
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          // Throttle the fallback path; the native detector is cheap enough per
          // frame. jsQR runs synchronously on the main thread, so the stamp is
          // taken AFTER the decode — measuring from the start would let a slow
          // decode (> DECODE_MS) re-run back-to-back with no idle gap.
          if (native || performance.now() - lastDecode >= DECODE_MS) {
            try {
              const value = await decode(videoRef.current);
              if (stopped) return; // closed mid-detect → don't fire a stale scan
              if (value) {
                onDetectedRef.current(value);
                return;
              }
            } catch {
              // transient decode error — keep scanning
            } finally {
              lastDecode = performance.now();
            }
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
  }, []);

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
