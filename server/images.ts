import { asNumber, asString, write, withSession } from "../src/db.js";
import type { EntityType, ImageResult } from "../src/shared/types.js";

const MIN_GAP_MS = 1100;
let lastCallAt = 0;

export async function ensureImage(type: EntityType, id: number): Promise<ImageResult> {
  const current = await readImage(type, id);
  if (!current) return { imageUrl: null, thumbUrl: null, fetched: false };
  if (current.imageUrl) return { imageUrl: current.imageUrl, thumbUrl: current.thumbUrl, fetched: false };
  if (current.imageCount <= 0 || !process.env.DISCOGS_TOKEN) {
    return { imageUrl: null, thumbUrl: null, fetched: false };
  }

  const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();

  const base = (process.env.DISCOGS_API_BASE ?? "https://api.discogs.com").replace(/\/$/, "");
  const collection = type === "artist" ? "artists" : type === "label" ? "labels" : "releases";
  const response = await fetch(`${base}/${collection}/${id}`, {
    headers: {
      Authorization: `Discogs token=${process.env.DISCOGS_TOKEN}`,
      "User-Agent": process.env.DISCOGS_USER_AGENT ?? "DanceInformationSystems/0.1",
      Accept: "application/json",
    },
  });
  if (!response.ok) return { imageUrl: null, thumbUrl: null, fetched: true };

  const body = (await response.json()) as { images?: { type?: string; uri?: string; uri150?: string }[] };
  const images = body.images ?? [];
  const primary = images.find((image) => image.type === "primary") ?? images[0];
  const imageUrl = primary?.uri ?? null;
  const thumbUrl = primary?.uri150 ?? imageUrl;
  if (imageUrl) await storeImage(type, id, imageUrl, thumbUrl);
  return { imageUrl, thumbUrl, fetched: true };
}

async function readImage(type: EntityType, id: number): Promise<{ imageUrl: string | null; thumbUrl: string | null; imageCount: number } | null> {
  const label = type === "artist" ? "Artist" : type === "label" ? "Label" : "Release";
  return withSession(async (session) => {
    const result = await session.run(
      `MATCH (n:${label} {discogsId: $id}) RETURN n.imageUrl AS imageUrl, n.thumbUrl AS thumbUrl, n.imageCount AS imageCount`,
      { id },
    );
    const record = result.records[0];
    if (!record) return null;
    return {
      imageUrl: asString(record.get("imageUrl")),
      thumbUrl: asString(record.get("thumbUrl")),
      imageCount: asNumber(record.get("imageCount")) ?? 0,
    };
  });
}

async function storeImage(type: EntityType, id: number, imageUrl: string, thumbUrl: string | null): Promise<void> {
  const label = type === "artist" ? "Artist" : type === "label" ? "Label" : "Release";
  await write(async (tx) => {
    await tx.run(
      `MATCH (n:${label} {discogsId: $id}) SET n.imageUrl = $imageUrl, n.thumbUrl = $thumbUrl`,
      { id, imageUrl, thumbUrl },
    );
  });
}
