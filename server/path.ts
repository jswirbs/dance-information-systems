import { asNumber, asString, asStrings, withSession } from "../src/db.js";
import { PATH_MAX_HOPS, PATH_RANDOM_MIN, PATH_RANDOM_TRIES } from "../src/shared/constants.js";
import type {
  EntityType,
  GraphLink,
  GraphLinkKind,
  GraphNode,
  PathKind,
  PathPayload,
  RelatedRow,
  Seed,
} from "../src/shared/types.js";
import { tracksForWalk } from "./pathTracks.js";
import { closureIds, lookupName } from "./queries.js";

const RELS = "ISSUED|PRIMARY_ON|APPEARS_ON|REMIXED|ALIAS_OF|SUBLABEL_OF|MEMBER_OF";

export class PathRequestError extends Error {
  constructor(
    readonly code: "same_clique" | "need_stops",
    message: string,
  ) {
    super(message);
  }
}

type WalkNode = {
  type: EntityType;
  id: number;
  name: string;
  thumbUrl: string | null;
  year: number | null;
  country: string | null;
  genres: string[];
  styles: string[];
};

type WalkLink = { source: WalkNode; target: WalkNode; kind: GraphLinkKind; startId: number | null };

type Walk = { nodes: WalkNode[]; links: WalkLink[] };

export async function catalogPath(stops: Seed[], kind: PathKind, seed = Date.now()): Promise<PathPayload> {
  if (stops.length < 2) throw new PathRequestError("need_stops", "at least two stops are required");
  const closures = await Promise.all(stops.map((stop) => closureIds(stop)));
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      if (stops[i]!.type === stops[j]!.type && closures[i]!.some((id) => closures[j]!.includes(id))) {
        throw new PathRequestError("same_clique", "stops share an alias clique");
      }
    }
  }

  const empty = emptyPath();
  const shortestSegments: Walk[] = [];
  const chosen: Walk[] = [];
  let fellBack = false;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const pair = await shortestPair(stops[i]!, stops[i + 1]!);
    if (!pair) return empty;
    shortestSegments.push(pair);
    if (kind === "random") {
      const randomized = await randomizePair(stops[i]!, stops[i + 1]!, pair, seed + i * 997);
      chosen.push(randomized.walk);
      if (randomized.fallback) fellBack = true;
    } else {
      chosen.push(pair);
    }
  }

  const shortestJoined = joinWalks(shortestSegments);
  const chosenJoined = joinWalks(chosen);
  if (!shortestJoined || !chosenJoined) return empty;
  const shortestWalk = await attachTerminals(shortestJoined, stops);
  const walk = await attachTerminals(chosenJoined, stops);
  return toPayload(walk, shortestWalk.links.length, stops, kind === "random" && fellBack ? "shortest" : undefined);
}

function emptyPath(): PathPayload {
  return { hops: null, shortestHops: null, limit: PATH_MAX_HOPS, nodes: [], links: [], rows: [], tracks: [] };
}

