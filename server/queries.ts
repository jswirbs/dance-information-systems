import type { Record as NeoRecord } from "neo4j-driver";
import { asNumber, asString, asStrings, withSession } from "../src/db.js";
import type { EntityDetail, EntityType, IssuedLabel, RelatedRow, SearchHit, Seed } from "../src/shared/types.js";
import { aboutFromDiscogs } from "./discogsText.js";
import { ARTIST_CLOSURE, mainReleaseOrder, masterKey, neoLabel, parseJson } from "./cypher.js";
import {
  catalogLine,
  creditSentence,
  formatReasons,
  releaseSpan,
  type NameBridge,
  type ReasonInput,
  type ReleaseBridge,
  type ScoreInput,
} from "./reasons.js";

export type DetailedRow = RelatedRow & {
  bridges: { type: EntityType; id: number; name: string }[];
  partials: { seed: Seed; score: number }[];
};

type Hit = {
  type: EntityType;
  id: number;
  name: string;
  score: number;
  thumbUrl: string | null;
  year: number | null;
  country: string | null;
  genres: string[];
  styles: string[];
  reason: ReasonInput;
  bridges: { type: EntityType; id: number; name: string }[];
};

const EMPTY_CARD = { year: null, country: null, genres: [] as string[], styles: [] as string[] };

export async function search(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const lucene = toLucene(term);
  const [artists, labels, releases] = await Promise.all([
    fulltext("artistSearch", lucene, "artist"),
    fulltext("labelSearch", lucene, "label"),
    fulltext("releaseSearch", lucene, "release"),
  ]);
  const needle = term.toLowerCase();
  const pools = { artist: artists, label: labels, release: releases };
  const exact = (hit: { name: string }) => hit.name.trim().toLowerCase() === needle;
  const pinned = (["artist", "label", "release"] as const).flatMap((type) => {
    const matches = pools[type].filter(exact).sort((a, b) => b.rank - a.rank);
    return type === "artist" ? matches : matches.slice(0, 1);
  });
  const seen = new Set(pinned.map((hit) => `${hit.type}:${hit.id}`));
  const rest = (["artist", "label", "release"] as const)
    .flatMap((type) =>
      pools[type]
        .filter((hit) => !seen.has(`${hit.type}:${hit.id}`))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 8),
    )
    .sort((a, b) => b.rank - a.rank);
  return [...pinned, ...rest].slice(0, 12).map(({ rank: _rank, ...hit }) => hit);
}

export async function related(seeds: Seed[], target: EntityType, limit = 25): Promise<RelatedRow[]> {
  const detailed = await relatedDetailed(seeds, target, limit);
  return detailed.map(({ bridges: _bridges, partials: _partials, ...row }) => row);
}

type Bucket = {
  type: EntityType;
  id: number;
  name: string;
  score: number;
  thumbUrl: string | null;
  year: number | null;
  country: string | null;
  genres: string[];
  styles: string[];
  bridges: DetailedRow["bridges"];
  inputs: ReasonInput[];
  partials: { seed: Seed; score: number }[];
};

