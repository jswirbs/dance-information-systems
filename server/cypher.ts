import type { EntityType } from "../src/shared/types.js";

export function neoLabel(type: EntityType): "Artist" | "Label" | "Release" {
  if (type === "artist") return "Artist";
  if (type === "label") return "Label";
  return "Release";
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Artist plus one undirected alias hop. Leaves `closure` in scope. */
export const ARTIST_CLOSURE = `MATCH (seed:Artist {discogsId: $id})
OPTIONAL MATCH (seed)-[:ALIAS_OF]-(alias:Artist)
WITH [n IN collect(DISTINCT seed) + collect(DISTINCT alias) WHERE n IS NOT NULL] AS closure`;

/** Group key for pressings of one master. ORDER BY the main release before collecting. */
export function masterKey(node: string): string {
  return `CASE WHEN coalesce(${node}.masterId, 0) > 0 THEN 'master:' + toString(${node}.masterId) ELSE 'release:' + toString(${node}.discogsId) END`;
}

/** Main release first, then the lowest Discogs id. Must run before `collect`. */
export function mainReleaseOrder(node: string): string {
  return `coalesce(${node}.isMainRelease, false) DESC, ${node}.discogsId ASC`;
}
