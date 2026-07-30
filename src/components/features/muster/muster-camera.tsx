"use client";

// Spec 306 U3 + U3b — the QR camera layer for the muster cockpit. Two decode
// paths behind one loop: the native BarcodeDetector where it exists (Android
// Chrome / the PWA fleet), else a jsQR canvas fallback (iOS Safari/PWA has
// getUserMedia but no BarcodeDetector — the day-1 pilot phone). The add sheet
// (muster-add-sheet.tsx) mounts this whenever hasScannerSupport() (either
// path); an unsupported browser still gets the sheet's tap-add list (spec:
// lost/phoneless badge ≠ absent). The decoded value is the worker id (the same opaque payload the
// phone card + printed badge carry — black-on-white, so jsQR runs dontInvert).
//
// The camera PLUMBING is not unit-tested: getUserMedia/BarcodeDetector/video
// don't exist in jsdom. The two testable halves are extracted and covered — the
// jsQR decode round-trips through qrcode→jsQR (tests/unit/muster-jsqr-decode),
// and the loop's control flow lives in @/lib/muster/decode-loop
// (tests/unit/muster-decode-loop). What is left here is acquisition + teardown.

import { useEffect, useRef, useState } from "react";
import { createDecodeTick } from "@/lib/muster/decode-loop";
import { hasNativeDetector } from "@/lib/muster/scanner-support";

interface BarcodeLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

// Fallback tuning: decode at most every DECODE_MS (jsQR on a full frame is CPU
// work an older iPhone pays per call) over a frame downscaled to ≤ DECODE_W px
// wide — plenty for a hand-held badge filling the viewfinder.
const DECODE_MS = 180;
const DECODE_W = 480;

// Spec 357 U-D: the standalone overlay shell (backdrop + ปิดกล้อง button) moved
// to MusterAddSheet, which hosts this viewfinder alongside the tap-add list —
// this component renders only the video / error view.
//
// `continuous` — the muster sweep scans a whole lineup in one camera-open, so it
// keeps decoding after a hit; the equipment scan resolves one sticker and
// unmounts this component, so it passes false and the loop stops itself rather
// than racing that unmount. (The #745 note that once said "keep the loop
// byte-stable, on-device proof still owed" is retired: the proof arrived
// 2026-07-26 — 17 of 18 check-ins by QR on the pilot iPhone.)
export function MusterCamera({
  onDetected,
  continuous = false,
}: {
  onDetected: (workerId: string) => void;
  continuous?: boolean;
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
  // Same latest-ref reason: keying the camera-init effect on `continuous` would
  // tear down and re-acquire the camera if a caller ever flipped it.
  const continuousRef = useRef(continuous);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);

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

        // Throttle only the fallback path — the native detector is cheap enough
        // to run every frame, which is also what it did before the first decode.
        const tick = createDecodeTick({
          decode: async () => (videoRef.current ? await decode(videoRef.current) : null),
          onDetected: (value) => onDetectedRef.current(value),
          isStopped: () => stopped || !videoRef.current,
          schedule: (next) => {
            raf = requestAnimationFrame(() => void next());
          },
          now: () => performance.now(),
          throttleMs: native ? 0 : DECODE_MS,
          continuous: continuousRef.current,
        });
        raf = requestAnimationFrame(() => void tick());
      } catch {
        // Neutral copy — the sheet renders the tap-add list right below when it
        // applies, so the error must not name a specific fallback button.
        setError("เปิดกล้องไม่ได้");
      }
    }
    run();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return error ? (
    <p className="text-on-brand text-center text-sm">{error}</p>
  ) : (
    <video
      ref={videoRef}
      aria-label="กล้องสแกน QR"
      className="w-full rounded-lg"
      muted
      playsInline
    />
  );
}
