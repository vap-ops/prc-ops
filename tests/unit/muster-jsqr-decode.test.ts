// Writing failing test first.
//
// Spec 306 U3b — prove the jsQR fallback actually decodes the payloads our
// badges emit. Round-trip: render a worker-id QR with the SAME library the
// badge surfaces use (qrcode → bit matrix), rasterize it to RGBA the way a
// camera frame arrives, and decode with jsQR. This is the executable proof of
// the library integration — the camera itself needs a real device (no
// getUserMedia in jsdom / no webcam on this box).

import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";

// Rasterize a qrcode bit matrix to RGBA: black-on-white, `scale` px per module,
// `margin` modules of quiet zone — the printed badge / digital card shape.
function rasterize(text: string, scale = 8, margin = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const dim = (size + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!qr.modules.get(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const px = ((r + margin) * scale + y) * dim + (c + margin) * scale + x;
          rgba[px * 4] = 0;
          rgba[px * 4 + 1] = 0;
          rgba[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { rgba, dim };
}

describe("jsQR round-trip on badge payloads", () => {
  it("decodes a worker-uuid QR rendered by the qrcode lib (dontInvert, badge shape)", () => {
    const workerId = "0bba2fd0-1111-2222-3333-444444444444";
    const { rgba, dim } = rasterize(workerId);
    const hit = jsQR(rgba, dim, dim, { inversionAttempts: "dontInvert" });
    expect(hit?.data).toBe(workerId);
  });

  it("still decodes at 2px modules — the size regime the ≤480px camera downscale produces", () => {
    // The component decodes a frame downscaled to ≤480px wide, which shrinks the
    // badge's modules well below print size. jsQR must hold at small module
    // sizes or the fallback would show a live camera that never fires. (True
    // camera-optics proof is the on-device check — this pins the decoder floor.)
    const workerId = "0bba2fd0-1111-2222-3333-444444444444";
    const { rgba, dim } = rasterize(workerId, 2, 4);
    const hit = jsQR(rgba, dim, dim, { inversionAttempts: "dontInvert" });
    expect(hit?.data).toBe(workerId);
  });

  it("returns null on a blank frame (no false positives feeding the scan action)", () => {
    const dim = 200;
    const blank = new Uint8ClampedArray(dim * dim * 4).fill(255);
    expect(jsQR(blank, dim, dim, { inversionAttempts: "dontInvert" })).toBeNull();
  });
});
