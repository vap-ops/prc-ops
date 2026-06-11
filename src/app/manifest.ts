import type { MetadataRoute } from "next";

// PWA manifest (spec 18) — what makes the app installable to a phone
// home screen with a standalone (no browser chrome) window. Thai-first
// per spec 14; the brand name stays Latin. Theme/background match the
// app's white ground (spec 20) so the splash and status bar don't flash.
// Icons are the generated placeholder mark — replace the PNGs with the
// real logo whenever one exists; sizes/paths stay the same.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PRC Ops",
    short_name: "PRC Ops",
    description: "ระบบบริหารงานก่อสร้าง — รูปถ่ายความคืบหน้า อนุมัติงาน และรายงานโครงการ",
    lang: "th",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