/** Merge one neighborhood per seed. Direct release lists score 1 per seed and then sort by year. */
export async function relatedDetailed(seeds: Seed[], target: EntityType, limit = 25): Promise<DetailedRow[]> {
  seeds = await dedupeAliasSeeds(seeds);
  const excluded = new Set<string>();
  for (const seed of seeds) {
    for (const id of await closureIds(seed)) excluded.add(`${seed.type}:${id}`);
  }

  const tagged: Array<Hit & { seed: Seed }> = [];
  for (const seed of seeds) {
    const seedName = await lookupName(seed);
    for (const hit of await walk(seed, seedName, target)) tagged.push({ ...hit, seed });
  }

  const merged = new Map<string, Bucket>();
  for (const hit of tagged) {
    const key = `${hit.type}:${hit.id}`;
    if (excluded.has(key)) continue;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        type: hit.type,
        id: hit.id,
        name: hit.name,
        score: hit.score,
        thumbUrl: hit.thumbUrl,
        year: hit.year,
        country: hit.country,
        genres: hit.genres,
        styles: hit.styles,
        bridges: [...hit.bridges],
        inputs: [hit.reason],
        partials: [{ seed: hit.seed, score: hit.score }],
      });
    } else {
      current.score += hit.score;
      current.bridges.push(...hit.bridges);
      current.inputs.push(hit.reason);
      current.partials.push({ seed: hit.seed, score: hit.score });
    }
  }

  return [...merged.values()]
    .map((row) => {
      const { reason, reasons, scoreNote } = formatReasons(row.inputs);
      return {
        type: row.type,
        id: row.id,
        name: row.name,
        score: round(row.score),
        reason,
        reasons,
        scoreNote,
        thumbUrl: row.thumbUrl,
        year: row.year,
        country: row.country,
        genres: row.genres,
        styles: row.styles,
        bridges: uniqueBridges(row.bridges).slice(0, 6),
        partials: row.partials.filter((partial) => partial.score > 0),
      };
    })
    .sort((a, b) => b.score - a.score || (b.year ?? -1) - (a.year ?? -1) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

async function walk(seed: Seed, seedName: string, target: EntityType): Promise<Hit[]> {
  if (seed.type === "label" && target === "label") return similarLabels(seed.id, seedName);
  if (seed.type === "artist" && target === "artist") return similarArtists(seed.id, seedName);
  if (seed.type === "release" && target === "release") return similarReleases(seed.id, seedName);
  if (seed.type === "label" && target === "artist") return artistsOnLabel(seed.id, seedName);
  if (seed.type === "label" && target === "release") return releasesOnLabel(seed.id, seedName);
  if (seed.type === "artist" && target === "label") return labelsForArtist(seed.id, seedName);
  if (seed.type === "artist" && target === "release") return releasesForArtist(seed.id, seedName);
  if (seed.type === "release" && target === "artist") return artistsOnRelease(seed.id, seedName);
  return labelsOnRelease(seed.id, seedName);
}

async function similarLabels(id: number, seedName: string): Promise<Hit[]> {
  const shared = await run(
    `MATCH (seed:Label {discogsId: $id})-[:ISSUED]->(r:Release)<-[c:PRIMARY_ON|APPEARS_ON]-(a:Artist)
     WHERE coalesce(a.bridge, false) = false
     WITH seed, a, count(DISTINCT CASE WHEN c:PRIMARY_ON THEN CASE WHEN coalesce(r.masterId, 0) > 0 THEN r.masterId ELSE r.discogsId END END) AS primaryHere
     WITH seed, a, primaryHere > 0 AS seedPrimary
     MATCH (a)-[c2:PRIMARY_ON|APPEARS_ON]->(r2:Release)<-[:ISSUED]-(other:Label)
     WHERE other <> seed AND coalesce(other.denied, false) = false
     WITH other, a, seedPrimary,
          count(DISTINCT CASE WHEN c2:PRIMARY_ON THEN CASE WHEN coalesce(r2.masterId, 0) > 0 THEN r2.masterId ELSE r2.discogsId END END) AS primaryThere
     WITH other, a,
          CASE WHEN seedPrimary AND primaryThere > 0
            THEN 1.0 / log(2.0 + toFloat(coalesce(a.labelCount, 0)))
            ELSE 0.25 / log(2.0 + toFloat(coalesce(a.labelCount, 0)))
          END AS weight
     RETURN other.discogsId AS id, other.name AS name, other.thumbUrl AS thumbUrl,
            collect({id: a.discogsId, name: a.name, weight: weight}) AS bridges,
            sum(weight) AS score
     ORDER BY score DESC
     LIMIT 40`,
    { id },
  );
  const family = await run(
    `MATCH (seed:Label {discogsId: $id})
     MATCH (other:Label)
     WHERE coalesce(other.denied, false) = false
       AND ((other)-[:SUBLABEL_OF]->(seed) OR (seed)-[:SUBLABEL_OF]->(other))
     RETURN other.discogsId AS id, other.name AS name, other.thumbUrl AS thumbUrl,
            CASE WHEN (other)-[:SUBLABEL_OF]->(seed) THEN 'sublabel' ELSE 'parent' END AS relation`,
    { id },
  );

  const hits = new Map<number, Hit>();
  for (const record of shared) {
    const bridges = nameBridges(record.get("bridges"));
    const hit = baseHit("label", record, num(record, "score"), {
      seedName,
      sharedArtists: bridges,
      score: { kind: "roster", artistCount: bridges.length, artistPoints: num(record, "score"), family: null },
    });
    hit.bridges = bridges.map((bridge) => ({ type: "artist", id: bridge.id, name: bridge.name }));
    hits.set(hit.id, hit);
  }
  for (const record of family) {
    const relation = String(record.get("relation")) === "parent" ? "parent" : "sublabel";
    const existing = hits.get(num(record, "id"));
    const sublabel = { relation, otherName: seedName } as const;
    if (existing) {
      existing.score += 1.5;
      const current = existing.reason.score;
      existing.reason = {
        ...existing.reason,
        sublabel,
        score:
          current?.kind === "roster"
            ? { ...current, family: relation }
            : { kind: "roster", artistCount: 0, artistPoints: 0, family: relation },
      };
    } else {
      const hit = baseHit("label", record, 1.5, {
        seedName,
        sublabel,
        score: { kind: "roster", artistCount: 0, artistPoints: 0, family: relation },
      });
      hits.set(hit.id, hit);
    }
  }
  return [...hits.values()];
}

async function similarArtists(id: number, seedName: string): Promise<Hit[]> {
  const labels = await run(
    `${ARTIST_CLOSURE}
     UNWIND closure AS s
     MATCH (s)-[c:PRIMARY_ON|APPEARS_ON]->(r:Release)<-[:ISSUED]-(l:Label)
     WHERE coalesce(l.denied, false) = false
     WITH closure, l, count(DISTINCT CASE WHEN c:PRIMARY_ON THEN CASE WHEN coalesce(r.masterId, 0) > 0 THEN r.masterId ELSE r.discogsId END END) AS seedPrimary
     WITH closure, l, seedPrimary > 0 AS seedHasPrimary
     MATCH (other:Artist)-[c2:PRIMARY_ON|APPEARS_ON]->(r2:Release)<-[:ISSUED]-(l)
     WHERE NOT other IN closure AND coalesce(other.bridge, false) = false
     WITH other, l, seedHasPrimary,
          count(DISTINCT CASE WHEN c2:PRIMARY_ON THEN CASE WHEN coalesce(r2.masterId, 0) > 0 THEN r2.masterId ELSE r2.discogsId END END) AS otherPrimary,
          count(DISTINCT CASE WHEN coalesce(r2.masterId, 0) > 0 THEN r2.masterId ELSE r2.discogsId END) AS masters
     WITH other, l,
          CASE WHEN seedHasPrimary AND otherPrimary > 0 THEN 1.0 ELSE 0.25 END AS points,
          masters
     RETURN other.discogsId AS id, other.name AS name, other.thumbUrl AS thumbUrl,
            collect({id: l.discogsId, name: l.name, weight: masters}) AS bridges,
            sum(points) AS score,
            sum(CASE WHEN points >= 1.0 THEN 1 ELSE 0 END) AS primaryLabels,
            sum(CASE WHEN points < 1.0 THEN 1 ELSE 0 END) AS appearLabels`,
    { id },
  );
  const sharedReleases = await run(
    `${ARTIST_CLOSURE}
     UNWIND closure AS s
     MATCH (s)-[c:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release)<-[c2:PRIMARY_ON|APPEARS_ON|REMIXED]-(other:Artist)
     WHERE NOT other IN closure AND coalesce(other.bridge, false) = false
     WITH other, CASE WHEN coalesce(r.masterId, 0) > 0 THEN r.masterId ELSE r.discogsId END AS masterKey,
          head(collect(r.title)) AS title,
          max(CASE WHEN (c:REMIXED AND c.role = 'Remix') OR (c2:REMIXED AND c2.role = 'Remix') THEN 1 ELSE 0 END) AS remix
     WITH other, collect({id: masterKey, title: title, remix: remix = 1}) AS releases
     RETURN other.discogsId AS id, other.name AS name, other.thumbUrl AS thumbUrl,
            releases, toFloat(size(releases)) * 2.0 AS score`,
    { id },
  );

  const hits = new Map<number, Hit>();
  for (const record of labels) {
    const bridges = nameBridges(record.get("bridges"));
    const hit = baseHit("artist", record, num(record, "score"), {
      seedName,
      sharedLabels: bridges,
      score: {
        kind: "catalog",
        primaryLabels: num(record, "primaryLabels"),
        appearLabels: num(record, "appearLabels"),
        sharedReleases: 0,
      },
    });
    hit.bridges = bridges.map((bridge) => ({ type: "label", id: bridge.id, name: bridge.name }));
    hits.set(hit.id, hit);
  }
  for (const record of sharedReleases) {
    const releases = releaseBridges(record.get("releases"));
    const existing = hits.get(num(record, "id"));
    if (existing) {
      existing.score += num(record, "score");
      const current = existing.reason.score;
      existing.reason = {
        ...existing.reason,
        sharedReleases: releases,
        score:
          current?.kind === "catalog"
            ? { ...current, sharedReleases: releases.length }
            : { kind: "catalog", primaryLabels: 0, appearLabels: 0, sharedReleases: releases.length },
      };
    } else {
      const hit = baseHit("artist", record, num(record, "score"), {
        seedName,
        sharedReleases: releases,
        score: { kind: "catalog", primaryLabels: 0, appearLabels: 0, sharedReleases: releases.length },
      });
      hits.set(hit.id, hit);
    }
  }
  return [...hits.values()];
}

// Points: shared label 2, shared primary artist 4, shared track or remix artist 1 (cap 3),
// shared style 1 (cap 3), and 1 when the years fall within three of each other.
const RELEASE_STYLE_CAP = 3;
const RELEASE_CREDIT_CAP = 3;
const RELEASE_YEAR_WINDOW = 3;

async function similarReleases(id: number, seedName: string): Promise<Hit[]> {
  const [seed, byLabel, byArtist, byCredit] = await Promise.all([
    releaseFacts(id),
    run(
      `MATCH (seed:Release {discogsId: $id})<-[:ISSUED]-(l:Label)
       WHERE coalesce(l.denied, false) = false
       MATCH (l)-[:ISSUED]->(other:Release)
       WHERE other <> seed AND (coalesce(seed.masterId, 0) <= 0 OR coalesce(other.masterId, 0) <= 0 OR other.masterId <> seed.masterId)
       WITH other, collect(DISTINCT {id: l.discogsId, name: l.name, weight: 1}) AS labels
       ORDER BY ${mainReleaseOrder("other")}
       WITH ${masterKey("other")} AS masterKey,
            collect(other) AS pressings, collect(labels) AS labelSets
       WITH head(pressings) AS other, head(labelSets) AS labels
       RETURN other.discogsId AS id, other.title AS name, other.thumbUrl AS thumbUrl,
              other.year AS year, other.country AS country, other.genres AS genres, other.styles AS styles,
              labels, toFloat(size(labels)) * 2.0 AS score`,
      { id },
    ),
    run(
      `MATCH (seed:Release {discogsId: $id})<-[:PRIMARY_ON]-(a:Artist)
       WHERE coalesce(a.bridge, false) = false
       MATCH (a)-[:PRIMARY_ON]->(other:Release)
       WHERE other <> seed AND (coalesce(seed.masterId, 0) <= 0 OR coalesce(other.masterId, 0) <= 0 OR other.masterId <> seed.masterId)
       WITH other, collect(DISTINCT {id: a.discogsId, name: a.name, weight: 1}) AS artists
       ORDER BY ${mainReleaseOrder("other")}
       WITH ${masterKey("other")} AS masterKey,
            collect(other) AS pressings, collect(artists) AS artistSets
       WITH head(pressings) AS other, head(artistSets) AS artists
       RETURN other.discogsId AS id, other.title AS name, other.thumbUrl AS thumbUrl,
              other.year AS year, other.country AS country, other.genres AS genres, other.styles AS styles,
              artists, toFloat(size(artists)) * 4.0 AS score`,
      { id },
    ),
    // Degree weight only decides which credit-neighbors fit in the window. Points are the capped artist count.
    run(
      `MATCH (seed:Release {discogsId: $id})<-[:APPEARS_ON|REMIXED]-(a:Artist)
       WHERE coalesce(a.bridge, false) = false AND NOT (a)-[:PRIMARY_ON]->(seed)
       MATCH (a)-[:APPEARS_ON|PRIMARY_ON|REMIXED]->(credited:Release)
       WITH seed, a, count(DISTINCT CASE WHEN coalesce(credited.masterId, 0) > 0 THEN credited.masterId ELSE credited.discogsId END) AS degree
       WITH seed, a, 1.0 / log(2.0 + toFloat(degree)) AS weight
       MATCH (a)-[:APPEARS_ON|PRIMARY_ON|REMIXED]->(other:Release)
       WHERE other <> seed AND (coalesce(seed.masterId, 0) <= 0 OR coalesce(other.masterId, 0) <= 0 OR other.masterId <> seed.masterId)
       WITH seed, other, a, head(collect(weight)) AS weight
       WITH seed, other, collect({id: a.discogsId, name: a.name, weight: weight}) AS artists, sum(weight) AS rank
       WITH other, artists, rank,
            size([style IN coalesce(seed.styles, []) WHERE style IN coalesce(other.styles, [])]) AS styleOverlap,
            CASE WHEN seed.year IS NULL OR other.year IS NULL OR abs(seed.year - other.year) > 3 THEN 0 ELSE 1 END AS yearClose
       ORDER BY rank + toFloat(styleOverlap) DESC, yearClose DESC, ${mainReleaseOrder("other")}
       WITH ${masterKey("other")} AS masterKey,
            collect(other) AS pressings, collect(artists) AS artistSets, collect(rank + toFloat(styleOverlap)) AS ranks
       WITH head(pressings) AS other, head(artistSets) AS artists, head(ranks) AS rank
       ORDER BY rank DESC
       LIMIT 40
       RETURN other.discogsId AS id, other.title AS name, other.thumbUrl AS thumbUrl,
              other.year AS year, other.country AS country, other.genres AS genres, other.styles AS styles,
              artists`,
      { id },
    ),
  ]);

  const hits = new Map<number, Hit>();
  for (const record of byLabel) {
    const labels = nameBridges(record.get("labels"));
    const hit = releaseHit(record, num(record, "score"), {
      seedName,
      sameLabels: labels.map((label) => label.name),
      score: releaseScore({ labels: labels.length }),
    });
    hit.bridges = labels.map((label) => ({ type: "label", id: label.id, name: label.name }));
    rememberRelease(hits, hit);
  }
  for (const record of byArtist) {
    const artists = nameBridges(record.get("artists"));
    const hit = releaseHit(record, num(record, "score"), {
      seedName,
      sameArtists: artists.map((artist) => artist.name),
      score: releaseScore({ primaryArtists: artists.length }),
    });
    hit.bridges = artists.map((artist) => ({ type: "artist" as const, id: artist.id, name: artist.name }));
    rememberRelease(hits, hit);
  }
  for (const record of byCredit) {
    const artists = nameBridges(record.get("artists"));
    if (artists.length === 0) continue;
    const hit = releaseHit(record, Math.min(artists.length, RELEASE_CREDIT_CAP), {
      seedName,
      sameArtists: artists.map((artist) => artist.name),
      score: releaseScore({ creditPoints: Math.min(artists.length, RELEASE_CREDIT_CAP) }),
    });
    rememberRelease(hits, hit);
  }
  for (const hit of hits.values()) applyReleaseAffinity(hit, seed);
  return [...hits.values()];
}

async function releaseFacts(id: number): Promise<{ styles: string[]; year: number | null }> {
  const records = await run(`MATCH (seed:Release {discogsId: $id}) RETURN seed.styles AS styles, seed.year AS year`, { id });
  const record = records[0];
  if (!record) return { styles: [], year: null };
  return { styles: asStrings(record.get("styles")), year: numOrNull(record, "year") };
}

function rememberRelease(hits: Map<number, Hit>, hit: Hit) {
  const existing = hits.get(hit.id);
  if (!existing) {
    hits.set(hit.id, hit);
    return;
  }
  existing.score += hit.score;
  existing.bridges.push(...hit.bridges);
  existing.reason = {
    ...existing.reason,
    sameLabels: mergeNames(existing.reason.sameLabels, hit.reason.sameLabels),
    sameArtists: mergeNames(existing.reason.sameArtists, hit.reason.sameArtists),
    score: combineReleaseScore(existing.reason.score, hit.reason.score),
  };
}

function applyReleaseAffinity(hit: Hit, seed: { styles: string[]; year: number | null }) {
  const shared = sharedNames(seed.styles, hit.styles);
  const stylePoints = Math.min(shared.length, RELEASE_STYLE_CAP);
  const yearClose = seed.year != null && hit.year != null && Math.abs(seed.year - hit.year) <= RELEASE_YEAR_WINDOW;
  if (shared.length > 0) {
    hit.score += stylePoints;
    hit.reason = { ...hit.reason, sharedStyles: shared };
  }
  if (yearClose) hit.score += 1;
  if (stylePoints > 0 || yearClose) {
    const base = hit.reason.score?.kind === "release" ? hit.reason.score : releaseScore();
    hit.reason = { ...hit.reason, score: { ...base, styles: base.styles + stylePoints, yearClose: base.yearClose || yearClose } };
  }
}

function releaseScore(
  part: Partial<Omit<Extract<ScoreInput, { kind: "release" }>, "kind">> = {},
): Extract<ScoreInput, { kind: "release" }> {
  return { kind: "release", labels: 0, primaryArtists: 0, creditPoints: 0, styles: 0, yearClose: false, ...part };
}

function combineReleaseScore(current: ScoreInput | undefined, extra: ScoreInput | undefined): ScoreInput | undefined {
  if (!extra || extra.kind !== "release") return current;
  if (!current || current.kind !== "release") return extra;
  return {
    kind: "release",
    labels: current.labels + extra.labels,
    primaryArtists: current.primaryArtists + extra.primaryArtists,
    creditPoints: current.creditPoints + extra.creditPoints,
    styles: current.styles + extra.styles,
    yearClose: current.yearClose || extra.yearClose,
  };
}

function sharedNames(left: string[], right: string[]): string[] {
  const have = new Set(right);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of left) {
    if (!have.has(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function mergeNames(current: string[] | undefined, extra: string[] | undefined): string[] | undefined {
  if (!extra || extra.length === 0) return current;
  const names = [...(current ?? [])];
  const seen = new Set(names);
  for (const name of extra) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

async function artistsOnLabel(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `MATCH (l:Label {discogsId: $id})-[:ISSUED]->(r:Release)<-[:PRIMARY_ON|APPEARS_ON|REMIXED]-(a:Artist)
     WHERE coalesce(a.bridge, false) = false
     WITH a, count(DISTINCT ${masterKey("r")}) AS releases,
          min(r.year) AS fromYear, max(r.year) AS toYear
     RETURN a.discogsId AS id, a.name AS name, a.thumbUrl AS thumbUrl, releases, fromYear, toYear`,
    { id },
  );
  return records.map((record) => {
    const count = num(record, "releases");
    return baseHit("artist", record, count, {
      seedName,
      direct: releaseSpan(count, numOrNull(record, "fromYear"), numOrNull(record, "toYear"), true),
      score: { kind: "releases", count, onLabel: true },
    });
  });
}

async function releasesOnLabel(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `MATCH (l:Label {discogsId: $id})-[edge:ISSUED]->(r:Release)
     ORDER BY ${mainReleaseOrder("r")}
     WITH ${masterKey("r")} AS masterKey,
          collect(r) AS pressings, collect(edge) AS edges
     WITH head(pressings) AS r, head(edges) AS edge
     RETURN r.discogsId AS id, r.title AS name, r.thumbUrl AS thumbUrl,
            r.year AS year, r.country AS country, r.genres AS genres, r.styles AS styles,
            edge.catno AS catno`,
    { id },
  );
  return records.map((record) => {
    const year = numOrNull(record, "year");
    const hit = baseHit("release", record, 1, {
      seedName,
      direct: catalogLine(asString(record.get("catno")), year),
    });
    hit.year = year;
    hit.country = asString(record.get("country"));
    hit.genres = asStrings(record.get("genres"));
    hit.styles = asStrings(record.get("styles"));
    return hit;
  });
}

async function labelsForArtist(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `${ARTIST_CLOSURE}
     UNWIND closure AS s
     MATCH (s)-[:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release)<-[:ISSUED]-(l:Label)
     WITH l, count(DISTINCT ${masterKey("r")}) AS releases,
          min(r.year) AS fromYear, max(r.year) AS toYear
     RETURN l.discogsId AS id, l.name AS name, l.thumbUrl AS thumbUrl, releases, fromYear, toYear`,
    { id },
  );
  return records.map((record) => {
    const count = num(record, "releases");
    return baseHit("label", record, count, {
      seedName,
      direct: releaseSpan(count, numOrNull(record, "fromYear"), numOrNull(record, "toYear"), false),
      score: { kind: "releases", count, onLabel: false },
    });
  });
}

async function releasesForArtist(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `${ARTIST_CLOSURE}
     UNWIND closure AS s
     MATCH (s)-[c:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release)
     WITH r, collect(DISTINCT c.role) AS roles
     ORDER BY ${mainReleaseOrder("r")}
     WITH ${masterKey("r")} AS masterKey,
          collect(r) AS pressings, collect(roles) AS roleSets
     WITH head(pressings) AS r, reduce(acc = [], rs IN roleSets | acc + rs) AS roles
     RETURN r.discogsId AS id, r.title AS name, r.thumbUrl AS thumbUrl,
            r.year AS year, r.country AS country, r.genres AS genres, r.styles AS styles,
            r.compilation AS compilation, roles`,
    { id },
  );
  return records.map((record) => {
    const year = numOrNull(record, "year");
    const hit = baseHit("release", record, 1, {
      seedName,
      direct: creditSentence([...new Set(asStrings(record.get("roles")))], Boolean(record.get("compilation"))),
    });
    hit.year = year;
    hit.country = asString(record.get("country"));
    hit.genres = asStrings(record.get("genres"));
    hit.styles = asStrings(record.get("styles"));
    return hit;
  });
}

async function artistsOnRelease(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `MATCH (a:Artist)-[c:PRIMARY_ON|APPEARS_ON|REMIXED]->(r:Release {discogsId: $id})
     WHERE coalesce(a.bridge, false) = false
     WITH a, collect(DISTINCT c.role) AS roles, r.compilation AS compilation
     RETURN a.discogsId AS id, a.name AS name, a.thumbUrl AS thumbUrl, roles, compilation`,
    { id },
  );
  return records.map((record) =>
    baseHit("artist", record, 1, {
      seedName,
      direct: creditSentence(asStrings(record.get("roles")), Boolean(record.get("compilation"))),
      score: { kind: "credit" },
    }),
  );
}

