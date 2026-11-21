import { Fragment, useEffect, useMemo } from "react";
import type { EntityDetail, EntityType, Track } from "../../src/shared/types";
import { titlesMatch } from "../../src/shared/youtube";
import { PauseIcon, PlayIcon, warmupYouTube } from "./PathPlayer";
import { Ellipsis } from "./ellipsis";
import { usePlayback, type Playable, type PlayingArtist } from "./player";

export function ReleaseTracks({
  record,
  onOpen,
}: {
  record: EntityDetail;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const source = `release:${record.type}:${record.id}`;
  const items = useMemo<Playable[]>(
    () =>
      record.tracklist.map((track, index) => ({
        key: `${record.id}:${index}:${track.title}`,
        title: track.title,
        artists: trackArtists(record, track),
        releaseId: record.id,
        releaseName: record.name,
        meta: [track.position, track.duration].filter(Boolean).join(" · ") || null,
        videoSrc: matchingVideoSrc(record, track),
        searchQuery: track.title.trim() ? searchQuery(record, track) : "",
      })),
    [record],
  );
  const { session, resolving, failed, playAt } = usePlayback(source, items);
  useEffect(() => {
    if (record.tracklist.length > 0) warmupYouTube();
  }, [record.tracklist.length]);

  return (
    <ol className="tracks">
      {record.tracklist.map((track, index) => {
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
                {resolving === index ? <Ellipsis /> : showPause ? <PauseIcon /> : <PlayIcon />}
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

function trackArtists(record: EntityDetail, track: Track): PlayingArtist[] {
  if (track.artists.length > 0) {
    return track.artists.map((artist) => ({ id: artist.id, name: artist.anv || artist.name })).filter((artist) => artist.name);
  }
  return record.credits
    .filter((credit) => credit.scope === "release" && credit.role === "Main")
    .map((credit) => ({ id: credit.id, name: credit.anv || credit.name }))
    .filter((artist) => artist.name);
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
