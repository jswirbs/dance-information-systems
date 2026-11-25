import { useEffect, useMemo, useState } from "react";
import { firstTitledTrackIndex, playbackProblemMessage, type PlaybackProblem } from "../../src/shared/playback";
import type { EntityDetail, EntityType, PlaybackPayload, PlaybackRelease } from "../../src/shared/types";
import { api } from "./api";
import { PlayToggle } from "./PlayToggle";
import { warmupYouTube } from "./PathPlayer";
import { playablesFromRelease, releaseSource } from "./queue";
import { usePlayer } from "./player";

const cache = new Map<string, Promise<PlaybackPayload>>();

function loadPlayback(type: EntityType, id: number): Promise<PlaybackPayload> {
  const key = `${type}:${id}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = api.playback(type, id).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

function rememberPlayback(type: EntityType, id: number, payload: PlaybackPayload) {
  cache.set(`${type}:${id}`, Promise.resolve(payload));
}

function releaseFromDetail(record: EntityDetail): PlaybackRelease {
  return {
    id: record.id,
    name: record.name,
    tracklist: record.tracklist,
    credits: record.credits,
    videos: record.videos,
  };
}

export function EntityPlayButton({
  type,
  id,
  name = "",
  record = null,
  className,
}: {
  type: EntityType;
  id: number;
  name?: string;
  record?: EntityDetail | null;
  className?: string;
}) {
  const local = useMemo(() => {
    if (type !== "release" || record?.type !== "release" || record.id !== id) return null;
    return { release: releaseFromDetail(record) };
  }, [type, id, record]);
  const [remote, setRemote] = useState<PlaybackPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  const player = usePlayer();

  useEffect(() => {
    if (local) {
      rememberPlayback(type, id, local);
      return;
    }
    let cancelled = false;
    setRemote(null);
    setMissing(false);
    loadPlayback(type, id).then(
      (payload) => {
        if (!cancelled) setRemote(payload);
      },
      () => {
        if (!cancelled) setMissing(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [type, id, local]);

  const payload = local ?? remote;
  const release = payload && "release" in payload ? payload.release : null;
  const items = useMemo(() => (release ? playablesFromRelease(release) : []), [release]);
  const start = release ? firstTitledTrackIndex(release.tracklist) : -1;
  const source = type === "release" ? releaseSource(id) : release ? releaseSource(release.id) : null;
  const { setQueue } = player;

  useEffect(() => {
    if (!source || start < 0) return;
    setQueue(source, items);
  }, [source, items, start, setQueue]);

  useEffect(() => {
    if (start >= 0) warmupYouTube();
  }, [start]);

  const session = source != null && player.session?.source === source ? player.session : null;
  const resolving = source != null && player.activity.resolving?.source === source ? player.activity.resolving.index : null;
  const failed = source != null ? (player.activity.failed[source] ?? []) : [];

  let problem: PlaybackProblem | null = null;
  if (missing) problem = "unavailable";
  else if (payload && "error" in payload) problem = "no_release";
  else if (release && start < 0) problem = "no_tracks";
  else if (session == null && start >= 0 && failed.includes(start)) problem = "no_video";

  const error = problem ? playbackProblemMessage(type, problem) : null;
  const retry = problem === "no_video" || problem === "unavailable";
  const showPause = session != null && !session.paused;
  const busy = starting || (session == null && resolving === start) || (session != null && resolving === session.index);

  async function toggle() {
    if (problem === "no_release" || problem === "no_tracks") return;
    const playing = player.session?.source === source ? player.session : null;
    if (playing && source) {
      await player.playAt(source, playing.index);
      return;
    }
    setStarting(true);
    try {
      const next = payload ?? (await loadPlayback(type, id).catch(() => null));
      if (!next) {
        setMissing(true);
        return;
      }
      if ("error" in next) {
        setRemote(next);
        return;
      }
      const queue = playablesFromRelease(next.release);
      const index = firstTitledTrackIndex(next.release.tracklist);
      if (index < 0) {
        setRemote(next);
        return;
      }
      const queueSource = releaseSource(next.release.id);
      setQueue(queueSource, queue);
      await player.playAt(queueSource, index);
    } finally {
      setStarting(false);
    }
  }

  return (
    <PlayToggle
      className={className}
      name={name}
      paused={!showPause}
      busy={busy}
      error={error}
      retry={retry}
      onToggle={() => void toggle()}
    />
  );
}