async function labelsOnRelease(id: number, seedName: string): Promise<Hit[]> {
  const records = await run(
    `MATCH (l:Label)-[edge:ISSUED]->(r:Release {discogsId: $id})
     RETURN l.discogsId AS id, l.name AS name, l.thumbUrl AS thumbUrl, edge.catno AS catno, r.year AS year`,
    { id },
  );
  return records.map((record) =>
    baseHit("label", record, 1, {
      seedName,
      direct: catalogLine(asString(record.get("catno")), numOrNull(record, "year")),
      score: { kind: "issued" },
    }),
  );
}

export async function entityDetail(type: EntityType, id: number): Promise<EntityDetail | null> {
  const label = neoLabel(type);
  const records = await run(`MATCH (n:${label} {discogsId: $id}) RETURN n`, { id });
  const node = records[0]?.get("n");
  if (!node) return null;
  const props = node.properties as Record<string, unknown>;
  const profile = asString(props.profile);
  const notes = asString(props.notes);
  const [aliases, parent, labels, about] = await Promise.all([
    type === "artist" ? artistAliases(id) : Promise.resolve([]),
    type === "label" ? labelParent(id) : Promise.resolve(null),
    type === "release" ? releaseLabels(id) : Promise.resolve([]),
    aboutFromDiscogs(profile || notes),
  ]);
  return {
    type,
    id,
    name: String(props.name ?? props.title ?? ""),
    imageUrl: asString(props.imageUrl),
    thumbUrl: asString(props.thumbUrl),
    imageCount: asNumber(props.imageCount) ?? 0,
    realname: asString(props.realname),
    profile,
    contactInfo: asString(props.contactInfo),
    dataQuality: asString(props.dataQuality),
    nameVariations: asStrings(props.nameVariations),
    urls: asStrings(props.urls),
    country: asString(props.country),
    released: asString(props.released),
    year: asNumber(props.year),
    notes,
    genres: asStrings(props.genres),
    styles: asStrings(props.styles),
    formatNames: asStrings(props.formatNames),
    formatSummary: asStrings(props.formatSummary),
    credits: parseJson(props.credits, []),
    tracklist: parseJson(props.tracklist, []),
    companies: parseJson(props.companies, []),
    videos: parseJson(props.videos, []),
    identifiers: parseJson(props.identifiers, []),
    masterId: asNumber(props.masterId),
    isMainRelease: props.isMainRelease == null ? null : Boolean(props.isMainRelease),
    aliases,
    parent,
    labels,
    creditedArtists: [],
    about,
  };
}

