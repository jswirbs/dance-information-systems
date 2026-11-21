import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EntityType } from "../../src/shared/types";
import { YouTubePlayer } from "./PathPlayer";
import { resolveYouTubeId } from "./youtubeResolve";

export type PlayerSession = {
  source: string;
  index: number;
  videoId: string;
  paused: boolean;
  title: string;
  artists: PlayingArtist[];
  meta: string | null;
  releaseId: number | null;
  releaseName: string | null;
  canPrev: boolean;
  canNext: boolean;
};

export type PlayerStart = Omit<PlayerSession, "paused" | "meta" | "releaseId" | "releaseName"> & {
  paused?: boolean;
  meta?: string | null;
  releaseId?: number | null;
  releaseName?: string | null;
};

export type PlayingArtist = { id: number | null; name: string };

/** One row in a playback queue. Held on the provider so next and previous survive the list unmounting. */
export type Playable = {
  key: string;
  title: string;
  artists: PlayingArtist[];
  releaseId: number | null;
  releaseName: string | null;
  meta: string | null;
  videoSrc: string | null;
  searchQuery: string;
};

type QueueActivity = {
  resolving: { source: string; index: number } | null;
  failed: Record<string, number[]>;
};

type PlayerApi = {
  session: PlayerSession | null;
  videoOpen: boolean;
  setVideoOpen: (open: boolean) => void;
  play: (next: PlayerStart) => void;
  setPaused: (paused: boolean) => void;
  stop: (source?: string) => void;
  setQueue: (source: string, items: Playable[]) => void;
  playAt: (source: string, index: number) => Promise<boolean>;
  activity: QueueActivity;
};

const PlayerContext = createContext<PlayerApi | null>(null);

