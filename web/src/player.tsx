import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EntityType } from "../../src/shared/types";
import { YouTubePlayer } from "./PathPlayer";

export type PlayerSession = {
  source: string;
  index: number;
  videoId: string;
  paused: boolean;
  title: string;
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

type QueueHandlers = {
  prev: () => void;
  next: () => void;
  ended: () => void;
};

type PlayerApi = {
  session: PlayerSession | null;
  videoOpen: boolean;
  setVideoOpen: (open: boolean) => void;
  play: (next: PlayerStart) => void;
  setPaused: (paused: boolean) => void;
  stop: (source?: string) => void;
  bind: (source: string, handlers: QueueHandlers) => () => void;
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
  const handlers = useRef(new Map<string, QueueHandlers>());

  const play = useCallback((next: PlayerStart) => {
    setSession({
      source: next.source,
      index: next.index,
      videoId: next.videoId,
      paused: next.paused ?? false,
      title: next.title,
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

  const bind = useCallback((source: string, next: QueueHandlers) => {
    handlers.current.set(source, next);
    return () => {
      if (handlers.current.get(source) === next) handlers.current.delete(source);
    };
  }, []);

  const run = useCallback((kind: keyof QueueHandlers) => {
    const source = sessionRef.current?.source;
    if (!source) return;
    const fn = handlers.current.get(source)?.[kind];
    if (fn) fn();
    else if (kind === "ended") setPaused(true);
  }, [setPaused]);

  const value = useMemo(
    () => ({ session, videoOpen, setVideoOpen, play, setPaused, stop, bind }),
    [session, videoOpen, play, setPaused, stop, bind],
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
          onPrev={() => run("prev")}
          onNext={() => run("next")}
          onEnded={() => run("ended")}
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

const GENERIC_ARTIST = /^(various(\s+artists)?|unknown artist)$/i;

export function playingTitle(trackTitle: string, artistName?: string | null): string {
  const title = trackTitle.trim();
  const artist = artistName?.trim() ?? "";
  if (!title) return artist;
  if (!artist || GENERIC_ARTIST.test(artist) || titleHasArtist(title, artist)) return title;
  return `${artist} – ${title}`;
}

function titleHasArtist(title: string, artist: string): boolean {
  const foldedTitle = foldName(title);
  const names = [artist, ...artist.split(/,|&|\//)].map(foldName).filter((name) => name.length > 1);
  return names.some((name) => foldedTitle.startsWith(`${name} -`) || foldedTitle.startsWith(`${name} –`) || foldedTitle.startsWith(`${name}:`));
}

function foldName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
          <strong>{session.title}</strong>
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
