// Spec 306 U3b — can this device scan a muster QR at all?
//
// Two capability tiers, one question. `hasNativeDetector` picks the decode PATH
// (BarcodeDetector — Android Chrome/PWA); `hasScannerSupport` gates the สแกน QR
// AFFORDANCE: native support OR a camera the jsQR canvas fallback can read
// (iOS Safari/PWA has getUserMedia but no BarcodeDetector — the day-1 pilot
// phone). Client-safe pure module: the "use client" cockpit value-imports it,
// so it must never be server-only (the #742 build lesson).

export function hasNativeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function hasScannerSupport(): boolean {
  if (hasNativeDetector()) return true;
  return (
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}
