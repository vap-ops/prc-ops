// Writing failing test first.
//
// Spec 306 U3b — scanner support detection. The cockpit's สแกน QR button must
// render whenever the device can scan at all: natively (BarcodeDetector,
// Android Chrome/PWA) OR via the jsQR canvas fallback (iOS Safari/PWA, which
// has getUserMedia but no BarcodeDetector). Day-1 field data: the pilot SA is
// on iPhone, saw no scan button, 0/35 muster events used QR.

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasNativeDetector, hasScannerSupport } from "@/lib/muster/scanner-support";

describe("scanner-support", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).BarcodeDetector;
  });

  it("no BarcodeDetector, no mediaDevices → no support at all (jsdom baseline)", () => {
    expect(hasNativeDetector()).toBe(false);
    expect(hasScannerSupport()).toBe(false);
  });

  it("getUserMedia without BarcodeDetector (the iPhone shape) → fallback support, not native", () => {
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: () => Promise.resolve() },
    });
    expect(hasNativeDetector()).toBe(false);
    expect(hasScannerSupport()).toBe(true);
  });

  it("BarcodeDetector present (Android shape) → native and overall support", () => {
    (window as unknown as Record<string, unknown>).BarcodeDetector = class {};
    expect(hasNativeDetector()).toBe(true);
    expect(hasScannerSupport()).toBe(true);
  });

  it("mediaDevices without getUserMedia → still unsupported", () => {
    vi.stubGlobal("navigator", { mediaDevices: {} });
    expect(hasScannerSupport()).toBe(false);
  });
});
