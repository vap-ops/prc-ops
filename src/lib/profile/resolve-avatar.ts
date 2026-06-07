export type AvatarResult =
  | { kind: "uploaded"; url: string }
  | { kind: "line"; url: string }
  | { kind: "initials" };

interface ResolveAvatarInput {
  uploadedUrl?: string | null;
  lineUrl?: string | null;
}

export function resolveAvatar({ uploadedUrl, lineUrl }: ResolveAvatarInput): AvatarResult {
  if (uploadedUrl) return { kind: "uploaded", url: uploadedUrl };
  if (lineUrl) return { kind: "line", url: lineUrl };
  return { kind: "initials" };
}

export function getInitials(fullName: string | null): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}
