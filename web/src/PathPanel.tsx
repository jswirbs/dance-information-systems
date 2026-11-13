import { useEffect, useRef, useState } from "react";
import { PATH_MAX_HOPS } from "../../src/shared/constants";
import type { EntityType, PathKind, PathPayload, PathTrack, RelatedRow, SearchHit } from "../../src/shared/types";
import { parseYouTubeId } from "../../src/shared/youtube";
import { api } from "./api";
import { PathPlayer } from "./PathPlayer";
import { ScrollList, Thumb } from "./ui";

const SLOT_LABELS = ["A", "B"];
type PathTab = "path" | "playlist";
type Playback = { index: number; videoId: string; paused: boolean };

export function PathPanel({
  stops,
  focused,
  kind,
  payload,
  error,
  onFocus,
  onClear,
  onKind,
  onRegenerate,
  onOpen,
}: {
  stops: Array<SearchHit | null>;
  focused: number;
  kind: PathKind;
  payload: PathPayload | null;
  error: string | null;
  onFocus: (index: number) => void;
  onClear: (index: number) => void;
  onKind: (kind: PathKind) => void;
  onRegenerate: () => void;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const [tab, setTab] = useState<PathTab>("path");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [failed, setFailed] = useState<number[]>([]);
  const ready = stops.every((stop) => stop != null);
  const empty = emptyCopy(stops, payload, error);
  const rows = payload?.rows ?? [];
  const tracks = payload?.tracks ?? [];
  const thumbs = new Map(rows.filter((row) => row.type === "release").map((row) => [row.id, row.thumbUrl]));
  const cache = useRef(new Map<number, string | null>());
  const tracksRef = useRef(tracks);
  const playbackRef = useRef(playback);
  tracksRef.current = tracks;
  playbackRef.current = playback;

  const trackKey = tracks.map((track) => `${track.hopIndex}:${track.releaseId}:${track.title}`).join("|");
  useEffect(() => {
    cache.current.clear();
    setPlayback(null);
    setResolving(null);
    setFailed([]);
  }, [trackKey]);

  async function resolveVideo(track: PathTrack): Promise<string | null> {
    if (cache.current.has(track.hopIndex)) return cache.current.get(track.hopIndex) ?? null;
    const known = parseYouTubeId(track.videoSrc);
    if (known) {
      cache.current.set(track.hopIndex, known);
      return known;
    }
    try {
      const result = await api.youtubeSearch(track.searchQuery);
      cache.current.set(track.hopIndex, result.videoId);
      return result.videoId;
    } catch {
      cache.current.set(track.hopIndex, null);
      return null;
    }
  }

  async function playAt(index: number) {
    const current = playbackRef.current;
    if (current?.index === index) {
      setPlayback({ ...current, paused: !current.paused });
      return;
    }
    const track = tracksRef.current[index];
    if (!track) return;
    setResolving(index);
    const videoId = await resolveVideo(track);
    setResolving(null);
    if (!videoId) {
      setFailed((current) => (current.includes(index) ? current : [...current, index]));
      return;
    }
    setPlayback({ index, videoId, paused: false });
  }

  async function playNext(fromIndex: number) {
    const list = tracksRef.current;
    for (let index = fromIndex + 1; index < list.length; index += 1) {
      const track = list[index]!;
      setResolving(index);
      const videoId = await resolveVideo(track);
      setResolving(null);
      if (videoId) {
        setPlayback({ index, videoId, paused: false });
        return;
      }
    }
    setPlayback(null);
  }

  return (
    <>
      <div className="path-stops">
        {stops.map((stop, index) => (
          <button
            key={SLOT_LABELS[index] ?? index}
            type="button"
            className={`path-slot${focused === index ? " focused" : ""}${stop ? ` ${stop.type}` : ""}`}
            onClick={() => (stop && focused === index ? onClear(index) : onFocus(index))}
          >
            <span className="path-slot-label">{SLOT_LABELS[index]}</span>
            {stop ? (
              <span>
                <strong>{stop.name}</strong>
                <small>{stop.type}</small>
              </span>
            ) : (
              <span>
                <strong>Empty</strong>
                <small>Search and pick an entity</small>
              </span>
            )}
            {stop && <span aria-hidden="true"> ×</span>}
          </button>
        ))}
      </div>
      <div className="toggle" role="tablist" aria-label="Path kind">
        <button type="button" role="tab" aria-selected={kind === "shortest"} onClick={() => onKind("shortest")}>
          Shortest
        </button>
        <button type="button" role="tab" aria-selected={kind === "random"} onClick={() => onKind("random")}>
          Random-ish
        </button>
        {kind === "random" && (
          <button type="button" className="text-button path-regen" disabled={!ready || payload?.shortestHops == null} onClick={onRegenerate}>
            Regenerate
          </button>
        )}
      </div>
      {ready && payload?.hops != null && payload.shortestHops != null && (
        <p className="path-meta">
          {payload.hops} hop{payload.hops === 1 ? "" : "s"}
          {payload.hops !== payload.shortestHops ? ` (shortest was ${payload.shortestHops})` : ""}
          {payload.fallback === "shortest" ? " · Fell back to shortest." : ""}
        </p>
      )}
      <div className="toggle" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "path"} onClick={() => setTab("path")}>
          Path
        </button>
        <button type="button" role="tab" aria-selected={tab === "playlist"} onClick={() => setTab("playlist")}>
          Playlist
        </button>
      </div>
      {empty ? (
        <div className="path-empty">
          <p>{empty.title}</p>
          {empty.detail && <p className="path-empty-detail">{empty.detail}</p>}
        </div>
      ) : tab === "path" ? (
        <ScrollList count={rows.length}>
          <ul className="rows">
            {rows.map((row) => (
              <PathRow key={`${row.type}:${row.id}`} row={row} onOpen={onOpen} />
            ))}
          </ul>
        </ScrollList>
      ) : tracks.length === 0 ? (
        <div className="path-empty">
          <p>No releases on this path.</p>
        </div>
      ) : (
        <>
          <ScrollList count={tracks.length}>
            <ul className="rows">
              {tracks.map((track, index) => (
                <PlaylistRow
                  key={`${track.hopIndex}:${track.releaseId}:${track.title}`}
                  track={track}
                  thumbUrl={thumbs.get(track.releaseId) ?? null}
                  active={playback?.index === index}
                  paused={playback?.index === index ? playback.paused : true}
                  busy={resolving === index}
                  missing={failed.includes(index)}
                  onOpen={onOpen}
                  onToggle={() => void playAt(index)}
                />
              ))}
            </ul>
          </ScrollList>
          {playback && (
            <PathPlayer
              videoId={playback.videoId}
              paused={playback.paused}
              onEnded={() => {
                const current = playbackRef.current;
                if (current) void playNext(current.index);
              }}
              onPaused={() => setPlayback((current) => (current ? { ...current, paused: true } : current))}
              onPlaying={() => setPlayback((current) => (current ? { ...current, paused: false } : current))}
            />
          )}
        </>
      )}
    </>
  );
}