export async function dedupeAliasSeeds(seeds: Seed[]): Promise<Seed[]> {
  const skip = new Set<number>();
  const unique: Seed[] = [];
  for (const seed of seeds) {
    if (seed.type !== "artist") {
      if (!unique.some((item) => item.type === seed.type && item.id === seed.id)) unique.push(seed);
      continue;
    }
    if (skip.has(seed.id)) continue;
    unique.push(seed);
    for (const id of await closureIds(seed)) skip.add(id);
  }
  return unique;
}

async function releaseLabels(id: number): Promise<IssuedLabel[]> {
  const records = await run(
    `MATCH (l:Label)-[edge:ISSUED]->(:Release {discogsId: $id})
     RETURN l.discogsId AS id, l.name AS name, edge.catno AS catno
     ORDER BY l.name`,
    { id },
  );
  return records
    .map((record) => ({
      id: num(record, "id"),
      name: String(record.get("name") ?? ""),
      catno: catalogNumber(asString(record.get("catno"))),
    }))
    .filter((label) => label.id > 0 && label.name.length > 0);
}

function catalogNumber(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return null;
  return trimmed;
}

async function labelParent(id: number): Promise<{ id: number; name: string } | null> {
  const records = await run(
    `MATCH (:Label {discogsId: $id})-[:SUBLABEL_OF]->(parent:Label)
     RETURN parent.discogsId AS id, parent.name AS name
     ORDER BY parent.name
     LIMIT 1`,
    { id },
  );
  const record = records[0];
  if (!record) return null;
  const parentId = num(record, "id");
  const name = String(record.get("name") ?? "");
  if (parentId <= 0 || name.length === 0) return null;
  return { id: parentId, name };
}

