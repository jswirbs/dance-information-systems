import type { EntityType } from "./types.js";

export type PlaybackProblem = "no_release" | "no_tracks" | "no_video" | "unavailable";

/** First track with a title. Heading rows and blank entries are skipped. */
export function firstTitledTrackIndex(tracks: readonly { title: string }[]): number {
  return tracks.findIndex((track) => track.title.trim().length > 0);
}

export function playbackProblemMessage(type: EntityType, problem: PlaybackProblem): string {
  if (problem === "no_video") return "No video found.";
  if (problem === "unavailable") return "Couldn't load playback.";
  if (problem === "no_tracks") {
    return type === "release" ? "This release has no tracks." : "The latest release has no tracks.";
  }
  if (type === "label") return "This label has no releases.";
  if (type === "artist") return "This artist has no releases.";
  return "Nothing to play.";
}
