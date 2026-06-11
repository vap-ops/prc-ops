"use client";

// Root-layout error boundary (spec 15 item G). error.tsx covers segment
// errors but NOT a throw inside the root layout itself — without this
// file those still reach Next.js's built-in English page. Next.js
// requires global-error to be a Client Component and to render its own
// <html>/<body>; the root layout (and its font variables / globals.css)
// is not mounted when this renders, hence the inline styles and the
// system-font fallback.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "#f4f4f5",
          fontFamily:
            "Sarabun, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          textAlign: "center",
          padding: "0 1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>เกิดข้อผิดพลาด</h1>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", margin: "1rem 0 1.5rem" }}>
            มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "none",
              backgroundColor: "#27272a",
              color: "#f4f4f5",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            ลองใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