export function PlayerProvider({
  children,
  onOpen,
}: {
  children: ReactNode;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [videoOpen, setVideoOpen] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 901px)").matches,
  );
  const [activity, setActivity] = useState<QueueActivity>({ resolving: null, failed: {} });
  const queues = useRef(new Map<string, Playable[]>());
  const queueKeys = useRef(new Map<string, string>());
  const videoCache = useRef(new Map<string, string>());
  const loadToken = useRef(0);
  const resolvingRef = useRef<{ source: string; index: number } | null>(null);

  const play = useCallback((next: PlayerStart) => {
    setSession({
      source: next.source,
      index: next.index,
      videoId: next.videoId,
      paused: next.paused ?? false,
      title: next.title,
      artists: next.artists,
      meta: next.meta ?? null,
      releaseId: next.releaseId ?? null,
      releaseName: next.releaseName ?? null,
      canPrev: next.canPrev,
      canNext: next.canNext,
    });
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    setSession((current) => (current ? { ...current, paused } : current));
  }, []);

  const stop = useCallback((source?: string) => {
    setSession((current) => {
      if (!current || source == null || current.source === source) return null;
      return current;
    });
  }, []);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const setQueue = useCallback((source: string, items: Playable[]) => {
    queues.current.set(source, items);
    const key = items.map((item) => item.key).join("|");
    const previous = queueKeys.current.get(source);
    queueKeys.current.set(source, key);
    if (previous == null || previous === key) return;
    setActivity((current) => ({
      resolving: current.resolving?.source === source ? null : current.resolving,
      failed: { ...current.failed, [source]: [] },
    }));
    if (sessionRef.current?.source === source) stopRef.current(source);
  }, []);

  const playAt = useCallback(
    async (source: string, index: number): Promise<boolean> => {
      const current = sessionRef.current;
      if (resolvingRef.current?.source === source && resolvingRef.current.index === index) return false;
      if (current?.source === source && current.index === index) {
        setPaused(!current.paused);
        return true;
      }
      return loadAt(source, index);
    },
    [setPaused],
  );

  async function loadAt(source: string, index: number): Promise<boolean> {
    const track = queues.current.get(source)?.[index];
    if (!track || (!track.videoSrc && !track.searchQuery)) return false;
    const token = ++loadToken.current;
    resolvingRef.current = { source, index };
    setActivity((current) => ({ ...current, resolving: { source, index } }));
    const videoId = await resolveCached(track);
    if (token !== loadToken.current) return false;
    resolvingRef.current = null;
    setActivity((current) => ({ ...current, resolving: null }));
    if (!videoId) {
      setActivity((current) => {
        const failed = current.failed[source] ?? [];
        return {
          resolving: null,
          failed: { ...current.failed, [source]: failed.includes(index) ? failed : [...failed, index] },
        };
      });
      return false;
    }
    const items = queues.current.get(source) ?? [];
    play({
      source,
      index,
      videoId,
      title: track.title,
      artists: track.artists,
      releaseId: track.releaseId,
      releaseName: track.releaseName,
      meta: track.meta,
      canPrev: index > 0,
      canNext: index < items.length - 1,
    });
    return true;
  }

  async function resolveCached(track: Playable): Promise<string | null> {
    const cached = videoCache.current.get(track.key);
    if (cached) return cached;
    const videoId = await resolveYouTubeId(track.videoSrc, track.searchQuery);
    if (videoId) videoCache.current.set(track.key, videoId);
    return videoId;
  }

  async function skip(source: string, from: number, step: 1 | -1, closeIfNone: boolean) {
    const items = queues.current.get(source) ?? [];
    for (let index = from + step; index >= 0 && index < items.length; index += step) {
      if (await loadAt(source, index)) return;
    }
    if (closeIfNone) stop(source);
  }

  const value = useMemo(
    () => ({ session, videoOpen, setVideoOpen, play, setPaused, stop, setQueue, playAt, activity }),
    [session, videoOpen, play, setPaused, stop, setQueue, playAt, activity],
  );

  useEffect(() => {
    document.body.classList.toggle("has-player", session != null);
    document.body.classList.toggle("player-video-open", session != null && videoOpen);
    return () => {
      document.body.classList.remove("has-player", "player-video-open");
    };
  }, [session, videoOpen]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {session && (
        <NowPlaying
          session={session}
          videoOpen={videoOpen}
          onVideoOpen={setVideoOpen}
          onOpen={onOpen}
          onClose={() => stop()}
          onPaused={() => setPaused(true)}
          onPlaying={() => setPaused(false)}
          onPrev={() => {
            const current = sessionRef.current;
            if (current) void skip(current.source, current.index, -1, false);
          }}
          onNext={() => {
            const current = sessionRef.current;
            if (current) void skip(current.source, current.index, 1, false);
          }}
          onEnded={() => {
            const current = sessionRef.current;
            if (current) void skip(current.source, current.index, 1, true);
          }}
        />
      )}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer requires PlayerProvider");
  return value;
}

export function usePlayback(source: string, items: Playable[]) {
  const player = usePlayer();
  const { setQueue } = player;
  useEffect(() => {
    setQueue(source, items);
  }, [source, items, setQueue]);
  const session = player.session?.source === source ? player.session : null;
  return {
    session,
    resolving: player.activity.resolving?.source === source ? player.activity.resolving.index : null,
    failed: player.activity.failed[source] ?? [],
    playAt: (index: number) => player.playAt(source, index),
  };
}

const GENERIC_ARTIST = /^(various(\s+artists)?|unknown artist)$/i;

export type PlayingHeading = {
  artists: { id: number | null; label: string }[];
  separator: string;
  title: string;
};

