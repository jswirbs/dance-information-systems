import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import neo4j, { type Transaction } from "neo4j-driver";
import { BRIDGE_ARTIST_IDS, creditRole, isCompilation, isDeniedLabel, keepRelease, loadFilterConfig, yearFrom, type FilterConfig } from "./filter.js";
import { parseDiscogs } from "./parse.js";
import type { ArtistRecord, LabelRecord, ReleaseRecord } from "./records.js";
import { waitForNeo4j, withSession, write } from "../src/db.js";

const BATCH = 1000;
const RELEASE_BATCH = 40;

export type IngestStage = "artists" | "labels" | "releases";

type Edge = Record<string, string | number | null>;

export async function ingestFiles(
  files: { artists?: string; labels?: string; releases?: string },
  options: { from?: IngestStage } = {},
): Promise<void> {
  const from = options.from ?? "artists";
  const config = loadFilterConfig();
  await waitForNeo4j();
  if (from === "artists") await resetDatabase();
  else {
    console.log(`Keeping the existing graph and loading from ${from}.`);
    await ensureConstraints();
  }
  if (from === "artists" && files.artists) await loadArtists(files.artists);
  if ((from === "artists" || from === "labels") && files.labels) await loadLabels(files.labels, config);
  if (files.releases) await loadReleases(files.releases, config);
  await markDeniedLabels(config);
  await computeLabelCounts();
  await buildSearchIndexes();
  console.log("Ingest finished.");
}

async function resetDatabase(): Promise<void> {
  console.log("Clearing the graph and applying constraints.");
  // Search indexes are rebuilt after the load. Updating them inside every write is what filled the transaction memory pool.
  for (const name of ["artistSearch", "labelSearch", "releaseSearch"]) {
    await runAutocommit(`DROP INDEX ${name} IF EXISTS`);
  }
  await clearGraph();
  await ensureConstraints();
}

async function ensureConstraints(): Promise<void> {
  const schema = await readSchema();
  for (const statement of schemaStatements(schema)) {
    if (/FULLTEXT/i.test(statement)) continue;
    await runAutocommit(statement);
  }
}

async function loadArtists(file: string): Promise<void> {
  console.log(`Artists: ${file}`);
  const artists: ArtistRecord[] = [];
  let count = 0;
  await parseDiscogs(openXml(file), {
    artist: async (artist) => {
      artists.push(artist);
      count += 1;
      if (artists.length >= BATCH) await flushArtists(artists.splice(0, artists.length));
    },
  });
  await flushArtists(artists);
  console.log(`Artists stored: ${count}`);
}

async function loadLabels(file: string, config: FilterConfig): Promise<void> {
  console.log(`Labels: ${file}`);
  const labels: LabelRecord[] = [];
  let count = 0;
  await parseDiscogs(openXml(file), {
    label: async (label) => {
      labels.push(label);
      count += 1;
      if (labels.length >= BATCH) await flushLabels(labels.splice(0, labels.length), config);
    },
  });
  await flushLabels(labels, config);
  console.log(`Labels stored: ${count}`);
}

async function loadReleases(file: string, config: FilterConfig): Promise<void> {
  console.log(`Releases: ${file}`);
  const resumeAfter = await maxReleaseId();
  if (resumeAfter > 0) console.log(`Skipping releases already stored, through id ${resumeAfter}.`);
  const releases: ReleaseRecord[] = [];
  let seen = 0;
  let kept = 0;
  let skipped = 0;
  await parseDiscogs(openXml(file), {
    release: async (release) => {
      seen += 1;
      if (seen % 20000 === 0) console.log(`Releases scanned: ${seen}, kept: ${kept}, passed: ${skipped}`);
      if (release.discogsId <= resumeAfter) {
        skipped += 1;
        return;
      }
      if (!keepRelease(release, config)) return;
      releases.push(release);
      kept += 1;
      if (releases.length >= RELEASE_BATCH) await flushReleases(releases.splice(0, releases.length));
    },
  });
  await flushReleases(releases);
  console.log(`Releases scanned: ${seen}, kept: ${kept}, passed: ${skipped}`);
}

