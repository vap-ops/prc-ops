import type { Metadata, Viewport } from "next";
import { Geist_Mono, Sarabun } from "next/font/google";
import { cookies } from "next/headers";
import { SwRegister } from "@/components/features/chrome/sw-register";
import { UploadQueueRunnerLazy } from "@/components/features/photos/upload-queue-runner-lazy";
import { ViewportScrollGuard } from "@/components/features/chrome/viewport-scroll-guard";
import { KeyboardViewportFit } from "@/components/features/chrome/keyboard-viewport-fit";
import { ToastProvider } from "@/components/features/common/toast-provider";
import { ThemeScript } from "@/components/features/chrome/theme-script";
import { THEME_COOKIE, parseThemeSetting } from "@/lib/ui/theme";
import "./globals.css";

// Sarabun matches the PDF reports (spec 13) — one Thai face across web
// and PDF. Not a variable font, so weight is mandatory; 400/500/600 are
// the only weights used in src/.
const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PRC Ops",
    template: "%s — PRC Ops",
  },
  description: "ระบบบริหารงานก่อสร้าง — รูปถ่ายความคืบหน้า อนุมัติงาน และรายงานโครงการ",
};

// Status-bar / splash chrome matches the app's white ground (spec 20).
// maximumScale/userScalable disable iOS auto-zoom-on-input-focus (spec 95): the
// form fields are text-sm (14px) and iOS zooms into any input < 16px on focus, then
// leaves the page zoomed + panned — the "blank portion" the operator saw (manually
// zooming back to 100% cleared it). A native-feel standalone PWA does not pinch-zoom
// forms; this is the design-preserving fix (keeps the field-first text sizes).
export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Spec 190 — read the theme cookie server-side so an explicit-dark user gets
  // the `dark` class on the FIRST paint (no flash). 'system' can't be resolved on
  // the server (no OS signal); the pre-paint ThemeScript handles that case before
  // paint. suppressHydrationWarning absorbs the class the server couldn't predict.
  const setting = parseThemeSetting((await cookies()).get(THEME_COOKIE)?.value);
  const initialDark = setting === "dark";

  return (
    <html
      lang="th"
      suppressHydrationWarning
      style={{ colorScheme: initialDark ? "dark" : "light" }}
      className={`${sarabun.variable} ${geistMono.variable} h-full antialiased ${initialDark ? "dark" : ""}`}
    >
      {/* Spec 64: the body is LOCKED — PageShell's <main> is the only
          scroller, so sticky/fixed chrome cannot drift on iOS bounce. */}
      <body className="h-full overflow-hidden">
        {/* Spec 190: resolve theme before first paint (covers 'system'). */}
        <ThemeScript />
        {/* Spec 76: the toast viewport wraps {children} so a toast fired just
            before a router.refresh() survives the RSC re-render. */}
        <ToastProvider>{children}</ToastProvider>
        <SwRegister />
        {/* Spec 35: drains the offline photo queue (leftovers from
            crash/offline/navigation); renders only when items wait. */}
        <UploadQueueRunnerLazy />
        {/* Spec 95: defends the spec-64 body lock — keeps the document at
            scroll 0 if iOS scrolls it to reveal a focused input. The primary
            keyboard fix is maximum-scale=1 in `viewport` above (no auto-zoom). */}
        <ViewportScrollGuard />
        {/* Keyboard-fit for the page scroller: caps PageShell's <main> to the
            band above the soft keyboard so a focused field on any non-sheet form
            is reachable + centred (BottomSheet already handles sheet forms). */}
        <KeyboardViewportFit />
      </body>
    </html>
  );
}