function PathRow({ row, onOpen }: { row: RelatedRow; onOpen: (type: EntityType, id: number) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(row.type, row.id)}>
        <Thumb url={row.thumbUrl} name={row.name} type={row.type} />
        <span>
          <strong>{row.name}</strong>
          {row.reason ? <small>{row.reason}</small> : null}
          {row.type === "release" && (
            <small className="meta">{[row.year, row.styles.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</small>
          )}
        </span>
      </button>
    </li>
  );
}

function PlaylistRow({
  track,
  thumbUrl,
  active,
  paused,
  busy,
  missing,
  onOpen,
  onToggle,
}: {
  track: PathTrack;
  thumbUrl: string | null;
  active: boolean;
  paused: boolean;
  busy: boolean;
  missing: boolean;
  onOpen: (type: EntityType, id: number) => void;
  onToggle: () => void;
}) {
  const showPause = active && !paused;
  return (
    <li className="playlist-row">
      <button type="button" onClick={() => onOpen("release", track.releaseId)}>
        <Thumb url={thumbUrl} name={track.releaseName} type="release" />
        <span>
          <strong>
            {track.artistName ? `${track.artistName} – ${track.title}` : track.title}
          </strong>
          <small>
            {[track.releaseName, track.position, track.duration].filter(Boolean).join(" · ")}
          </small>
        </span>
      </button>
      <div className="playlist-actions">
        <button
          type="button"
          className="play-toggle"
          disabled={busy}
          aria-label={busy ? "Finding video" : missing && !active ? "No video found" : showPause ? "Pause" : "Play"}
          onClick={onToggle}
        >
          {busy ? "…" : showPause ? <PauseIcon /> : <PlayIcon />}
        </button>
        {track.artistId != null && (
          <button type="button" className="text-button" onClick={() => onOpen("artist", track.artistId!)}>
            Artist
          </button>
        )}
      </div>
    </li>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="8,5 20,12 8,19" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}

function emptyCopy(
  stops: Array<SearchHit | null>,
  payload: PathPayload | null,
  error: string | null,
): { title: string; detail?: string } | null {
  if (error === "same_clique") return { title: "Those are the same artist (aliases)." };
  if (error) return { title: error };
  if (stops.some((stop) => stop == null)) return { title: "Pick two entities." };
  if (payload && payload.shortestHops == null) {
    return {
      title: `No catalog path within ${payload.limit ?? PATH_MAX_HOPS} hops.`,
      detail: `They may still be connected by a longer chain; this mode only searches up to ${payload.limit ?? PATH_MAX_HOPS}.`,
    };
  }
  return null;
}