async function maxReleaseId(): Promise<number> {
  return withSession(async (session) => {
    const result = await session.run("MATCH (r:Release) RETURN max(r.discogsId) AS id");
    const value = result.records[0]?.get("id");
    if (value == null) return 0;
    return typeof value.toNumber === "function" ? value.toNumber() : Number(value);
  });
}

async function flushArtists(rows: ArtistRecord[]): Promise<void> {
  if (rows.length === 0) return;
  await writeChunked(rows, writeArtistChunk);
}

async function writeArtistChunk(rows: ArtistRecord[]): Promise<void> {
  await writeOnce(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (a:Artist {discogsId: row.discogsId})
       SET a.name = row.name,
           a.realname = row.realname,
           a.profile = row.profile,
           a.dataQuality = row.dataQuality,
           a.nameVariations = row.nameVariations,
           a.urls = row.urls,
           a.imageCount = row.imageCount,
           a.bridge = row.discogsId IN $bridgeIds`,
      { rows: rows.map(artistProps), bridgeIds: BRIDGE_ARTIST_IDS },
    );
    await tx.run(
      `UNWIND $edges AS edge
       MERGE (a:Artist {discogsId: edge.from})
       MERGE (b:Artist {discogsId: edge.to})
       ON CREATE SET b.name = edge.name
       MERGE (a)-[:ALIAS_OF]->(b)`,
      { edges: rows.flatMap((artist) => artist.aliases.map((alias) => ({ from: artist.discogsId, to: alias.id, name: alias.name }))) },
    );
    await tx.run(
      `UNWIND $edges AS edge
       MERGE (a:Artist {discogsId: edge.from})
       ON CREATE SET a.name = edge.fromName
       MERGE (b:Artist {discogsId: edge.to})
       ON CREATE SET b.name = edge.toName
       MERGE (a)-[:MEMBER_OF]->(b)`,
      {
        edges: [
          ...rows.flatMap((artist) =>
            artist.groups.map((group) => ({
              from: artist.discogsId,
              fromName: artist.name,
              to: group.id,
              toName: group.name,
            })),
          ),
          ...rows.flatMap((artist) =>
            artist.members.map((member) => ({
              from: member.id,
              fromName: member.name,
              to: artist.discogsId,
              toName: artist.name,
            })),
          ),
        ],
      },
    );
  });
}

async function flushLabels(rows: LabelRecord[], config: FilterConfig): Promise<void> {
  if (rows.length === 0) return;
  await writeChunked(rows, (chunk) => writeLabelChunk(chunk, config));
}

async function writeLabelChunk(rows: LabelRecord[], config: FilterConfig): Promise<void> {
  await writeOnce(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (l:Label {discogsId: row.discogsId})
       SET l.name = row.name,
           l.contactInfo = row.contactInfo,
           l.profile = row.profile,
           l.dataQuality = row.dataQuality,
           l.urls = row.urls,
           l.imageCount = row.imageCount,
           l.denied = row.denied`,
      {
        rows: rows.map((label) => ({
          discogsId: label.discogsId,
          name: label.name,
          contactInfo: label.contactInfo,
          profile: label.profile,
          dataQuality: label.dataQuality,
          urls: label.urls,
          imageCount: label.imageCount,
          denied: isDeniedLabel(label.name, config),
        })),
      },
    );
    const edges = rows.flatMap((label) => {
      const links: Edge[] = label.sublabels.map((sublabel) => ({
        child: sublabel.id,
        childName: sublabel.name,
        parent: label.discogsId,
        parentName: label.name,
      }));
      if (label.parentLabel) {
        links.push({
          child: label.discogsId,
          childName: label.name,
          parent: label.parentLabel.id,
          parentName: label.parentLabel.name,
        });
      }
      return links;
    });
    await tx.run(
      `UNWIND $edges AS edge
       MERGE (child:Label {discogsId: edge.child})
       ON CREATE SET child.name = edge.childName
       MERGE (parent:Label {discogsId: edge.parent})
       ON CREATE SET parent.name = edge.parentName
       MERGE (child)-[:SUBLABEL_OF]->(parent)`,
      { edges },
    );
  });
}

