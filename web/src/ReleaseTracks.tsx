import { Fragment, useEffect, useRef, useState } from "react";
import type { EntityDetail, EntityType, Track } from "../../src/shared/types";
import { titlesMatch } from "../../src/shared/youtube";
import { PauseIcon, PlayIcon, warmupYouTube } from "./PathPlayer";
import { playingTitle, usePlayer } from "./player";
import { resolveYouTubeId } from "./youtubeResolve";

export function ReleaseTracks({
  record,
  onOpen,
}: {
  record: EntityDetail;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const source = `release:${record.type}:${record.id}`;
  const player = usePlayer();
  const playerRef = useRef(player);
  playerRef.current = player;
  const [resolving, setResolving] = useState<number | null>(null);
  const [failed, setFailed] = useState<number[]>([]);
  const cache = useRef(new Map<number, string | null>());
  const resolvingRef = useRef<number | null>(null);
  const tracks = record.tracklist;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const session = player.session?.source === source ? player.session : null;

  useEffect(() => {
    cache.current.clear();
    setResolving(null);
    resolvingRef.current = null;
    setFailed([]);
    if (record.tracklist.length > 0) warmupYouTube();
  }, [source, record.tracklist.length]);

  async function resolveTrack(index: number): Promise<string | null> {
    if (cache.current.has(index)) return cache.current.get(index) ?? null;
    const track = tracksRef.current[index];
    if (!track) return null;
    const videoId = await resolveYouTubeId(matchingVideoSrc(record, track), searchQuery(record, track));
    cache.current.set(index, videoId);
    return videoId;
  }

  async function playAt(index: number) {
    if (resolvingRef.current === index) return;
    const current = playerRef.current.session;
    if (current?.source === sourceRef.current && current.index === index) {
      playerRef.current.setPaused(!current.paused);
      return;
    }
    await loadAt(index);
  }

  async function loadAt(index: number): Promise<boolean> {
    const track = tracksRef.current[index];
    if (!track?.title.trim()) return false;
    resolvingRef.current = index;
    setResolving(index);
    const videoId = await resolveTrack(index);
    resolvingRef.current = null;
    setResolving(null);
    if (!videoId) {
      setFailed((current) => (current.includes(index) ? current : [...current, index]));
      return false;
    }
    playerRef.current.play({
      source: sourceRef.current,
      index,
      videoId,
      title: playingTitle(track.title, trackArtist(record, track)),
      releaseId: record.id,
      releaseName: record.name,
      meta: [track.position, track.duration].filter(Boolean).join(" · ") || null,
      canPrev: index > 0,
      canNext: index < tracksRef.current.length - 1,
    });
    return true;
  }

  async function skipFrom(fromIndex: number, step: 1 | -1, closeIfNone: boolean) {
    for (let index = fromIndex + step; index >= 0 && index < tracksRef.current.length; index += step) {
      if (await loadAt(index)) return;
    }
    if (closeIfNone) playerRef.current.stop(sourceRef.current);
  }

  const skipFromRef = useRef(skipFrom);
  skipFromRef.current = skipFrom;

  useEffect(() => {
    return player.bind(source, {
      prev: () => {
        const current = playerRef.current.session;
        if (current?.source === sourceRef.current) void skipFromRef.current(current.index, -1, false);
      },
      next: () => {
        const current = playerRef.current.session;
        if (current?.source === sourceRef.current) void skipFromRef.current(current.index, 1, false);
      },
      ended: () => {
        const current = playerRef.current.session;
        if (current?.source === sourceRef.current) void skipFromRef.current(current.index, 1, true);
      },
    });
  }, [player.bind, source]);

  return (
    <ol className="tracks">
      {tracks.map((track, index) => {
        const playable = Boolean(track.title.trim());
        const active = session?.index === index;
        const showPause = active && !session?.paused;
        return (
          <li key={`${track.position}-${track.title}-${index}`}>
            {playable ? (
              <button
                type="button"
                className="play-toggle"
                disabled={resolving === index}
                aria-label={
                  resolving === index ? "Finding video" : failed.includes(index) && !active ? "No video found" : showPause ? "Pause" : "Play"
                }
                onClick={() => void playAt(index)}
              >
                {resolving === index ? "…" : showPause ? <PauseIcon /> : <PlayIcon />}
              </button>
            ) : (
              <span className="play-toggle-spacer" />
            )}
            <span className="track-pos">{track.position}</span>
            <span className="track-main">
              {track.artists.map((artist, artistIndex) => (
                <Fragment key={`${artist.id}-${artistIndex}`}>
                  {artistIndex > 0 ? " " : null}
                  <span className="name-with-comma">
                    <button type="button" className="text-button" onClick={() => onOpen("artist", artist.id)}>
                      {artist.anv || artist.name}
                    </button>
                    {artistIndex < track.artists.length - 1 ? "," : null}
                  </span>
                </Fragment>
              ))}
              {track.artists.length > 0 ? " – " : ""}
              {track.title}
            </span>
            {track.duration ? <span className="track-time">{track.duration}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function trackArtist(record: EntityDetail, track: Track): string | null {
  const artists = track.artists.map((artist) => artist.anv || artist.name).filter(Boolean);
  if (artists.length > 0) return artists.join(", ");
  const mains = record.credits
    .filter((credit) => credit.scope === "release" && credit.role === "Main")
    .map((credit) => credit.anv || credit.name)
    .filter(Boolean);
  return mains.length > 0 ? mains.join(", ") : null;
}

function matchingVideoSrc(record: EntityDetail, track: Track): string | null {
  for (const video of record.videos) {
    if (titlesMatch(track.title, video.title)) return video.src;
  }
  return null;
}

function searchQuery(record: EntityDetail, track: Track): string {
  const artists = track.artists.map((artist) => artist.anv || artist.name).filter(Boolean);
  const mains = record.credits
    .filter((credit) => credit.scope === "release" && credit.role === "Main")
    .map((credit) => credit.anv || credit.name)
    .filter(Boolean);
  const who = artists.length > 0 ? artists.join(" ") : mains.join(" ");
  return [who || record.name, track.title].filter(Boolean).join(" ");
}
