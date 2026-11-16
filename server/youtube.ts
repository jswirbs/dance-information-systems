import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { youtubeSearchUrl } from "../src/shared/youtube.js";

const CACHE_PATH = path.join(process.cwd(), ".cache", "youtube-search.json");
const TIMEOUT_MS = 25_000;
const ID = /^[\w-]{11}$/;

const cache = loadCache();
const inflight = new Map<string, Promise<string | null>>();

export type YouTubeSearchResult = {
  videoId: string | null;
  searchUrl: string;
};

export async function searchYouTube(query: string): Promise<YouTubeSearchResult> {
  const trimmed = query.trim();
  const searchUrl = youtubeSearchUrl(trimmed);
  if (!trimmed) return { videoId: null, searchUrl };
  const cached = cache.get(trimmed);
  if (cached) return { videoId: cached, searchUrl };
  const pending = inflight.get(trimmed);
  if (pending) return { videoId: await pending, searchUrl };
  const lookup = searchYtDlp(trimmed).finally(() => inflight.delete(trimmed));
  inflight.set(trimmed, lookup);
  const videoId = await lookup;
  if (videoId) {
    cache.set(trimmed, videoId);
    saveCache();
  }
  return { videoId, searchUrl };
}

function searchYtDlp(query: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "yt-dlp",
      ["--flat-playlist", "--no-warnings", "--print", "%(id)s", `ytsearch1:${query}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
      resolve(id);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      const id = stdout.trim().split(/\s+/)[0] ?? "";
      finish(ID.test(id) ? id : null);
    });
  });
}

function loadCache(): Map<string, string> {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return new Map();
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && ID.test(entry[1]),
    );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveCache(): void {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
}