async function flushReleases(rows: ReleaseRecord[]): Promise<void> {
  if (rows.length === 0) return;
  await writeChunked(rows, writeReleaseChunk);
}

async function writeReleaseChunk(rows: ReleaseRecord[]): Promise<void> {
  const releaseRows = rows.map((release) => {
    const compilation = isCompilation(release);
    const credits = creditsFor(release);
    return {
      discogsId: release.discogsId,
      title: release.title,
      country: release.country,
      released: release.released,
      year: yearFrom(release.released),
      notes: release.notes,
      dataQuality: release.dataQuality,
      masterId: release.masterId,
      isMainRelease: release.isMainRelease,
      genres: release.genres,
      styles: release.styles,
      formatNames: [...new Set(release.formats.map((format) => format.name).filter(Boolean))],
      formatSummary: release.formats.map(formatLine).filter(Boolean),
      credits: JSON.stringify(credits),
      tracklist: JSON.stringify(
        release.tracklist.map((track) => ({
          position: track.position,
          title: track.title,
          duration: track.duration,
          artists: track.artists.map(({ id, name, anv }) => ({ id, name, anv })),
        })),
      ),
      companies: JSON.stringify(release.companies),
      videos: JSON.stringify(release.videos),
      identifiers: JSON.stringify(release.identifiers),
      imageCount: release.imageCount,
      compilation,
    };
  });

  const issued: Edge[] = [];
  const primary: Edge[] = [];
  const appears: Edge[] = [];
  const remixed: Edge[] = [];

  for (const release of rows) {
    const compilation = isCompilation(release);
    const year = yearFrom(release.released);
    for (const label of release.labels) {
      if (!label.id) continue;
      issued.push({ releaseId: release.discogsId, labelId: label.id, labelName: label.name, catno: label.catno });
    }
    for (const artist of release.artists) {
      if (!artist.id) continue;
      primary.push(creditEdge(release.discogsId, artist, year, "Primary"));
    }
    for (const artist of release.extraartists) pushCredit(remixed, appears, compilation, release.discogsId, artist, year, false);
    for (const track of release.tracklist) {
      for (const artist of track.extraartists) pushCredit(remixed, appears, compilation, release.discogsId, artist, year, true);
      if (compilation) {
        for (const artist of track.artists) {
          if (!artist.id || release.artists.some((main) => main.id === artist.id)) continue;
          appears.push(creditEdge(release.discogsId, artist, year, "Appears"));
        }
      }
    }
  }

  await writeOnce(async (tx) => {
    await tx.run(
      `UNWIND $rows AS row
       MERGE (r:Release {discogsId: row.discogsId})
       SET r.title = row.title,
           r.country = row.country,
           r.released = row.released,
           r.year = row.year,
           r.notes = row.notes,
           r.dataQuality = row.dataQuality,
           r.masterId = row.masterId,
           r.isMainRelease = row.isMainRelease,
           r.genres = row.genres,
           r.styles = row.styles,
           r.formatNames = row.formatNames,
           r.formatSummary = row.formatSummary,
           r.credits = row.credits,
           r.tracklist = row.tracklist,
           r.companies = row.companies,
           r.videos = row.videos,
           r.identifiers = row.identifiers,
           r.imageCount = row.imageCount,
           r.compilation = row.compilation`,
      { rows: releaseRows },
    );
    await tx.run(
      `UNWIND $rows AS row
       MATCH (r:Release {discogsId: row.releaseId})
       MERGE (l:Label {discogsId: row.labelId})
       ON CREATE SET l.name = row.labelName
       MERGE (l)-[edge:ISSUED]->(r)
       SET edge.catno = row.catno`,
      { rows: issued },
    );
    await writeCredit(tx, "PRIMARY_ON", primary);
    await writeCredit(tx, "APPEARS_ON", appears);
    await writeCredit(tx, "REMIXED", remixed);
  });
}

