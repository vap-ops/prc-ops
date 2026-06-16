// Server Component — no interactivity. Plain <img> for external URLs (not
// next/image) to avoid remote-domain allowlisting and referrer leakage.
// See ADR 0020 for the render-precedence and external-image rationale.

import { resolveAvatar, getInitials } from "@/lib/profile/resolve-avatar";

interface AvatarSurfaceProps {
  uploadedUrl?: string | null;
  lineUrl?: string | null;
  fullName: string | null;
  size?: number;
}

export function AvatarSurface({ uploadedUrl, lineUrl, fullName, size = 64 }: AvatarSurfaceProps) {
  const result = resolveAvatar({ uploadedUrl: uploadedUrl ?? null, lineUrl: lineUrl ?? null });

  if (result.kind === "uploaded" || result.kind === "line") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={result.url}
        alt={fullName ?? "รูปโปรไฟล์"}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  // Initials fallback — inline SVG/CSS, no network request.
  const initials = getInitials(fullName);
  return (
    <span
      aria-label={fullName ?? "รูปโปรไฟล์"}
      className="bg-sunk text-ink inline-flex items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}