async function artistAliases(id: number): Promise<Array<{ id: number; name: string }>> {
  const records = await run(
    `MATCH (seed:Artist {discogsId: $id})-[:ALIAS_OF]-(alias:Artist)
     RETURN DISTINCT alias.discogsId AS id, alias.name AS name
     ORDER BY alias.name`,
    { id },
  );
  return records.map((record) => ({ id: num(record, "id"), name: String(record.get("name")) }));
}

export async function lookupName(seed: Seed): Promise<string> {
  const field = seed.type === "release" ? "n.title" : "n.name";
  const records = await run(`MATCH (n:${neoLabel(seed.type)} {discogsId: $id}) RETURN ${field} AS name`, { id: seed.id });
  return records[0] ? String(records[0].get("name")) : String(seed.id);
}

export async function closureIds(seed: Seed): Promise<number[]> {
  if (seed.type !== "artist") return [seed.id];
  const records = await run(
    `MATCH (seed:Artist {discogsId: $id})
     OPTIONAL MATCH (seed)-[:ALIAS_OF]-(alias:Artist)
     WITH collect(DISTINCT seed.discogsId) + collect(DISTINCT alias.discogsId) AS ids
     RETURN [id IN ids WHERE id IS NOT NULL] AS ids`,
    { id: seed.id },
  );
  const ids = records[0]?.get("ids");
  return Array.isArray(ids) ? ids.map((id) => asNumber(id) ?? 0) : [seed.id];
}

