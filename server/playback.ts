import { asNumber, asString, withSession } from "../src/db.js";
import type { Credit, EntityType, PlaybackPayload, PlaybackRelease, Track, VideoLink } from "../src/shared/types.js";
import { ARTIST_CLOSURE, parseJson } from "./cypher.js";

const RELEASE_FIELDS = `r.discogsId AS id, coalesce(r.title, "") AS name, r.tracklist AS tracklist, r.credits AS credits, r.videos AS videos`;

/** Newest year, then the released date, then the Discogs id. Null relationships sort last. */
const LATEST = `r IS NULL, coalesce(r.year, -1) DESC, coalesce(r.released, "") DESC, r.discogsId DESC`;

export async function playbackFor(type: EntityType, id: number): Promise<PlaybackPayload | null> {
  const query =
    type === "release"
      ? `MATCH (r:Release {discogsId: $id}) RETURN ${RELEASE_FIELDS}`
      : type === "label"
        ? `MATCH (seed:Label {discogsId: $id})
           OPTIONAL MATCH (seed)-[:ISSUED]->(r:Release)
           RETURN ${RELEASE_FIELDS}
           ORDER BY ${LATEST}
           LIMIT 1`
        : `${ARTIST_CLOSURE}
           UNWIND closure AS artist
           OPTIONAL MATCH (artist)-[:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release)
           RETURN ${RELEASE_FIELDS}
           ORDER BY ${LATEST}
           LIMIT 1`;
  const records = await withSession(async (session) => {
    const result = await session.run(query, { id });
    return result.records;
  });
  const record = records[0];
  if (!record) return null;
  const releaseId = asNumber(record.get("id"));
  if (releaseId == null) return { error: "no_release" };
  const release: PlaybackRelease = {
    id: releaseId,
    name: asString(record.get("name")) ?? "",
    tracklist: parseJson<Track[]>(record.get("tracklist"), []),
    credits: parseJson<Credit[]>(record.get("credits"), []),
    videos: parseJson<VideoLink[]>(record.get("videos"), []),
  };
  return { release };
}
