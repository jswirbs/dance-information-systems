import { asNumber, asString, withSession } from "../src/db.js";
import { DEFAULT_NODE_CAP, MAX_NODE_CAP, MIN_NODE_CAP } from "../src/shared/constants.js";
import type { EntityType, GraphLink, GraphNode, GraphPayload, Seed } from "../src/shared/types.js";
import { dedupeAliasSeeds, relatedDetailed } from "./queries.js";

export async function graphFor(seeds: Seed[], target: EntityType, nodeCap = DEFAULT_NODE_CAP): Promise<GraphPayload> {
  const cap = Math.min(MAX_NODE_CAP, Math.max(MIN_NODE_CAP, Math.round(nodeCap)));
  seeds = await dedupeAliasSeeds(seeds);
  const rows = await relatedDetailed(seeds, target, 12);
  const nodes = new Map<string, GraphNode>();

  const add = (type: EntityType, id: number, name: string, seed: boolean, year: number | null = null): string | null => {
    const key = `${type}:${id}`;
    const existing = nodes.get(key);
    if (existing) {
      existing.seed = existing.seed || seed;
      if (existing.year == null && year != null) existing.year = year;
      return key;
    }
    if (nodes.size >= cap && !seed) return null;
    nodes.set(key, { id: key, entityType: type, discogsId: id, name, seed, year });
    return key;
  };

  for (const seed of seeds) {
    const card = await lookupCard(seed);
    add(seed.type, seed.id, card.name, true, card.year);
  }
  for (const row of rows) add(row.type, row.id, row.name, false, row.year);
  for (const row of rows) {
    for (const bridge of row.bridges) add(bridge.type, bridge.id, bridge.name, false);
  }

  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const pushLink = (link: GraphLink) => {
    const key = `${link.kind}|${link.source}|${link.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  for (const row of rows) {
    const targetId = `${row.type}:${row.id}`;
    if (!nodes.has(targetId)) continue;
    for (const partial of row.partials) {
      const source = `${partial.seed.type}:${partial.seed.id}`;
      if (!nodes.has(source) || partial.score <= 0) continue;
      pushLink({ source, target: targetId, kind: "SIMILAR", score: roundScore(partial.score) });
    }
  }

  await addStructuralLinks(nodes, links, cap, seeds.filter((seed) => seed.type === "release").map((seed) => seed.id));
  return { nodes: [...nodes.values()], links };
}

async function addStructuralLinks(
  nodes: Map<string, GraphNode>,
  links: GraphLink[],
  cap: number,
  seedReleaseIds: number[],
): Promise<void> {
  const seen = new Set(links.map((link) => `${link.kind}|${link.source}|${link.target}`));
  const pushLink = (link: GraphLink) => {
    const key = `${link.kind}|${link.source}|${link.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push(link);
  };
  const ids = (type: EntityType) =>
    [...nodes.values()].filter((node) => node.entityType === type).map((node) => node.discogsId);

  const artistIds = ids("artist");
  const labelIds = ids("label");

  await withSession(async (session) => {
    if (artistIds.length > 0 && labelIds.length > 0) {
      const paths = await session.run(
        `MATCH (shown:Artist)
         WHERE shown.discogsId IN $artistIds
         OPTIONAL MATCH (shown)-[:ALIAS_OF]-(alias:Artist)
         WITH shown, [n IN collect(DISTINCT alias) + [shown] WHERE n IS NOT NULL] AS people
         UNWIND people AS credited
         MATCH (credited)-[c:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release)<-[:ISSUED]-(l:Label)
         WHERE l.discogsId IN $labelIds
         WITH shown, l, r, type(c) AS credit
         ORDER BY CASE WHEN r.discogsId IN $seedReleaseIds THEN 1 ELSE 0 END DESC,
                  coalesce(r.isMainRelease, false) DESC, r.discogsId ASC
         WITH shown, l,
              CASE WHEN coalesce(r.masterId, 0) > 0 THEN 'master:' + toString(r.masterId) ELSE 'release:' + toString(r.discogsId) END AS masterKey,
              collect({release: r, credit: credit}) AS items
         WITH shown, l, head(items) AS chosen, items
         WITH shown, l, chosen.release AS r, [item IN items WHERE item.release = chosen.release | item.credit] AS credits
         UNWIND credits AS credit
         RETURN shown.discogsId AS artistId, r.discogsId AS releaseId, r.title AS title, r.year AS year,
                l.discogsId AS labelId, credit
         LIMIT ${Math.max(80, cap * 2)}`,
        { artistIds, labelIds, seedReleaseIds },
      );
      for (const record of paths.records) {
        const artist = nodeKey(nodes, "artist", asNumber(record.get("artistId")));
        const label = nodeKey(nodes, "label", asNumber(record.get("labelId")));
        const release = addIfRoom(
          nodes,
          cap,
          "release",
          asNumber(record.get("releaseId")),
          asString(record.get("title")),
          asNumber(record.get("year")),
        );
        const credit = String(record.get("credit"));
        if (release && label) pushLink({ source: label, target: release, kind: "ISSUED" });
        if (release && artist && isCredit(credit)) pushLink({ source: artist, target: release, kind: credit });
      }
    }

    if (artistIds.length > 0) {
      const people = await session.run(
        `MATCH (a:Artist)-[rel:ALIAS_OF|MEMBER_OF]->(b:Artist)
         WHERE a.discogsId IN $artistIds AND b.discogsId IN $artistIds
         RETURN a.discogsId AS fromId, b.discogsId AS toId, type(rel) AS kind`,
        { artistIds },
      );
      for (const record of people.records) {
        const source = nodeKey(nodes, "artist", asNumber(record.get("fromId")));
        const target = nodeKey(nodes, "artist", asNumber(record.get("toId")));
        const kind = String(record.get("kind"));
        if (source && target && (kind === "ALIAS_OF" || kind === "MEMBER_OF")) pushLink({ source, target, kind });
      }
    }

    if (labelIds.length > 0) {
      const family = await session.run(
        `MATCH (child:Label)-[:SUBLABEL_OF]->(parent:Label)
         WHERE child.discogsId IN $labelIds AND parent.discogsId IN $labelIds
         RETURN child.discogsId AS childId, parent.discogsId AS parentId`,
        { labelIds },
      );
      for (const record of family.records) {
        const source = nodeKey(nodes, "label", asNumber(record.get("childId")));
        const target = nodeKey(nodes, "label", asNumber(record.get("parentId")));
        if (source && target) pushLink({ source, target, kind: "SUBLABEL_OF" });
      }
    }
  });
}

function addIfRoom(
  nodes: Map<string, GraphNode>,
  cap: number,
  type: EntityType,
  id: number | null,
  name: string | null,
  year: number | null = null,
): string | null {
  if (id == null) return null;
  const key = `${type}:${id}`;
  const existing = nodes.get(key);
  if (existing) {
    if (existing.year == null && year != null) existing.year = year;
    return key;
  }
  if (nodes.size >= cap) return null;
  nodes.set(key, { id: key, entityType: type, discogsId: id, name: name ?? String(id), seed: false, year });
  return key;
}

function nodeKey(nodes: Map<string, GraphNode>, type: EntityType, id: number | null): string | null {
  if (id == null) return null;
  const key = `${type}:${id}`;
  return nodes.has(key) ? key : null;
}

function roundScore(score: number): number {
  return Math.round(score * 1000) / 1000;
}

function isCredit(credit: string): credit is "PRIMARY_ON" | "APPEARS_ON" | "REMIXED" {
  return credit === "PRIMARY_ON" || credit === "APPEARS_ON" || credit === "REMIXED";
}

async function lookupCard(seed: Seed): Promise<{ name: string; year: number | null }> {
  const label = seed.type === "artist" ? "Artist" : seed.type === "label" ? "Label" : "Release";
  const field = seed.type === "release" ? "n.title" : "n.name";
  return withSession(async (session) => {
    const result = await session.run(`MATCH (n:${label} {discogsId: $id}) RETURN ${field} AS name, n.year AS year`, { id: seed.id });
    const record = result.records[0];
    if (!record) return { name: String(seed.id), year: null };
    return { name: String(record.get("name")), year: asNumber(record.get("year")) };
  });
}
