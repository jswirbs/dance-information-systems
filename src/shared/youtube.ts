export function parseYouTubeId(src: string | null | undefined): string | null {
  if (!src) return null;
  try {
    const url = new URL(src);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex((part) => part === "embed" || part === "v" || part === "shorts");
      const id = marker >= 0 ? parts[marker + 1] : null;
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch {
    const match = /(?:v=|youtu\.be\/|embed\/)([\w-]{11})/.exec(src);
    return match?.[1] ?? null;
  }
  return null;
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\((?:official(?:\s+(?:video|audio|lyric video))?|lyrics?|visualizer|audio|hq|hd|4k)\)/g, " ")
    .replace(/\b(?:official(?:\s+(?:video|audio))?|visualizer|lyric video|lyrics)\b/g, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring)\b.+$/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function titlesMatch(trackTitle: string, videoTitle: string): boolean {
  const track = normalizeTitle(trackTitle);
  const video = normalizeTitle(videoTitle);
  if (!track || !video) return false;
  if (track === video) return true;
  const shorter = track.length <= video.length ? track : video;
  // A one-word title has to be the whole title. "go" must not match "go away".
  if (!shorter.includes(" ") && shorter.length < 12) return false;
  const longer = shorter === track ? video : track;
  return longer.includes(shorter);
}
