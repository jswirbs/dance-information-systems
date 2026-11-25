import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DEFAULT_NODE_CAP, MAX_NODE_CAP, MIN_NODE_CAP } from "../src/shared/constants.js";
import type { EntityType, PathKind, Seed } from "../src/shared/types.js";
import { graphFor } from "./graph.js";
import { ensureImage } from "./images.js";
import { catalogPath, isQueryTimeout, PathRequestError } from "./path.js";
import { playbackFor } from "./playback.js";
import { entityDetail, related, search } from "./queries.js";
import { searchYouTube } from "./youtube.js";

const app = new Hono();
app.use("*", cors());

app.get("/api/search", async (c) => {
  return c.json(await search(c.req.query("q") ?? ""));
});

app.post("/api/related", async (c) => {
  const body = await c.req.json().catch(() => null);
  const seeds = parseSeeds(body?.seeds);
  const target = parseType(body?.target);
  if (!seeds || !target) return c.json({ error: "seeds and target are required" }, 400);
  const limit = clamp(body?.limit, 25);
  return c.json(await related(seeds, target, limit));
});

app.post("/api/path", async (c) => {
  const body = await c.req.json().catch(() => null);
  const stops = parseStops(body?.stops);
  const kind = parsePathKind(body?.kind);
  if (!stops || !kind) return c.json({ error: "stops and kind are required" }, 400);
  const seed = Number.isFinite(Number(body?.seed)) ? Math.round(Number(body.seed)) : Date.now();
  const avoid = typeof body?.avoid === "string" && body.avoid.length > 0 && body.avoid.length <= 2000 ? body.avoid : undefined;
  try {
    return c.json(await catalogPath(stops, kind, seed, avoid));
  } catch (error) {
    if (error instanceof PathRequestError) return c.json({ error: error.code }, 400);
    if (isQueryTimeout(error)) return c.json({ error: "timeout" }, 504);
    throw error;
  }
});

app.post("/api/graph", async (c) => {
  const body = await c.req.json().catch(() => null);
  const seeds = parseSeeds(body?.seeds);
  const target = parseType(body?.target);
  if (!seeds || !target) return c.json({ error: "seeds and target are required" }, 400);
  const nodeCap = clampRange(body?.nodeCap, DEFAULT_NODE_CAP, MIN_NODE_CAP, MAX_NODE_CAP);
  return c.json(await graphFor(seeds, target, nodeCap));
});

app.get("/api/entities/:type/:id/playback", async (c) => {
  const type = parseType(c.req.param("type"));
  const id = Number(c.req.param("id"));
  if (!type || !Number.isFinite(id)) return c.json({ error: "unknown entity" }, 400);
  const payload = await playbackFor(type, id);
  if (!payload) return c.json({ error: "not found" }, 404);
  return c.json(payload);
});

app.get("/api/entities/:type/:id", async (c) => {
  const type = parseType(c.req.param("type"));
  const id = Number(c.req.param("id"));
  if (!type || !Number.isFinite(id)) return c.json({ error: "unknown entity" }, 400);
  const detail = await entityDetail(type, id);
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});

app.get("/api/youtube-search", async (c) => {
  const q = c.req.query("q") ?? "";
  return c.json(await searchYouTube(q));
});

app.post("/api/entities/:type/:id/image", async (c) => {
  const type = parseType(c.req.param("type"));
  const id = Number(c.req.param("id"));
  if (!type || !Number.isFinite(id)) return c.json({ error: "unknown entity" }, 400);
  return c.json(await ensureImage(type, id));
});

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "127.0.0.1";
serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`API listening on http://${hostname}:${port}`);
});

function parseType(value: unknown): EntityType | null {
  return value === "artist" || value === "label" || value === "release" ? value : null;
}

function parseSeeds(value: unknown): Seed[] | null {
  return parseSeedList(value, 1);
}

function parseStops(value: unknown): Seed[] | null {
  return parseSeedList(value, 2);
}

function parseSeedList(value: unknown, min: number): Seed[] | null {
  if (!Array.isArray(value) || value.length < min) return null;
  const seeds: Seed[] = [];
  for (const item of value) {
    const type = parseType(item?.type);
    const id = Number(item?.id);
    if (!type || !Number.isFinite(id)) return null;
    seeds.push({ type, id });
  }
  return seeds;
}

function parsePathKind(value: unknown): PathKind | null {
  return value === "shortest" || value === "random" ? value : null;
}

function clamp(value: unknown, fallback: number): number {
  return clampRange(value, fallback, 1, 50);
}

function clampRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
