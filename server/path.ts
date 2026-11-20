import { asNumber, asString, asStrings, withSession } from "../src/db.js";
import { PATH_MAX_HOPS, PATH_RANDOM_MIN } from "../src/shared/constants.js";
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

const RANDOM_ATTEMPTS = 4;

export async function catalogPath(stops: Seed[], kind: PathKind, seed = Date.now(), avoid?: string): Promise<PathPayload> {
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
  for (let i = 0; i < stops.length - 1; i += 1) {
    const pair = await shortestPair(stops[i]!, stops[i + 1]!);
    if (!pair) return empty;
    shortestSegments.push(pair);
  }
  const shortestJoined = joinWalks(shortestSegments);
  if (!shortestJoined) return empty;
  const shortestWalk = await attachTerminals(shortestJoined, stops);
  if (kind !== "random") return toPayload(shortestWalk, shortestWalk.links.length, stops);

  const attempts = avoid ? RANDOM_ATTEMPTS : 1;
  let different: { walk: Walk; fellBack: boolean } | null = null;
  let repeated: { walk: Walk; fellBack: boolean } | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const trySeed = (seed + attempt * 0x9e3779b1) >>> 0;
    const chosen: Walk[] = [];
    let fellBack = false;
    for (let i = 0; i < shortestSegments.length; i += 1) {
      const randomized = await randomizePair(shortestSegments[i]!, trySeed + i * 997);
      chosen.push(randomized.walk);
      if (randomized.fallback) fellBack = true;
    }
    const chosenJoined = joinWalks(chosen);
    if (!chosenJoined) continue;
    const walk = await attachTerminals(chosenJoined, stops);
    const signature = walk.nodes.map((node) => keyOf(node)).join(">");
    if (avoid != null && signature === avoid) {
      repeated = { walk, fellBack };
      continue;
    }
    different = { walk, fellBack };
    if (!fellBack) break;
  }
  const chosenWalk = different ?? repeated;
  if (!chosenWalk) return empty;
  return toPayload(
    chosenWalk.walk,
    shortestWalk.links.length,
    stops,
    chosenWalk.fellBack ? "shortest" : undefined,
    different == null,
  );
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

const CORRIDOR_POOL = 40;
const CORRIDOR_KEEP = 12;
const OUTER_RELEASES = 16;
const OUTER_ARTISTS = 8;
const OUTER_KEEP = 8;
const DETOUR_BRANCH = 6;
const WALK_STEP_BUDGET = 2500;

type Adj = { key: string; kind: GraphLinkKind; startId: number | null };
type Corridor = { nodes: Map<string, WalkNode>; adj: Map<string, Adj[]> };
type SeenEdge = { fromKey: string; to: WalkNode; kind: GraphLinkKind; startId: number | null };

// A longer simple path inside a corridor around the shortest path: the spine,
// a sample of its neighbors, and one hop further out. Distances are hops to
// the end inside that corridor. The walk prefers steps that get closer, takes
// a sideways or outward step often enough to leave the geodesic, and boosts
// releases so the playlist has tracks.
async function randomizePair(shortest: Walk, seed: number): Promise<{ walk: Walk; fallback: boolean }> {
  const n = shortest.links.length;
  const start = shortest.nodes[0];
  const end = shortest.nodes[shortest.nodes.length - 1];
  if (!start || !end || n < 1) return { walk: shortest, fallback: true };
  const hMax = Math.max(PATH_RANDOM_MIN, 2 * n);
  const random = mulberry32(seed >>> 0);
  const corridor = await loadCorridor(shortest, random);
  const keys = biasedWalk(corridor, keyOf(start), keyOf(end), n, hMax, random);
  if (!keys) return { walk: shortest, fallback: true };
  const nodes: WalkNode[] = [];
  for (const key of keys) {
    const node = corridor.nodes.get(key);
    if (!node) return { walk: shortest, fallback: true };
    nodes.push(node);
  }
  const links: WalkLink[] = [];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const edge = corridor.adj.get(keys[i]!)?.find((item) => item.key === keys[i + 1]);
    if (!edge) return { walk: shortest, fallback: true };
    links.push({ source: nodes[i]!, target: nodes[i + 1]!, kind: edge.kind, startId: edge.startId });
  }
  return { walk: { nodes, links }, fallback: false };
}

