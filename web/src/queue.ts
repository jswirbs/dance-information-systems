import type { Credit, PlaybackRelease, Track, VideoLink } from "../../src/shared/types";
import { titlesMatch } from "../../src/shared/youtube";
import type { Playable, PlayingArtist } from "./player";

export function releaseSource(id: number): string {
  return `release:release:${id}`;
}

export function playablesFromRelease(release: PlaybackRelease): Playable[] {
  return release.tracklist.map((track, index) => ({
    key: `${release.id}:${index}:${track.title}`,
    title: track.title,
    artists: trackArtists(release, track),
    releaseId: release.id,
    releaseName: release.name,
    meta: [track.position, track.duration].filter(Boolean).join(" · ") || null,
    videoSrc: matchingVideoSrc(release.videos, track),
    searchQuery: track.title.trim() ? searchQuery(release, track) : "",
  }));
}

function trackArtists(release: PlaybackRelease, track: Track): PlayingArtist[] {
  if (track.artists.length > 0) {
    return track.artists.map((artist) => ({ id: artist.id, name: artist.anv || artist.name })).filter((artist) => artist.name);
  }
  return release.credits
    .filter((credit) => credit.scope === "release" && credit.role === "Main")
    .map((credit) => ({ id: credit.id, name: credit.anv || credit.name }))
    .filter((artist) => artist.name);
}

function matchingVideoSrc(videos: VideoLink[], track: Track): string | null {
  for (const video of videos) {
    if (titlesMatch(track.title, video.title)) return video.src;
  }
  return null;
}

function searchQuery(release: PlaybackRelease, track: Track): string {
  const artists = track.artists.map((artist) => artist.anv || artist.name).filter(Boolean);
  const mains = mainCredits(release.credits);
  const who = artists.length > 0 ? artists.join(" ") : mains.join(" ");
  return [who || release.name, track.title].filter(Boolean).join(" ");
}

function mainCredits(credits: Credit[]): string[] {
  return credits
    .filter((credit) => credit.scope === "release" && credit.role === "Main")
    .map((credit) => credit.anv || credit.name)
    .filter(Boolean);
}
