import { Fragment, useEffect, useMemo } from "react";
import { playbackProblemMessage } from "../../src/shared/playback";
import type { EntityDetail, EntityType } from "../../src/shared/types";
import { PlayToggle } from "./PlayToggle";
import { warmupYouTube } from "./PathPlayer";
import { playablesFromRelease, releaseSource } from "./queue";
import { usePlayback } from "./player";

export function ReleaseTracks({
  record,
  onOpen,
}: {
  record: EntityDetail;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const source = releaseSource(record.id);
  const items = useMemo(() => playablesFromRelease(record), [record]);
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
              <PlayToggle
                paused={!showPause}
                busy={resolving === index}
                error={failed.includes(index) && !active ? playbackProblemMessage("release", "no_video") : null}
                onToggle={() => void playAt(index)}
              />
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