async function loadCorridor(shortest: Walk, random: () => number): Promise<Corridor> {
  const corridor: Corridor = { nodes: new Map(), adj: new Map() };
  for (const node of shortest.nodes) corridor.nodes.set(keyOf(node), node);
  for (const link of shortest.links) connect(corridor, link.source, link.target, link.kind, link.startId);

  const spineKeys = new Set(shortest.nodes.map(keyOf));
  const aroundSpine = keptEdges(await neighborPool(shortest.nodes), shortest.nodes, spineKeys, CORRIDOR_KEEP, random);
  for (const edge of aroundSpine) {
    const from = corridor.nodes.get(edge.fromKey);
    if (from) connect(corridor, from, edge.to, edge.kind, edge.startId);
  }

  const hosts = outerHosts(aroundSpine, spineKeys, random);
  const present = new Set(corridor.nodes.keys());
  const outer = keptEdges(await neighborPool(hosts), hosts, present, OUTER_KEEP, random);
  for (const edge of outer) {
    const from = corridor.nodes.get(edge.fromKey);
    if (from) connect(corridor, from, edge.to, edge.kind, edge.startId);
  }
  return corridor;
}

async function neighborPool(hosts: WalkNode[]): Promise<SeenEdge[]> {
  const ids = new Map<EntityType, number[]>();
  for (const host of hosts) {
    const list = ids.get(host.type) ?? [];
    list.push(host.id);
    ids.set(host.type, list);
  }
  if (ids.size === 0) return [];
  return withSession(async (session) => {
    const edges: SeenEdge[] = [];
    for (const [type, list] of ids) {
      const result = await session.run(
        `UNWIND $ids AS srcId
         MATCH (n:${neoLabel(type)} {discogsId: srcId})
         CALL {
           WITH n
           MATCH (n)-[rel:${RELS}]-(m)
           WHERE m <> n
             AND coalesce(m.bridge, false) = false
             AND coalesce(m.denied, false) = false
           RETURN m, type(rel) AS kind, startNode(rel).discogsId AS startId
           LIMIT ${CORRIDOR_POOL}
         }
         RETURN srcId,
                labels(m) AS labels,
                m.discogsId AS id,
                coalesce(m.name, m.title) AS name,
                m.thumbUrl AS thumbUrl,
                m.year AS year,
                m.country AS country,
                m.genres AS genres,
                m.styles AS styles,
                kind,
                startId`,
        { ids: list },
        { timeout: 15_000 },
      );
      for (const record of result.records) {
        const srcId = asNumber(record.get("srcId"));
        const kind = asLinkKind(record.get("kind"));
        const to = nodeFromProps({
          labels: record.get("labels"),
          id: record.get("id"),
          name: record.get("name"),
          thumbUrl: record.get("thumbUrl"),
          year: record.get("year"),
          country: record.get("country"),
          genres: record.get("genres"),
          styles: record.get("styles"),
        });
        // Alias edges stay only when the shortest path already used one. A detour
        // through the alias clique is the same artist under other names.
        if (srcId == null || !kind || !to || kind === "ALIAS_OF") continue;
        edges.push({ fromKey: `${type}:${srcId}`, to, kind, startId: asNumber(record.get("startId")) });
      }
    }
    return edges;
  });
}

