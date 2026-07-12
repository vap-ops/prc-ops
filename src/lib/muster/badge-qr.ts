import "server-only";

// Spec 306 U3a — render a worker's muster check-in QR as an SVG string. Payload
// is the worker id (workers.id), the SAME opaque value the printed badge encodes
// (src/app/sa/crew/badges/page.tsx) so the muster scanner reads phone or paper
// identically — a scan only means something inside an authenticated SA session on
// a visible project; it authenticates nobody. Server-only (qrcode is a node lib).
import QRCode from "qrcode";

export async function toWorkerBadgeQrSvg(workerId: string): Promise<string> {
  return QRCode.toString(workerId, {
    type: "svg",
    margin: 1,
    width: 176,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
