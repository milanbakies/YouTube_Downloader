const YOUTUBE_HOST =
  /^(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|m\.youtube\.com)$/i;

export function normalizeYouTubeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  return withScheme;
}

export function isValidYouTubeUrl(raw: string): boolean {
  const normalized = normalizeYouTubeUrl(raw);
  if (!normalized) return false;

  try {
    const u = new URL(normalized);
    if (!YOUTUBE_HOST.test(u.hostname)) return false;
    if (u.hostname === "youtu.be") {
      return u.pathname.length > 1;
    }
    if (u.pathname === "/watch") {
      return u.searchParams.has("v");
    }
    if (
      u.pathname.startsWith("/playlist") ||
      u.pathname.startsWith("/shorts/") ||
      u.pathname.startsWith("/live/")
    ) {
      return true;
    }
    return u.searchParams.has("list");
  } catch {
    return false;
  }
}