function keptEdges(
  pool: SeenEdge[],
  hosts: WalkNode[],
  existing: Set<string>,
  keep: number,
  random: () => number,
): SeenEdge[] {
  const grouped = new Map<string, SeenEdge[]>();
  for (const edge of pool) {
    const list = grouped.get(edge.fromKey) ?? [];
    const prior = list.find((item) => keyOf(item.to) === keyOf(edge.to));
    if (!prior) list.push(edge);
    else if (kindRank(edge.kind) > kindRank(prior.kind)) {
      prior.kind = edge.kind;
      prior.startId = edge.startId;
    }
    grouped.set(edge.fromKey, list);
  }
  const picked = new Set(existing);
  for (const host of hosts) {
    const fresh = (grouped.get(keyOf(host)) ?? []).filter((edge) => !picked.has(keyOf(edge.to)));
    for (const edge of sample(fresh, keep, random)) picked.add(keyOf(edge.to));
  }
  const chosen: SeenEdge[] = [];
  const seen = new Set<string>();
  for (const [fromKey, edges] of grouped) {
    for (const edge of edges) {
      const to = keyOf(edge.to);
      if (!picked.has(to)) continue;
      const mark = `${fromKey}>${to}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      chosen.push(edge);
    }
  }
  return chosen;
}

function outerHosts(edges: SeenEdge[], spine: Set<string>, random: () => number): WalkNode[] {
  const seen = new Set<string>();
  const preferred: WalkNode[] = [];
  const artists: WalkNode[] = [];
  for (const edge of edges) {
    const key = keyOf(edge.to);
    if (spine.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (edge.to.type === "artist") artists.push(edge.to);
    else preferred.push(edge.to);
  }
  return [...sample(preferred, OUTER_RELEASES, random), ...sample(artists, OUTER_ARTISTS, random)];
}

function connect(corridor: Corridor, from: WalkNode, to: WalkNode, kind: GraphLinkKind, startId: number | null) {
  if (keyOf(from) === keyOf(to)) return;
  if (!corridor.nodes.has(keyOf(from))) corridor.nodes.set(keyOf(from), from);
  if (!corridor.nodes.has(keyOf(to))) corridor.nodes.set(keyOf(to), to);
  link(corridor.adj, keyOf(from), keyOf(to), kind, startId);
  link(corridor.adj, keyOf(to), keyOf(from), kind, startId);
}

function link(adj: Map<string, Adj[]>, from: string, to: string, kind: GraphLinkKind, startId: number | null) {
  const list = adj.get(from) ?? [];
  const existing = list.find((edge) => edge.key === to);
  if (!existing) {
    list.push({ key: to, kind, startId });
    adj.set(from, list);
    return;
  }
  if (kindRank(kind) > kindRank(existing.kind)) {
    existing.kind = kind;
    existing.startId = startId;
  }
}

function kindRank(kind: GraphLinkKind): number {
  if (kind === "PRIMARY_ON") return 3;
  if (kind === "APPEARS_ON" || kind === "REMIXED") return 2;
  return 1;
}

function biasedWalk(
  corridor: Corridor,
  start: string,
  end: string,
  n: number,
  hMax: number,
  random: () => number,
): string[] | null {
  const dist = distancesFrom(end, corridor.adj);
  if (!dist.has(start)) return null;
  const path = [start];
  const visited = new Set<string>([start]);
  let steps = 0;
  let loose = 0;

  const search = (): boolean => {
    steps += 1;
    if (steps > WALK_STEP_BUDGET) return false;
    const here = path[path.length - 1]!;
    const hops = path.length - 1;
    if (here === end) return hops > n && hops <= hMax;
    const hereDist = dist.get(here)!;
    const detours: Array<{ key: string; weight: number }> = [];
    const closing: Array<{ key: string; weight: number }> = [];
    for (const edge of corridor.adj.get(here) ?? []) {
      if (visited.has(edge.key)) continue;
      const nextDist = dist.get(edge.key);
      if (nextDist == null || hops + 1 + nextDist > hMax) continue;
      const node = corridor.nodes.get(edge.key);
      if (!node) continue;
      const weight = stepWeight(hereDist, nextDist, node.type);
      if (weight <= 0) continue;
      (nextDist < hereDist ? closing : detours).push({ key: edge.key, weight });
    }
    const opened = weightedOrder(detours, random).slice(0, DETOUR_BRANCH);
    const nearer = weightedOrder(closing, random);
    const order = loose === 0 && random() < 0.5 ? [...opened, ...nearer] : [...nearer, ...opened];
    for (const key of order) {
      const openedStep = dist.get(key)! >= hereDist;
      visited.add(key);
      path.push(key);
      if (openedStep) loose += 1;
      if (search()) return true;
      if (openedStep) loose -= 1;
      path.pop();
      visited.delete(key);
      if (steps > WALK_STEP_BUDGET) return false;
    }
    return false;
  };

  return search() ? [...path] : null;
}

function distancesFrom(end: string, adj: Map<string, Adj[]>): Map<string, number> {
  const dist = new Map<string, number>([[end, 0]]);
  const queue = [end];
  for (let index = 0; index < queue.length; index += 1) {
    const key = queue[index]!;
    const next = dist.get(key)! + 1;
    for (const edge of adj.get(key) ?? []) {
      if (dist.has(edge.key)) continue;
      dist.set(edge.key, next);
      queue.push(edge.key);
    }
  }
  return dist;
}

function stepWeight(hereDist: number, nextDist: number, type: EntityType): number {
  const delta = hereDist - nextDist;
  let weight = delta > 0 ? 5 : delta === 0 ? 2 : delta === -1 ? 1 : 0;
  if (type === "release") weight *= 2;
  return weight;
}

function weightedOrder(options: Array<{ key: string; weight: number }>, random: () => number): string[] {
  return options
    .map((option) => ({ key: option.key, score: random() ** (1 / option.weight) }))
    .sort((a, b) => b.score - a.score)
    .map((option) => option.key);
}

function sample<T>(items: T[], count: number, random: () => number): T[] {
  if (count >= items.length) return [...items];
  const copy = [...items];
  for (let index = 0; index < count; index += 1) {
    const swap = index + Math.floor(random() * (copy.length - index));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return copy.slice(0, count);
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

async function toPayload(
  walk: Walk,
  shortestHops: number,
  stops: Seed[],
  fallback?: "shortest",
  unchanged = false,
): Promise<PathPayload> {
  const terminals = new Set(stops.map((stop) => `${stop.type}:${stop.id}`));
  const nodes: GraphNode[] = walk.nodes.map((node) => ({
    id: keyOf(node),
    entityType: node.type,
    discogsId: node.id,
    name: node.name,
    seed: terminals.has(keyOf(node)),
    year: node.year,
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
      scoreNote: "",
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
    ...(unchanged ? { unchanged: true } : {}),
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
