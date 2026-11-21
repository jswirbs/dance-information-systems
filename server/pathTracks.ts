import { asNumber, asString, withSession } from "../src/db.js";
import { parseJson } from "./cypher.js";
import type { Credit, EntityType, GraphLinkKind, PathTrack, Track, VideoLink } from "../src/shared/types.js";
import { parseYouTubeId, titlesMatch } from "../src/shared/youtube.js";
import { closureIds } from "./queries.js";

const CREDIT_KINDS = new Set<GraphLinkKind>(["PRIMARY_ON", "APPEARS_ON", "REMIXED"]);

type WalkNode = { type: EntityType; id: number; name: string };
type WalkLink = { source: WalkNode; target: WalkNode; kind: GraphLinkKind };

type ReleaseAudio = {
  id: number;
  title: string;
  tracklist: Track[];
  credits: Credit[];
  videos: VideoLink[];
};

export async function tracksForWalk(nodes: WalkNode[], links: WalkLink[]): Promise<PathTrack[]> {
  const releaseIds = [...new Set(nodes.filter((node) => node.type === "release").map((node) => node.id))];
  if (releaseIds.length === 0) return [];
  const releases = await loadReleases(releaseIds);
  const cliques = new Map<number, Set<number>>();
  const tracks: PathTrack[] = [];
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]!;
    if (!CREDIT_KINDS.has(link.kind)) continue;
    const ends = creditEnds(link);
    if (!ends) continue;
    const release = releases.get(ends.release.id);
    if (!release) continue;
    let clique = cliques.get(ends.artist.id);
    if (!clique) {
      clique = new Set(await closureIds({ type: "artist", id: ends.artist.id }));
      cliques.set(ends.artist.id, clique);
    }
    const picked = pickTrack(release, clique, link.kind);
    if (!picked) continue;
    tracks.push({
      releaseId: release.id,
      releaseName: release.title || ends.release.name,
      artistId: ends.artist.id,
      artistName: ends.artist.name,
      title: picked.title,
      position: picked.position,
      duration: picked.duration,
      hopIndex: index,
      videoSrc: matchingVideoSrc(release.videos, picked.title),
      searchQuery: `${ends.artist.name} ${picked.title}`,
    });
  }
  return tracks;
}

function creditEnds(link: WalkLink): { artist: WalkNode; release: WalkNode } | null {
  const { source, target } = link;
  if (source.type === "artist" && target.type === "release") return { artist: source, release: target };
  if (source.type === "release" && target.type === "artist") return { artist: target, release: source };
  return null;
}

async function loadReleases(ids: number[]): Promise<Map<number, ReleaseAudio>> {
  const records = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (r:Release) WHERE r.discogsId IN $ids
       RETURN r.discogsId AS id, coalesce(r.title, "") AS title, r.tracklist AS tracklist, r.credits AS credits, r.videos AS videos`,
      { ids },
    );
    return result.records;
  });
  const map = new Map<number, ReleaseAudio>();
  for (const record of records) {
    const id = asNumber(record.get("id"));
    if (id == null) continue;
    map.set(id, {
      id,
      title: asString(record.get("title")) ?? "",
      tracklist: parseJson(record.get("tracklist"), []),
      credits: parseJson(record.get("credits"), []),
      videos: parseJson(record.get("videos"), []),
    });
  }
  return map;
}

function pickTrack(release: ReleaseAudio, clique: Set<number>, hopKind: GraphLinkKind | null): Track | null {
  const listed = release.tracklist.filter((track) => track.title?.trim());
  if (listed.length === 0) {
    const title = release.title.trim();
    return title ? { position: "", title, duration: "", artists: [] } : null;
  }
  if (clique.size === 0) return listed[0]!;
  const remix = hopKind === "REMIXED";
  const scored = listed
    .map((track, order) => ({ track, order, score: trackScore(track, release.credits, clique, remix) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  return scored[0]?.track ?? listed[0]!;
}

function trackScore(track: Track, credits: Credit[], clique: Set<number>, remix: boolean): number {
  let score = 0;
  if (track.artists.some((artist) => clique.has(artist.id))) score += 3;
  const related = credits.filter(
    (credit) => credit.scope === "track" && credit.track != null && titlesMatch(track.title, credit.track) && clique.has(credit.id),
  );
  if (related.length > 0) score += 2;
  if (remix && related.some((credit) => /\bremix\b/i.test(credit.role))) score += 4;
  return score;
}

function matchingVideoSrc(videos: VideoLink[], trackTitle: string): string | null {
  for (const video of videos) {
    if (!titlesMatch(trackTitle, video.title)) continue;
    if (parseYouTubeId(video.src)) return video.src;
  }
  return null;
}