/** Artist links, then the track title. A title that already starts with the artist keeps that prefix instead of repeating the name. */
export function playingHeading(trackTitle: string, artists: PlayingArtist[]): PlayingHeading {
  const title = trackTitle.trim();
  const named = artists
    .map((artist) => ({ id: artist.id, name: artist.name.trim() }))
    .filter((artist) => artist.name.length > 0 && !GENERIC_ARTIST.test(artist.name));
  if (named.length === 0) return { artists: [], separator: "", title };

  const joined = named.map((artist) => artist.name).join(", ");
  const group = named.length > 1 ? splitArtistPrefix(title, joined) : null;
  if (group) {
    return {
      artists: named.map((artist) => ({ id: artist.id, label: artist.name })),
      separator: group.separator,
      title: group.rest,
    };
  }
  for (const artist of named) {
    const names = [artist.name, ...artist.name.split(/[,&/]/)];
    for (const name of names) {
      const embedded = splitArtistPrefix(title, name);
      if (!embedded) continue;
      return { artists: [{ id: artist.id, label: embedded.matched }], separator: embedded.separator, title: embedded.rest };
    }
  }
  if (!title) return { artists: named.map((artist) => ({ id: artist.id, label: artist.name })), separator: "", title: "" };
  return { artists: named.map((artist) => ({ id: artist.id, label: artist.name })), separator: " – ", title };
}

function splitArtistPrefix(title: string, name: string): { matched: string; separator: string; rest: string } | null {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return null;
  const pattern = new RegExp(`^(${escapeRegExp(trimmed).replace(/\s+/g, "\\s+")})(\\s+[-–]\\s*|\\s*:\\s*)`, "i");
  const match = pattern.exec(title);
  if (!match) return null;
  return { matched: match[1] ?? "", separator: match[2] ?? "", rest: title.slice(match[0].length) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function PlayingTitle({
  title,
  artists,
  onOpen,
}: {
  title: string;
  artists: PlayingArtist[];
  onOpen: (type: EntityType, id: number) => void;
}) {
  const heading = playingHeading(title, artists);
  return (
    <>
      {heading.artists.map((artist, index) => (
        <Fragment key={`${artist.id ?? "name"}-${index}`}>
          {index > 0 ? ", " : null}
          {artist.id != null ? (
            <button type="button" className="text-button" onClick={() => onOpen("artist", artist.id!)}>
              {artist.label}
            </button>
          ) : (
            artist.label
          )}
        </Fragment>
      ))}
      {heading.separator}
      {heading.title}
    </>
  );
}

function NowPlaying({
  session,
  videoOpen,
  onVideoOpen,
  onOpen,
  onClose,
  onPaused,
  onPlaying,
  onPrev,
  onNext,
  onEnded,
}: {
  session: PlayerSession;
  videoOpen: boolean;
  onVideoOpen: (open: boolean) => void;
  onOpen: (type: EntityType, id: number) => void;
  onClose: () => void;
  onPaused: () => void;
  onPlaying: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
}) {
  return (
    <div className={`now-playing${videoOpen ? " video-open" : ""}`}>
      <div className="now-playing-head">
        <span className="now-playing-copy">
          <strong>
            <PlayingTitle title={session.title} artists={session.artists} onOpen={onOpen} />
          </strong>
          {(session.releaseName || session.meta) && (
            <small>
              {session.releaseName && session.releaseId != null ? (
                <button type="button" className="text-button" onClick={() => onOpen("release", session.releaseId!)}>
                  {session.releaseName}
                </button>
              ) : (
                session.releaseName
              )}
              {session.releaseName && session.meta ? " · " : null}
              {session.meta}
            </small>
          )}
        </span>
        <button
          type="button"
          className="now-playing-tool"
          aria-label={videoOpen ? "Hide video" : "Show video"}
          aria-expanded={videoOpen}
          onClick={() => onVideoOpen(!videoOpen)}
        >
          {videoOpen ? <CollapseVideoIcon /> : <ExpandVideoIcon />}
        </button>
        <button type="button" className="now-playing-tool" aria-label="Stop playback" onClick={onClose}>
          ×
        </button>
      </div>
      <YouTubePlayer
        videoId={session.videoId}
        paused={session.paused}
        canPrev={session.canPrev}
        canNext={session.canNext}
        frameHidden={!videoOpen}
        onEnded={onEnded}
        onPrev={onPrev}
        onNext={onNext}
        onPaused={onPaused}
        onPlaying={onPlaying}
      />
    </div>
  );
}

function ExpandVideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" />
    </svg>
  );
}

function CollapseVideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4v4H4M16 4v4h4M4 16h4v4M20 16h-4v4" />
    </svg>
  );
}
