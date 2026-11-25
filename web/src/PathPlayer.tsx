import { useEffect, useRef, useState, type PointerEvent } from "react";

type YTPlayer = {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export function warmupYouTube(): void {
  void youtubeApi();
}

function youtubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector("script[src='https://www.youtube.com/iframe_api']")) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

export function YouTubePlayer({
  videoId,
  paused,
  canPrev,
  canNext,
  frameHidden = false,
  onEnded,
  onPrev,
  onNext,
  onPaused,
  onPlaying,
}: {
  videoId: string;
  paused: boolean;
  canPrev: boolean;
  canNext: boolean;
  frameHidden?: boolean;
  onEnded: () => void;
  onPrev: () => void;
  onNext: () => void;
  onPaused: () => void;
  onPlaying: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const videoRef = useRef(videoId);
  const loadedRef = useRef(videoId);
  const pausedRef = useRef(paused);
  const endedRef = useRef(onEnded);
  const pausedCb = useRef(onPaused);
  const playingCb = useRef(onPlaying);
  const scrubRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const readyRef = useRef(false);
  const seenPlaying = useRef(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  videoRef.current = videoId;
  pausedRef.current = paused;
  endedRef.current = onEnded;
  pausedCb.current = onPaused;
  playingCb.current = onPlaying;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    void youtubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      loadedRef.current = videoRef.current;
      seenPlaying.current = false;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId: loadedRef.current,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            if (!pausedRef.current) playerRef.current?.playVideo();
            syncTime();
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED) {
              seenPlaying.current = true;
              endedRef.current();
            } else if (event.data === YT.PlayerState.PLAYING) {
              seenPlaying.current = true;
              playingCb.current();
            } else if (event.data === YT.PlayerState.PAUSED) {
              if (seenPlaying.current) pausedCb.current();
              else if (!pausedRef.current) playerRef.current?.playVideo();
            }
            syncTime();
          },
        },
      });
    });
    const timer = window.setInterval(syncTime, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.loadVideoById || videoId === loadedRef.current) return;
    loadedRef.current = videoId;
    seenPlaying.current = false;
    setCurrent(0);
    setDuration(0);
    player.loadVideoById(videoId);
    if (!pausedRef.current) player.playVideo();
  }, [videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!readyRef.current || !player?.pauseVideo) return;
    if (paused) player.pauseVideo();
    else player.playVideo();
  }, [paused]);

  function syncTime() {
    const player = playerRef.current;
    if (!player?.getCurrentTime || dragging.current) return;
    const nextDuration = player.getDuration?.() ?? 0;
    const nextCurrent = player.getCurrentTime?.() ?? 0;
    if (Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
    if (Number.isFinite(nextCurrent) && nextCurrent >= 0) setCurrent(nextCurrent);
  }

  function seekTo(seconds: number) {
    const player = playerRef.current;
    const total = player?.getDuration?.() ?? duration;
    const next = Math.max(0, Math.min(total || seconds, seconds));
    setCurrent(next);
    player?.seekTo?.(next, true);
  }

  function timeAtPointer(event: PointerEvent<HTMLDivElement>) {
    const el = scrubRef.current;
    const total = playerRef.current?.getDuration?.() ?? duration;
    if (!el || total <= 0) return 0;
    const box = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    return ratio * total;
  }

  function onScrubDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTo(timeAtPointer(event));
  }

  function onScrubMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    seekTo(timeAtPointer(event));
  }

  function onScrubUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  return (
    <div className="path-player">
      <div className={`path-player-frame${frameHidden ? " is-hidden" : ""}`}>
        <div ref={hostRef} />
      </div>
      <div className="path-transport">
        <button type="button" aria-label="Previous track" disabled={!canPrev} onClick={onPrev}>
          <SkipIcon dir="back" />
        </button>
        <button
          type="button"
          aria-label={paused ? "Play" : "Pause"}
          onClick={() => (paused ? playingCb.current() : pausedCb.current())}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </button>
        <button type="button" aria-label="Next track" disabled={!canNext} onClick={onNext}>
          <SkipIcon dir="fwd" />
        </button>
        <div
          ref={scrubRef}
          className="path-scrub"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          <span className="path-scrub-played" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="path-time">
          {formatTime(current)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="8,5 20,12 8,19" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  );
}

export function BlockedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M8.2 15.8 15.8 8.2" />
    </svg>
  );
}

function SkipIcon({ dir }: { dir: "back" | "fwd" }) {
  if (dir === "back") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="12,5 2,12 12,19" />
        <polygon points="22,5 12,12 22,19" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="2,5 12,12 2,19" />
      <polygon points="12,5 22,12 12,19" />
    </svg>
  );
}