async function shortestPair(from: Seed, to: Seed): Promise<Walk | null> {
  const [startIds, endIds] = await Promise.all([closureIds(from), closureIds(to)]);
  const records = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (start:${neoLabel(from.type)})
       WHERE start.discogsId IN $startIds
       MATCH (end:${neoLabel(to.type)})
       WHERE end.discogsId IN $endIds AND start <> end
       MATCH p = SHORTEST 1 (start)
         ((n)-[:${RELS}]-(m)
           WHERE m = end OR (coalesce(m.bridge, false) = false AND coalesce(m.denied, false) = false)
         ){1,${PATH_MAX_HOPS}}
         (end)
       WITH p, length(p) AS hops
       ORDER BY hops ASC
       LIMIT 1
       RETURN [node IN nodes(p) | {
         labels: labels(node),
         id: node.discogsId,
         name: coalesce(node.name, node.title),
         thumbUrl: node.thumbUrl,
         year: node.year,
         country: node.country,
         genres: node.genres,
         styles: node.styles
       }] AS nodes,
       [rel IN relationships(p) | { kind: type(rel), start: startNode(rel).discogsId }] AS kinds`,
      { startIds, endIds },
      { timeout: 20_000 },
    );
    return result.records;
  });
  const record = records[0];
  if (!record) return null;
  return walkFrom(record.get("nodes"), record.get("kinds"));
}

async function randomizePair(
  from: Seed,
  to: Seed,
  shortest: Walk,
  seed: number,
): Promise<{ walk: Walk; fallback: boolean }> {
  const n = shortest.links.length;
  const hMax = Math.max(PATH_RANDOM_MIN, 2 * n);
  const random = mulberry32(seed >>> 0);
  const spine = new Set(shortest.nodes.map(keyOf));
  for (let attempt = 0; attempt < PATH_RANDOM_TRIES; attempt += 1) {
    const origin = pickOrigin(shortest.nodes, random);
    const neighbors = await neighborsOf(origin);
    const preferred = neighbors.filter(
      (node) => (node.type === "release" || node.type === "label") && !spine.has(keyOf(node)),
    );
    const pool = preferred.length > 0 ? preferred : neighbors.filter((node) => !spine.has(keyOf(node)));
    if (pool.length === 0) continue;
    const waypoint = pool[Math.floor(random() * pool.length)]!;
    if (keyOf(waypoint) === keyOf({ type: from.type, id: from.id }) || keyOf(waypoint) === keyOf({ type: to.type, id: to.id })) {
      continue;
    }
    const left = await shortestPair(from, { type: waypoint.type, id: waypoint.id });
    const right = await shortestPair({ type: waypoint.type, id: waypoint.id }, to);
    if (!left || !right) continue;
    const joined = joinWalks([left, right]);
    if (!joined) continue;
    const h = joined.links.length;
    if (h > n && h <= hMax && uniqueNodes(joined.nodes)) return { walk: joined, fallback: false };
  }
  return { walk: shortest, fallback: true };
}

function pickOrigin(nodes: WalkNode[], random: () => number): WalkNode {
  if (nodes.length <= 2) return random() < 0.5 ? nodes[0]! : nodes[nodes.length - 1]!;
  return nodes[1 + Math.floor(random() * (nodes.length - 2))]!;
}

async function neighborsOf(node: WalkNode): Promise<WalkNode[]> {
  const records = await withSession(async (session) => {
    const result = await session.run(
      `MATCH (n:${neoLabel(node.type)} {discogsId: $id})
       MATCH (n)-[:${RELS}]-(m)
       WHERE m <> n
         AND coalesce(m.bridge, false) = false
         AND coalesce(m.denied, false) = false
       RETURN DISTINCT labels(m) AS labels,
              m.discogsId AS id,
              coalesce(m.name, m.title) AS name,
              m.thumbUrl AS thumbUrl,
              m.year AS year,
              m.country AS country,
              m.genres AS genres,
              m.styles AS styles
       LIMIT 80`,
      { id: node.id },
    );
    return result.records;
  });
  return records
    .map((record) =>
      nodeFromProps({
        labels: record.get("labels"),
        id: record.get("id"),
        name: record.get("name"),
        thumbUrl: record.get("thumbUrl"),
        year: record.get("year"),
        country: record.get("country"),
        genres: record.get("genres"),
        styles: record.get("styles"),
      }),
    )
    .filter((item): item is WalkNode => item != null && keyOf(item) !== keyOf(node));
}

async function attachTerminals(walk: Walk, stops: Seed[]): Promise<Walk> {
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  let nodes = [...walk.nodes];
  let links = [...walk.links];
  if (nodes[0] && (nodes[0].type !== first.type || nodes[0].id !== first.id)) {
    const start = await describe(first);
    links = [{ source: start, target: nodes[0], kind: "ALIAS_OF", startId: start.id }, ...links];
    nodes = [start, ...nodes];
  }
  const end = nodes[nodes.length - 1];
  if (end && (end.type !== last.type || end.id !== last.id)) {
    const finish = await describe(last);
    links = [...links, { source: end, target: finish, kind: "ALIAS_OF", startId: end.id }];
    nodes = [...nodes, finish];
  }
  return { nodes, links };
}

async function describe(seed: Seed): Promise<WalkNode> {
  const records = await withSession(async (session) => {
    const field = seed.type === "release" ? "n.title" : "n.name";
    const result = await session.run(
      `MATCH (n:${neoLabel(seed.type)} {discogsId: $id})
       RETURN ${field} AS name, n.thumbUrl AS thumbUrl, n.year AS year, n.country AS country,
              n.genres AS genres, n.styles AS styles`,
      { id: seed.id },
    );
    return result.records;
  });
  const record = records[0];
  return {
    type: seed.type,
    id: seed.id,
    name: record ? String(record.get("name")) : await lookupName(seed),
    thumbUrl: record ? asString(record.get("thumbUrl")) : null,
    year: record ? asNumber(record.get("year")) : null,
    country: record ? asString(record.get("country")) : null,
    genres: record ? asStrings(record.get("genres")) : [],
    styles: record ? asStrings(record.get("styles")) : [],
  };
}

function joinWalks(segments: Walk[]): Walk | null {
  if (segments.length === 0) return null;
  const nodes = [...segments[0]!.nodes];
  const links = [...segments[0]!.links];
  for (const segment of segments.slice(1)) {
    const joint = nodes[nodes.length - 1];
    const head = segment.nodes[0];
    if (!joint || !head || keyOf(joint) !== keyOf(head)) return null;
    const seen = new Set(nodes.map(keyOf));
    for (const node of segment.nodes.slice(1)) {
      if (seen.has(keyOf(node))) return null;
      nodes.push(node);
    }
    links.push(...segment.links);
  }
  return uniqueNodes(nodes) ? { nodes, links } : null;
}

function uniqueNodes(nodes: WalkNode[]): boolean {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(keyOf(node))) return false;
    seen.add(keyOf(node));
  }
  return true;
}

function walkFrom(rawNodes: unknown, rawKinds: unknown): Walk | null {
  if (!Array.isArray(rawNodes) || !Array.isArray(rawKinds)) return null;
  const nodes = rawNodes.map(nodeFromProps).filter((node): node is WalkNode => node != null);
  if (nodes.length < 2 || rawKinds.length !== nodes.length - 1) return null;
  const links: WalkLink[] = [];
  for (let i = 0; i < rawKinds.length; i += 1) {
    const hop = hopFromRaw(rawKinds[i]);
    if (!hop) return null;
    links.push({ source: nodes[i]!, target: nodes[i + 1]!, kind: hop.kind, startId: hop.startId });
  }
  return { nodes, links };
}

function nodeFromProps(value: unknown): WalkNode | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const type = typeFromLabels(row.labels);
  const id = asNumber(row.id);
  const name = asString(row.name);
  if (!type || id == null || !name) return null;
  return {
    type,
    id,
    name,
    thumbUrl: asString(row.thumbUrl),
    year: asNumber(row.year),
    country: asString(row.country),
    genres: asStrings(row.genres),
    styles: asStrings(row.styles),
  };
}

function typeFromLabels(value: unknown): EntityType | null {
  const labels = Array.isArray(value) ? value.map(String) : [];
  if (labels.includes("Artist")) return "artist";
  if (labels.includes("Label")) return "label";
  if (labels.includes("Release")) return "release";
  return null;
}

function hopFromRaw(value: unknown): { kind: GraphLinkKind; startId: number | null } | null {
  if (typeof value === "string") {
    const kind = asLinkKind(value);
    return kind ? { kind, startId: null } : null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const kind = asLinkKind(row.kind);
  if (!kind) return null;
  return { kind, startId: asNumber(row.start) };
}

function asLinkKind(value: unknown): GraphLinkKind | null {
  const kind = String(value);
  if (
    kind === "ISSUED" ||
    kind === "PRIMARY_ON" ||
    kind === "APPEARS_ON" ||
    kind === "REMIXED" ||
    kind === "ALIAS_OF" ||
    kind === "SUBLABEL_OF" ||
    kind === "MEMBER_OF"
  ) {
    return kind;
  }
  return null;
}

async function toPayload(walk: Walk, shortestHops: number, stops: Seed[], fallback?: "shortest"): Promise<PathPayload> {
  const terminals = new Set(stops.map((stop) => `${stop.type}:${stop.id}`));
  const nodes: GraphNode[] = walk.nodes.map((node) => ({
    id: keyOf(node),
    entityType: node.type,
    discogsId: node.id,
    name: node.name,
    seed: terminals.has(keyOf(node)),
  }));
  const links: GraphLink[] = walk.links.map((link) => ({
    source: keyOf(link.source),
    target: keyOf(link.target),
    kind: link.kind,
  }));
  const rows: RelatedRow[] = walk.nodes.map((node, index) => {
    const previous = index === 0 ? null : walk.nodes[index - 1]!;
    const kind = index === 0 ? null : walk.links[index - 1]!.kind;
    const reason = previous && kind ? hopReason(previous, node, kind, walk.links[index - 1]!.startId) : "";
    return {
      type: node.type,
      id: node.id,
      name: node.name,
      score: index + 1,
      reason,
      reasons: previous && kind ? [{ seedName: previous.name, text: reason }] : [],
      thumbUrl: node.thumbUrl,
      year: node.year,
      country: node.country,
      genres: node.genres,
      styles: node.styles,
    };
  });
  return {
    hops: walk.links.length,
    shortestHops,
    limit: PATH_MAX_HOPS,
    nodes,
    links,
    rows,
    tracks: await tracksForWalk(walk.nodes, walk.links),
    ...(fallback ? { fallback } : {}),
  };
}

function hopReason(previous: WalkNode, current: WalkNode, kind: GraphLinkKind, startId: number | null): string {
  if (kind === "PRIMARY_ON" || kind === "APPEARS_ON") {
    const verb = kind === "PRIMARY_ON" ? "credited on" : "appears on";
    if (current.type === "release") return `${previous.name} ${verb} this`;
    if (previous.type === "release") return `${verb} ${previous.name}`;
  }
  if (kind === "REMIXED") {
    if (current.type === "release") return `remixed by ${previous.name}`;
    if (previous.type === "release") return `remixed ${previous.name}`;
  }
  if (kind === "ISSUED") {
    if (current.type === "release") return `issued by ${previous.name}`;
    if (previous.type === "release") return `issued ${previous.name}`;
  }
  if (kind === "ALIAS_OF") return `alias of ${previous.name}`;
  if (kind === "MEMBER_OF") {
    if (startId === previous.id) return `${previous.name} is a member`;
    return `member of ${previous.name}`;
  }
  if (kind === "SUBLABEL_OF") {
    if (startId === previous.id) return `parent of ${previous.name}`;
    return `sublabel of ${previous.name}`;
  }
  return `via ${kind.toLowerCase().replaceAll("_", " ")} · ${previous.name}`;
}

function keyOf(node: { type: EntityType; id: number }): string {
  return `${node.type}:${node.id}`;
}

function neoLabel(type: EntityType): string {
  if (type === "artist") return "Artist";
  if (type === "label") return "Label";
  return "Release";
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