function pushCredit(
  remixed: Edge[],
  appears: Edge[],
  compilation: boolean,
  releaseId: number,
  artist: { id: number; name: string; anv: string; role: string },
  year: number | null,
  fromTrack: boolean,
): void {
  if (!artist.id) return;
  const role = creditRole(artist.role);
  if (role) {
    remixed.push(creditEdge(releaseId, artist, year, role === "remix" ? "Remix" : "Producer"));
    return;
  }
  if (compilation && fromTrack) appears.push(creditEdge(releaseId, artist, year, "Appears"));
}

function creditEdge(
  releaseId: number,
  artist: { id: number; name: string; anv: string },
  year: number | null,
  role: string,
): Edge {
  return { releaseId, artistId: artist.id, artistName: artist.name, anv: artist.anv, year, role };
}

async function writeCredit(tx: { run: (query: string, params?: object) => Promise<unknown> }, type: string, rows: Edge[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.run(
    `UNWIND $rows AS row
     MATCH (r:Release {discogsId: row.releaseId})
     MERGE (a:Artist {discogsId: row.artistId})
     ON CREATE SET a.name = row.artistName
     MERGE (a)-[edge:${type}]->(r)
     SET edge.anv = row.anv, edge.year = row.year, edge.role = row.role`,
    { rows },
  );
}

function creditsFor(release: ReleaseRecord) {
  const main = release.artists.map((artist) => ({
    id: artist.id,
    name: artist.name,
    anv: artist.anv,
    role: artist.role || "Main",
    scope: "release" as const,
  }));
  const extra = release.extraartists.map((artist) => ({
    id: artist.id,
    name: artist.name,
    anv: artist.anv,
    role: artist.role,
    scope: "release" as const,
  }));
  const tracks = release.tracklist.flatMap((track) =>
    [...track.artists, ...track.extraartists].map((artist) => ({
      id: artist.id,
      name: artist.name,
      anv: artist.anv,
      role: artist.role,
      scope: "track" as const,
      track: track.title,
    })),
  );
  return [...main, ...extra, ...tracks];
}

function formatLine(format: ReleaseRecord["formats"][number]): string {
  const parts = [...format.descriptions, format.name, format.text].filter(Boolean);
  return parts.join(" ");
}

function artistProps(artist: ArtistRecord) {
  return {
    discogsId: artist.discogsId,
    name: artist.name,
    realname: artist.realname,
    profile: artist.profile,
    dataQuality: artist.dataQuality,
    nameVariations: artist.nameVariations,
    urls: artist.urls,
    imageCount: artist.imageCount,
  };
}

async function markDeniedLabels(config: FilterConfig): Promise<void> {
  await runAutocommit(
    `MATCH (l:Label)
     WHERE any(prefix IN $prefixes WHERE toLower(l.name) = prefix OR toLower(l.name) STARTS WITH prefix + ' ' OR toLower(l.name) STARTS WITH prefix + '(')
     CALL {
       WITH l
       SET l.denied = true
     } IN TRANSACTIONS OF 1000 ROWS`,
    { prefixes: config.deniedPrefixes },
  );
}

async function computeLabelCounts(): Promise<void> {
  console.log("Counting labels per artist.");
  await write(async (tx) => {
    await tx.run(`MATCH (a:Artist) WHERE a.discogsId IN $bridgeIds SET a.bridge = true`, {
      bridgeIds: BRIDGE_ARTIST_IDS,
    });
  });
  await runAutocommit(
    `MATCH (a:Artist)
     CALL {
       WITH a
       OPTIONAL MATCH (a)-[:PRIMARY_ON]->(:Release)<-[:ISSUED]-(l:Label)
       WHERE coalesce(l.denied, false) = false
       WITH a, count(DISTINCT l) AS labelCount
       SET a.labelCount = labelCount
     } IN TRANSACTIONS OF 2000 ROWS`,
  );
}

async function buildSearchIndexes(): Promise<void> {
  console.log("Building search indexes.");
  const schema = await readSchema();
  for (const statement of schemaStatements(schema)) {
    if (!/FULLTEXT/i.test(statement)) continue;
    await runAutocommit(statement);
  }
}

function schemaStatements(schema: string): string[] {
  return schema.split(";").map((part) => part.trim()).filter(Boolean);
}

function readSchema(): Promise<string> {
  return readFile(path.join(process.cwd(), "ingest", "schema.cypher"), "utf8");
}

async function clearGraph(): Promise<void> {
  let size = 2000;
  let total = 0;
  while (true) {
    let deleted = 0;
    try {
      deleted = await deleteBatch(size);
    } catch (error) {
      if (!isMemoryError(error) || size <= 100) throw error;
      size = Math.floor(size / 2);
      console.log(`Transaction memory limit hit while deleting. Retrying in batches of ${size}.`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (deleted === 0) break;
    total += deleted;
    if (total % 100000 < deleted) console.log(`Deleted ${total} nodes.`);
  }
}

async function deleteBatch(size: number): Promise<number> {
  return writeOnce(async (tx) => {
    const result = await tx.run(
      `MATCH (n)
       WITH n LIMIT $size
       DETACH DELETE n
       RETURN count(*) AS deleted`,
      { size: neo4j.int(size) },
    );
    const value = result.records[0]?.get("deleted");
    return typeof value?.toNumber === "function" ? value.toNumber() : Number(value ?? 0);
  });
}

async function runAutocommit(statement: string, params?: object): Promise<void> {
  await withSession(async (session) => {
    await session.run(statement, params);
  });
}

async function writeOnce<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withSession(async (session) => {
    const tx = session.beginTransaction();
    try {
      const value = await fn(tx);
      await tx.commit();
      return value;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  });
}

async function writeChunked<T>(rows: T[], flush: (chunk: T[]) => Promise<void>): Promise<void> {
  await writeChunkedAttempt(rows, flush, 0);
}

async function writeChunkedAttempt<T>(rows: T[], flush: (chunk: T[]) => Promise<void>, attempt: number): Promise<void> {
  try {
    await flush(rows);
  } catch (error) {
    const connection = isConnectionError(error);
    if (connection && attempt < 2) {
      console.log(`Neo4j stopped responding. Retrying ${rows.length} rows.`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      await writeChunkedAttempt(rows, flush, attempt + 1);
      return;
    }
    if ((isMemoryError(error) || connection) && rows.length >= 2) {
      const mid = Math.floor(rows.length / 2);
      const reason = isMemoryError(error) ? "Transaction memory limit hit" : "Neo4j stopped responding";
      console.log(`${reason} on ${rows.length} rows. Retrying as ${mid} and ${rows.length - mid}.`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await writeChunkedAttempt(rows.slice(0, mid), flush, 0);
      await writeChunkedAttempt(rows.slice(mid), flush, 0);
      return;
    }
    throw error;
  }
}

function isMemoryError(error: unknown): boolean {
  return errorCode(error) === "Neo.TransientError.General.MemoryPoolOutOfMemoryError";
}

function isConnectionError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ServiceUnavailable" || code === "SessionExpired" || code === "Neo.TransientError.General.DatabaseUnavailable";
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String((error as { code?: string }).code ?? "");
}

function openXml(file: string): Readable {
  const stream = createReadStream(file);
  if (file.endsWith(".gz")) return stream.pipe(createGunzip());
  return stream;
}
