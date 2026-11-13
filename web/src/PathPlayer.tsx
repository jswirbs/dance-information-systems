import { useEffect, useRef } from "react";

type YTPlayer = {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: { onStateChange?: (event: { data: number }) => void };
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

export function PathPlayer({
  videoId,
  paused,
  onEnded,
  onPaused,
  onPlaying,
}: {
  videoId: string;
  paused: boolean;
  onEnded: () => void;
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
      playerRef.current = new YT.Player(hostRef.current, {
        videoId: loadedRef.current,
        playerVars: {
          autoplay: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED) endedRef.current();
            if (event.data === YT.PlayerState.PAUSED) pausedCb.current();
            if (event.data === YT.PlayerState.PLAYING) playingCb.current();
          },
        },
      });
      if (pausedRef.current) playerRef.current.pauseVideo();
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.loadVideoById || videoId === loadedRef.current) return;
    loadedRef.current = videoId;
    player.loadVideoById(videoId);
  }, [videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player?.pauseVideo) return;
    if (paused) player.pauseVideo();
    else player.playVideo();
  }, [paused]);

  return (
    <div className="path-player">
      <div ref={hostRef} />
    </div>
  );
}
