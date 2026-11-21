import { asNumber, asString, withSession } from "../src/db.js";
import {
  discogsKeys,
  emptyDiscogsLookup,
  linkDiscogsText,
  type DiscogsKeys,
  type DiscogsLookup,
} from "../src/shared/discogsText.js";
import type { AboutRun, EntityType } from "../src/shared/types.js";
import { neoLabel } from "./cypher.js";

export async function aboutFromDiscogs(source: string | null): Promise<AboutRun[] | null> {
  if (!source) return null;
  const lookup = await fetchDiscogsLookup(discogsKeys(source));
  return linkDiscogsText(source, lookup);
}

async function fetchDiscogsLookup(keys: DiscogsKeys): Promise<DiscogsLookup> {
  const lookup = emptyDiscogsLookup();
  await Promise.all([
    fillNames(lookup.artistByName, lookup.artistByFold, "artist", "artistSearch", keys.artistNames),
    fillNames(lookup.labelByName, lookup.labelByFold, "label", "labelSearch", keys.labelNames),
    fillIds(lookup.artistById, "artist", keys.artistIds),
    fillIds(lookup.labelById, "label", keys.labelIds),
    fillIds(lookup.releaseById, "release", keys.releaseIds),
    fillMasters(lookup.masterById, keys.masterIds),
  ]);
  return lookup;
}

async function fillNames(
  into: Map<string, number>,
  folded: Map<string, { id: number; name: string }>,
  type: "artist" | "label",
  index: string,
  names: string[],
): Promise<void> {
  if (names.length === 0) return;
  const records = await run(
    `UNWIND $names AS name
     MATCH (n:${neoLabel(type)} {name: name})
     RETURN name, min(n.discogsId) AS id`,
    { names },
  );
  for (const record of records) {
    const name = asString(record.get("name"));
    const id = asNumber(record.get("id"));
    if (name && id != null) into.set(name, id);
  }
  const missed = names.filter((name) => !into.has(name));
  if (missed.length === 0) return;
  const fallback = await run(
    `UNWIND $names AS name
     CALL db.index.fulltext.queryNodes($index, name.query) YIELD node
     WHERE toLower(node.name) = toLower(name.written)
     WITH name.written AS written, collect(DISTINCT {id: node.discogsId, stored: node.name})[0..2] AS hits
     WHERE size(hits) = 1
     RETURN written, hits[0].id AS id, hits[0].stored AS stored`,
    { index, names: missed.map((written) => ({ written, query: lucenePhrase(written) })) },
  );
  for (const record of fallback) {
    const written = asString(record.get("written"));
    const id = asNumber(record.get("id"));
    const stored = asString(record.get("stored"));
    if (written && id != null && stored) folded.set(written, { id, name: stored });
  }
}

function lucenePhrase(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function fillIds(into: Map<number, string>, type: EntityType, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const field = type === "release" ? "title" : "name";
  const records = await run(
    `UNWIND $ids AS id
     MATCH (n:${neoLabel(type)} {discogsId: id})
     RETURN id, n.${field} AS name`,
    { ids },
  );
  for (const record of records) {
    const id = asNumber(record.get("id"));
    if (id == null) continue;
    into.set(id, asString(record.get("name")) ?? "");
  }
}

async function fillMasters(into: Map<number, { id: number; name: string }>, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const records = await run(
    `UNWIND $ids AS id
     MATCH (r:Release {masterId: id})
     WITH id, r
     ORDER BY id, CASE WHEN r.isMainRelease = true THEN 0 ELSE 1 END, r.discogsId
     WITH id, head(collect(r)) AS r
     RETURN id, r.discogsId AS releaseId, r.title AS name`,
    { ids },
  );
  for (const record of records) {
    const id = asNumber(record.get("id"));
    const releaseId = asNumber(record.get("releaseId"));
    if (id == null || releaseId == null) continue;
    into.set(id, { id: releaseId, name: asString(record.get("name")) ?? "" });
  }
}

async function run(query: string, params: Record<string, unknown>) {
  return withSession(async (session) => {
    const result = await session.run(query, params);
    return result.records;
  });
}