async function fulltext(index: string, q: string, type: EntityType): Promise<Array<SearchHit & { rank: number }>> {
  const name = type === "release" ? "node.title" : "node.name";
  const releaseFields = type === "release" ? ", node.masterId AS masterId, node.isMainRelease AS isMainRelease" : "";
  const records = await run(
    `CALL db.index.fulltext.queryNodes($index, $q) YIELD node, score
     RETURN ${name} AS name, node.discogsId AS id, node.thumbUrl AS thumbUrl, node.realname AS realname,
            node.year AS year, node.country AS country, score${releaseFields}
     ORDER BY score DESC
     LIMIT 40`,
    { index, q },
  );
  const hits = records.map((record) => ({
    type,
    id: num(record, "id"),
    name: String(record.get("name")),
    thumbUrl: asString(record.get("thumbUrl")),
    disambiguator: disambiguator(type, record),
    rank: num(record, "score"),
    masterId: type === "release" ? asNumber(record.get("masterId")) : null,
    main: type === "release" && record.get("isMainRelease") === true,
  }));
  if (type !== "release") return hits;
  const best = new Map<string, (typeof hits)[number]>();
  for (const hit of hits) {
    const key = hit.masterId != null && hit.masterId > 0 ? `master:${hit.masterId}` : `release:${hit.id}`;
    const current = best.get(key);
    if (!current || (!current.main && hit.main) || (current.main === hit.main && hit.rank > current.rank)) best.set(key, hit);
  }
  return [...best.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ masterId: _masterId, main: _main, ...hit }) => hit);
}

