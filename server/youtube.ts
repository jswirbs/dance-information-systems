import { youtubeSearchUrl } from "../src/shared/youtube.js";

const cache = new Map<string, string | null>();

export type YouTubeSearchResult = {
  videoId: string | null;
  searchUrl: string;
};

export async function searchYouTube(query: string): Promise<YouTubeSearchResult> {
  const trimmed = query.trim();
  const searchUrl = youtubeSearchUrl(trimmed);
  if (!trimmed) return { videoId: null, searchUrl };
  const cached = cache.get(trimmed);
  if (cached !== undefined) return { videoId: cached, searchUrl };
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return { videoId: null, searchUrl };
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("key", key);
  const response = await fetch(url);
  if (!response.ok) {
    cache.set(trimmed, null);
    return { videoId: null, searchUrl };
  }
  const body = (await response.json()) as { items?: Array<{ id?: { videoId?: string } }> };
  const videoId = body.items?.[0]?.id?.videoId ?? null;
  cache.set(trimmed, videoId);
  return { videoId, searchUrl };
}
