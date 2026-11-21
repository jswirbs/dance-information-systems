import type { AboutEntity, AboutMark, AboutMention, AboutRun } from "./types.js";

// Discogs profile and notes text uses a small tag set:
// [a=Name] [l=Name] [a123] [l123] [r123] [r=123] [m123] [m=123]
// [b][/b] [i][/i] [u][/u] [s][/s] [url=https://...]text[/url]
// [r=] and [m=] are ids. The equals sign only changes how Discogs labels the link.

const MARKS: Record<string, AboutMark> = {
  b: "bold",
  i: "italic",
  u: "underline",
  s: "strike",
};

const DISCOGS_ENTITY =
  /^https?:\/\/(?:www\.)?discogs\.com\/(?:(artist|label|release|master)\/(\d+)|[^/?#]+\/(artist|label|release|master)\/(\d+))/i;

type Raw =
  | { kind: "text"; text: string }
  | { kind: "mark"; mark: AboutMark; children: Raw[] }
  | { kind: "mention"; entity: AboutEntity; id: number | null; name: string | null }
  | { kind: "url"; href: string; text: string };

type Taken = { node: Raw | null; next: number };

export type DiscogsLookup = {
  artistByName: Map<string, number>;
  labelByName: Map<string, number>;
  /** Case-insensitive fallback, keyed by the name as written in the text. */
  artistByFold: Map<string, { id: number; name: string }>;
  labelByFold: Map<string, { id: number; name: string }>;
  artistById: Map<number, string>;
  labelById: Map<number, string>;
  releaseById: Map<number, string>;
  masterById: Map<number, { id: number; name: string }>;
};

export type DiscogsKeys = {
  artistNames: string[];
  labelNames: string[];
  artistIds: number[];
  labelIds: number[];
  releaseIds: number[];
  masterIds: number[];
};

export function emptyDiscogsLookup(): DiscogsLookup {
  return {
    artistByName: new Map(),
    labelByName: new Map(),
    artistByFold: new Map(),
    labelByFold: new Map(),
    artistById: new Map(),
    labelById: new Map(),
    releaseById: new Map(),
    masterById: new Map(),
  };
}

export function discogsKeys(source: string): DiscogsKeys {
  const artistNames = new Set<string>();
  const labelNames = new Set<string>();
  const artistIds = new Set<number>();
  const labelIds = new Set<number>();
  const releaseIds = new Set<number>();
  const masterIds = new Set<number>();
  visit(parseDiscogsText(source), (mention) => {
    if (mention.id == null) {
      if (mention.entity === "artist" && mention.name) artistNames.add(mention.name);
      if (mention.entity === "label" && mention.name) labelNames.add(mention.name);
      return;
    }
    if (mention.entity === "artist") artistIds.add(mention.id);
    else if (mention.entity === "label") labelIds.add(mention.id);
    else if (mention.entity === "release") releaseIds.add(mention.id);
    else masterIds.add(mention.id);
  });
  return {
    artistNames: [...artistNames],
    labelNames: [...labelNames],
    artistIds: [...artistIds],
    labelIds: [...labelIds],
    releaseIds: [...releaseIds],
    masterIds: [...masterIds],
  };
}

export function linkDiscogsText(source: string, lookup: DiscogsLookup): AboutRun[] {
  return applyRuns(parseDiscogsText(source), lookup);
}

export function discogsMentionUrl(mention: AboutMention): string {
  if (mention.id != null) return `https://www.discogs.com/${mention.entity}/${mention.id}`;
  const type = mention.entity === "master" ? "release" : mention.entity;
  return `https://www.discogs.com/search/?q=${encodeURIComponent(mention.name)}&type=${type}`;
}

function parseDiscogsText(source: string): Raw[] {
  return parseRange(source, 0, null).nodes;
}

function parseRange(source: string, start: number, closer: string | null): { nodes: Raw[]; next: number; closed: boolean } {
  const nodes: Raw[] = [];
  let textAt = start;
  let index = start;
  const flush = (end: number) => {
    if (end > textAt) nodes.push({ kind: "text", text: source.slice(textAt, end) });
    textAt = end;
  };
  while (index < source.length) {
    if (source[index] !== "[") {
      index += 1;
      continue;
    }
    if (closer && startsWithIgnoreCase(source, index, closer)) {
      flush(index);
      return { nodes, next: index + closer.length, closed: true };
    }
    const taken = tryToken(source, index);
    if (taken) {
      flush(index);
      if (taken.node) nodes.push(taken.node);
      index = taken.next;
      textAt = index;
      continue;
    }
    index += 1;
  }
  flush(source.length);
  return { nodes, next: source.length, closed: closer == null };
}

function tryToken(source: string, index: number): Taken | null {
  return tryMark(source, index) ?? tryUrl(source, index) ?? tryEntity(source, index);
}

function tryMark(source: string, index: number): Taken | null {
  const letter = source[index + 1];
  if (source[index] !== "[" || !letter || source[index + 2] !== "]") return null;
  const mark = MARKS[letter.toLowerCase()];
  if (!mark) return null;
  const closer = `[/${letter.toLowerCase()}]`;
  const inner = parseRange(source, index + 3, closer);
  if (!inner.closed || inner.nodes.length === 0) return null;
  return { node: { kind: "mark", mark, children: inner.nodes }, next: inner.next };
}

function tryUrl(source: string, index: number): Taken | null {
  const open = /^\[url(?:=([^\]]*))\]/i.exec(source.slice(index));
  if (!open) return null;
  const href = (open[1] ?? "").trim();
  const contentAt = index + open[0].length;
  const rest = source.slice(contentAt);
  const closeAt = rest.search(/\[\/url\]/i);
  if (closeAt < 0 || !/^https?:\/\//i.test(href)) return null;
  const text = rest.slice(0, closeAt).trim();
  const next = contentAt + closeAt + "[/url]".length;
  const target = discogsTarget(href);
  if (target) return { node: { kind: "mention", entity: target.entity, id: target.id, name: text || null }, next };
  return { node: { kind: "url", href, text: text || href }, next };
}

function tryEntity(source: string, index: number): Taken | null {
  const match = /^\[([almr])(?:(\d+)|(?:=([^\[\]\r\n]+)))\]/i.exec(source.slice(index));
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const next = index + match[0].length;
  if (match[2] != null) {
    const id = Number(match[2]);
    if (!isDiscogsId(id)) return null;
    return { node: { kind: "mention", entity: entityFor(kind), id, name: null }, next };
  }
  const name = match[3]?.trim() ?? "";
  if (!name) return null;
  if (kind === "r" || kind === "m") {
    if (!/^\d+$/.test(name)) return null;
    const id = Number(name);
    if (!isDiscogsId(id)) return null;
    return { node: { kind: "mention", entity: entityFor(kind), id, name: null }, next };
  }
  if (kind !== "a" && kind !== "l") return null;
  return { node: { kind: "mention", entity: kind === "a" ? "artist" : "label", id: null, name }, next };
}

function discogsTarget(href: string): { entity: AboutEntity; id: number } | null {
  const match = DISCOGS_ENTITY.exec(href);
  if (!match) return null;
  const entity = (match[1] ?? match[3] ?? "").toLowerCase();
  const id = Number(match[2] ?? match[4]);
  if (!isDiscogsId(id)) return null;
  if (entity === "artist" || entity === "label" || entity === "release" || entity === "master") return { entity, id };
  return null;
}

function entityFor(kind: string): AboutEntity {
  if (kind === "a") return "artist";
  if (kind === "l") return "label";
  if (kind === "r") return "release";
  return "master";
}

function isDiscogsId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

function startsWithIgnoreCase(source: string, index: number, token: string): boolean {
  return source.slice(index, index + token.length).toLowerCase() === token;
}

function visit(nodes: Raw[], onMention: (mention: Raw & { kind: "mention" }) => void) {
  for (const node of nodes) {
    if (node.kind === "mark") visit(node.children, onMention);
    else if (node.kind === "mention") onMention(node);
  }
}

function applyRuns(nodes: Raw[], lookup: DiscogsLookup): AboutRun[] {
  const runs: AboutRun[] = [];
  for (const node of nodes) {
    if (node.kind === "text" || node.kind === "url") {
      runs.push(node);
      continue;
    }
    if (node.kind === "mark") {
      const children = applyRuns(node.children, lookup);
      if (children.length > 0) runs.push({ kind: "mark", mark: node.mark, children });
      continue;
    }
    runs.push(resolveMention(node, lookup));
  }
  return runs;
}

function resolveMention(node: Raw & { kind: "mention" }, lookup: DiscogsLookup): AboutRun {
  if (node.id == null) {
    const written = node.name ?? "";
    const exact = node.entity === "artist" ? lookup.artistByName.get(written) : lookup.labelByName.get(written);
    if (exact != null) return { kind: "mention", entity: node.entity, id: exact, name: written, inCatalog: true };
    const folded = node.entity === "artist" ? lookup.artistByFold.get(written) : lookup.labelByFold.get(written);
    if (folded) return { kind: "mention", entity: node.entity, id: folded.id, name: folded.name, inCatalog: true };
    return { kind: "mention", entity: node.entity, id: null, name: written, inCatalog: false };
  }
  if (node.entity === "master") {
    const stored = lookup.masterById.get(node.id);
    if (!stored) return { kind: "mention", entity: "master", id: node.id, name: node.name || `master ${node.id}`, inCatalog: false };
    return {
      kind: "mention",
      entity: "release",
      id: stored.id,
      name: node.name || stored.name || `release ${stored.id}`,
      inCatalog: true,
    };
  }
  const stored =
    node.entity === "artist"
      ? lookup.artistById.get(node.id)
      : node.entity === "label"
        ? lookup.labelById.get(node.id)
        : lookup.releaseById.get(node.id);
  const known = stored != null;
  return {
    kind: "mention",
    entity: node.entity,
    id: node.id,
    name: node.name || stored || `${node.entity} ${node.id}`,
    inCatalog: known,
  };
}