function disambiguator(type: EntityType, record: NeoRecord): string | null {
  if (type === "artist") return asString(record.get("realname"));
  if (type === "release") {
    const parts = [numOrNull(record, "year"), asString(record.get("country"))].filter((part) => part != null);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return null;
}

function releaseHit(record: NeoRecord, score: number, reason: ReasonInput): Hit {
  const hit = baseHit("release", record, score, reason);
  hit.year = numOrNull(record, "year");
  hit.country = asString(record.get("country"));
  hit.genres = asStrings(record.get("genres"));
  hit.styles = asStrings(record.get("styles"));
  return hit;
}

function baseHit(type: EntityType, record: NeoRecord, score: number, reason: ReasonInput): Hit {
  return {
    type,
    id: num(record, "id"),
    name: String(record.get("name")),
    score,
    thumbUrl: asString(record.get("thumbUrl")),
    ...EMPTY_CARD,
    reason,
    bridges: [],
  };
}

function nameBridges(value: unknown): NameBridge[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: asNumber(item.id) ?? 0,
    name: String(item.name ?? ""),
    weight: Number(item.weight ?? 0),
  }));
}

function releaseBridges(value: unknown): ReleaseBridge[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    id: asNumber(item.id) ?? 0,
    title: String(item.title ?? ""),
    remix: Boolean(item.remix),
  }));
}

function uniqueBridges(bridges: { type: EntityType; id: number; name: string }[]) {
  const seen = new Set<string>();
  return bridges.filter((bridge) => {
    const key = `${bridge.type}:${bridge.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function num(record: NeoRecord, key: string): number {
  return asNumber(record.get(key)) ?? 0;
}

function numOrNull(record: NeoRecord, key: string): number | null {
  return asNumber(record.get(key));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toLucene(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  return tokens
    .map((token, index) => {
      const escaped = token.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
      // The bare term keeps Lucene's relevance score. A prefix alone is a constant score, so exact names tie with longer ones and fall off the limit.
      const term = index === tokens.length - 1 ? `(${escaped} OR ${escaped}*)` : escaped;
      return `+${term}`;
    })
    .join(" ");
}

async function run(query: string, params: Record<string, unknown> = {}): Promise<NeoRecord[]> {
  return withSession(async (session) => {
    const result = await session.run(query, params);
    return result.records;
  });
}
