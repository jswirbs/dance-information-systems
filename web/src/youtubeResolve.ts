import { parseYouTubeId } from "../../src/shared/youtube";
import { api } from "./api";

export async function resolveYouTubeId(videoSrc: string | null, searchQuery: string): Promise<string | null> {
  const known = parseYouTubeId(videoSrc);
  if (known) return known;
  try {
    const result = await api.youtubeSearch(searchQuery);
    return result.videoId;
  } catch {
    return null;
  }
}
