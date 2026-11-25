import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { PATH_MAX_HOPS } from "../../src/shared/constants";
import { playbackProblemMessage } from "../../src/shared/playback";
import type { EntityType, PathKind, PathPayload, PathTrack, SearchHit } from "../../src/shared/types";
import { api } from "./api";
import { PlayToggle } from "./PlayToggle";
import { warmupYouTube } from "./PathPlayer";
import { usePlayback, type Playable } from "./player";
import { SearchSuggest } from "./SearchSuggest";
import { Ellipsis } from "./ellipsis";
import { ScrollList, Thumb } from "./ui";

const SLOT_LABELS = ["A", "B"];
const PATH_SOURCE = "path";

export function PathPanel({
  stops,
  focused,
  kind,
  payload,
  error,
  loading,
  onFocus,
  onPick,
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
  loading: boolean;
  onFocus: (index: number) => void;
  onPick: (hit: SearchHit, index: number) => void;
  onClear: (index: number) => void;
  onKind: (kind: PathKind) => void;
  onRegenerate: () => void;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const [queries, setQueries] = useState(["", ""]);
  const [active, setActive] = useState<number | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [spin, setSpin] = useState(0);
  const [hitSlot, setHitSlot] = useState<number | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const ready = stops.every((stop) => stop != null);
  const empty = emptyCopy(stops, payload, error, loading);
  const rows = payload?.rows ?? [];
  const tracks = payload?.tracks ?? [];
  const thumbs = new Map(rows.filter((row) => row.type === "release").map((row) => [row.id, row.thumbUrl]));
  const items = useMemo<Playable[]>(
    () =>
      (payload?.tracks ?? []).map((track) => ({
        key: `${track.hopIndex}:${track.releaseId}:${track.title}`,
        title: track.title,
        artists: track.artistName?.trim() ? [{ id: track.artistId, name: track.artistName }] : [],
        releaseId: track.releaseId,
        releaseName: track.releaseName,
        meta: [track.position, track.duration].filter(Boolean).join(" · ") || null,
        videoSrc: track.videoSrc,
        searchQuery: track.searchQuery,
      })),
    [payload],
  );
  const playback = usePlayback(PATH_SOURCE, items);
  const { session, resolving, failed, playAt } = playback;

  useEffect(() => {
    if (stops[focused] == null) setActive(focused);
  }, [focused, stops]);

  useLayoutEffect(() => {
    if (active == null) return;
    inputs.current[active]?.focus();
  }, [active, stops]);

  useEffect(() => {
    if (active == null) return;
    const query = queries[active]?.trim() ?? "";
    if (query.length < 1) {
      setHits([]);
      setHitSlot(active);
      setSearchedQuery(null);
      return;
    }
    let cancelled = false;
    const slot = active;
    const handle = setTimeout(() => {
      api
        .search(query)
        .then((next) => {
          if (cancelled) return;
          setHits(next);
          setHitSlot(slot);
          setSearchedQuery(query);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setHitSlot(slot);
          setSearchedQuery(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [active, queries]);

  useEffect(() => {
    if (tracks.length > 0) warmupYouTube();
  }, [tracks.length]);

  function focusSlot(index: number) {
    onFocus(index);
    setActive(index);
  }

  function pick(hit: SearchHit, index: number) {
    onPick(hit, index);
    setQueries((current) => current.map((item, slot) => (slot === index ? "" : item)));
    setHits([]);
    setHitSlot(null);
    setSearchedQuery(null);
    setActive(null);
  }

  function leaveSlot(index: number, event: FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget;
    const slot = event.currentTarget.closest(".path-slot");
    if (next instanceof Node && slot?.contains(next)) return;
    setQueries((current) => current.map((item, slot) => (slot === index ? "" : item)));
    setHits([]);
    setHitSlot(null);
    setSearchedQuery(null);
    setActive((current) => (current === index ? null : current));
  }

  return (
    <>
      <p className="mode-lead"><strong>Find the path</strong> between two artists, labels, or releases and the music that connects them</p>
      <div className="path-stops">
        {stops.map((stop, index) => {
          const label = SLOT_LABELS[index] ?? String(index + 1);
          const searching = active === index || stop == null;
          const typed = (queries[index]?.trim() ?? "").length > 0;
          const open = active === index && hitSlot === index && searchedQuery != null && typed;
          return (
            <div
              key={label}
              className={`path-slot${stop ? ` ${stop.type}` : ""}${open ? " open" : ""}`}
              onClick={(event) => {
                const target = event.target;
                if (target instanceof Element && target.closest("button, input")) return;
                focusSlot(index);
              }}
            >
              <span className="path-slot-label">{label}</span>
              <div className="path-slot-body">
                {searching ? (
                  <input
                    ref={(node) => {
                      inputs.current[index] = node;
                    }}
                    className="path-slot-input"
                    value={queries[index] ?? ""}
                    placeholder="Search artists, labels, or releases"
                    aria-label={`Search stop ${label}`}
                    aria-expanded={open}
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                    onFocus={() => focusSlot(index)}
                    onBlur={(event) => leaveSlot(index, event)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setQueries((current) => current.map((item, slot) => (slot === index ? value : item)));
                      if (value.trim().length < 1) {
                        setHits([]);
                        setHitSlot(index);
                        setSearchedQuery(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.blur();
                        return;
                      }
                      if (event.key === "Enter" && open && hits[0]) {
                        event.preventDefault();
                        pick(hits[0], index);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="path-slot-value" onClick={() => focusSlot(index)}>
                    <strong>{stop.name}</strong>
                    <small>{stop.type}</small>
                  </button>
                )}
              </div>
              {stop && (
                <button
                  type="button"
                  className="path-slot-clear"
                  aria-label={`Clear ${label}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClear(index);
                    setQueries((current) => current.map((item, slot) => (slot === index ? "" : item)));
                    setHits([]);
                    setHitSlot(null);
                    setSearchedQuery(null);
                    setActive(index);
                  }}
                >
                  ×
                </button>
              )}
              {open && <SearchSuggest hits={hits} onPick={(hit) => pick(hit, index)} />}
            </div>
          );
        })}
      </div>
      <div className="toggle path-kind" role="tablist" aria-label="Path kind">
        <button type="button" role="tab" aria-selected={kind === "shortest"} onClick={() => onKind("shortest")}>
          Shortest
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "random"}
          aria-label={kind === "random" ? "Regenerate Random-ish" : undefined}
          onClick={() => {
            if (kind === "random") {
              setSpin((value) => value + 1);
              onRegenerate();
              return;
            }
            onKind("random");
          }}
        >
          Random-ish
          {kind === "random" && <RegenIcon spin={spin} />}
        </button>
        {ready && payload?.hops != null && <span className="path-hops">{hopText(payload)}</span>}
      </div>
      {ready && (
        <>
          <hr className="path-rule" />
          <section className="path-playlist">
            <h2>{stops[0] && stops[1] ? `Playlist from ${stops[0].name} to ${stops[1].name}` : "Playlist"}</h2>
            {empty ? (
              <div className={`path-empty${empty.tone === "plain" ? "" : " loading-note"}`}>
                <p>
                  {empty.title}
                  {empty.tone === "loading" ? <Ellipsis /> : null}
                </p>
                {empty.detail && <p className="path-empty-detail">{empty.detail}</p>}
              </div>
            ) : tracks.length === 0 ? (
              <div className="path-empty">
                <p>No releases on this path.</p>
              </div>
            ) : (
              <ScrollList count={tracks.length}>
                <ul className="rows">
                  {tracks.map((track, index) => (
                    <PlaylistRow
                      key={`${track.hopIndex}:${track.releaseId}:${track.title}`}
                      track={track}
                      thumbUrl={thumbs.get(track.releaseId) ?? null}
                      active={session?.index === index}
                      paused={session?.index === index ? session.paused : true}
                      busy={resolving === index}
                      missing={failed.includes(index)}
                      onOpen={onOpen}
                      onToggle={() => void playAt(index)}
                    />
                  ))}
                </ul>
              </ScrollList>
            )}
          </section>
        </>
      )}
    </>
  );
}

function hopText(payload: PathPayload): string {
  const count = payload.hops === 1 ? "1 hop" : `${payload.hops} hops`;
  if (payload.unchanged && payload.fallback === "shortest") return `${count} · only route`;
  if (payload.unchanged) return `${count} · same route`;
  if (payload.fallback === "shortest") return `${count} · shortest`;
  return count;
}

function RegenIcon({ spin }: { spin: number }) {
  return (
    <svg
      key={spin}
      className={`path-regen-icon${spin > 0 ? " spin" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 16h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const meta = [track.position, track.duration].filter(Boolean).join(" · ");
  return (
    <li
      className="playlist-row"
      onClick={() => {
        if (!busy) onToggle();
      }}
    >
      <PlayToggle
        paused={!showPause}
        busy={busy}
        error={missing && !active ? playbackProblemMessage("release", "no_video") : null}
        onToggle={onToggle}
      />
      <Thumb url={thumbUrl} name={track.releaseName} type="release" />
      <span className="playlist-copy">
        <strong>
          {track.artistId != null && track.artistName ? (
            <button
              type="button"
              className="text-button playlist-artist"
              onClick={(event) => {
                event.stopPropagation();
                onOpen("artist", track.artistId!);
              }}
            >
              {track.artistName}
            </button>
          ) : (
            track.artistName
          )}
          {track.artistName ? " – " : ""}
          {track.title}
        </strong>
        <small>
          {track.releaseName && (
            <button
              type="button"
              className="text-button playlist-release"
              onClick={(event) => {
                event.stopPropagation();
                onOpen("release", track.releaseId);
              }}
            >
              {track.releaseName}
            </button>
          )}
          {track.releaseName && meta ? " · " : ""}
          {meta}
        </small>
      </span>
    </li>
  );
}

function emptyCopy(
  stops: Array<SearchHit | null>,
  payload: PathPayload | null,
  error: string | null,
  loading: boolean,
): { title: string; detail?: string; tone: "plain" | "loading" | "error" } | null {
  const problem = pathProblemTitle(error);
  if (problem) return { title: problem, tone: "error" };
  if (stops.some((stop) => stop == null)) return { title: "Pick two entities to find a path from A to B.", tone: "plain" };
  if (loading) return { title: "Searching the catalog", tone: "loading" };
  if (payload && (payload.shortestHops == null || payload.nodes.length === 0)) {
    return {
      title: `No catalog path within ${payload.limit ?? PATH_MAX_HOPS} hops.`,
      detail: `They may still be connected by a longer chain; this mode only searches up to ${payload.limit ?? PATH_MAX_HOPS}.`,
      tone: "error",
    };
  }
  return null;
}

export function pathProblemTitle(error: string | null): string | null {
  if (error === "same_clique") return "Those are the same artist (aliases).";
  if (error === "same_label") return "That label is already the other stop.";
  if (error === "same_release") return "That release is already the other stop.";
  if (error === "timeout") return "The path search timed out.";
  if (error) return "The path search failed.";
  return null;
}
