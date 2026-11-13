import { readdirSync } from "node:fs";
import path from "node:path";
import { closeDriver } from "../src/db.js";
import { ingestFiles, type IngestStage } from "./load.js";

const fixture = process.argv.includes("--fixture");
const dataFlag = process.argv.indexOf("--data");
const dataDir = dataFlag >= 0 ? process.argv[dataFlag + 1] : null;
const from = readFrom(process.argv);

try {
  if (fixture) {
    const file = path.join(process.cwd(), "ingest", "fixtures", "mini.xml");
    await ingestFiles({ artists: file, labels: file, releases: file });
  } else if (dataDir) {
    const files = findDump(path.resolve(dataDir));
    await ingestFiles(files, { from });
  } else {
    console.error("Usage: pnpm ingest --fixture   or   pnpm ingest --data data [--from artists|labels|releases]");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDriver();
}

function readFrom(argv: string[]): IngestStage {
  const index = argv.indexOf("--from");
  if (index < 0) return "artists";
  const value = argv[index + 1];
  if (value === "artists" || value === "labels" || value === "releases") return value;
  throw new Error("--from must be artists, labels, or releases");
}

function findDump(dir: string): { artists: string; labels: string; releases: string } {
  const names = readdirSync(dir);
  const dates = new Set<string>();
  for (const name of names) {
    const match = /discogs_(\d{8})_(artists|labels|releases)\.xml/.exec(name);
    if (match) dates.add(match[1]);
  }
  const date = [...dates].sort().at(-1);
  if (!date) {
    throw new Error(`No discogs_YYYYMMDD_{artists,labels,releases}.xml[.gz] files in ${dir}`);
  }
  const pick = (kind: string) => {
    const gz = path.join(dir, `discogs_${date}_${kind}.xml.gz`);
    const xml = path.join(dir, `discogs_${date}_${kind}.xml`);
    if (names.includes(path.basename(gz))) return gz;
    if (names.includes(path.basename(xml))) return xml;
    throw new Error(`Missing ${kind} dump for ${date} in ${dir}`);
  };
  console.log(`Using dump ${date}`);
  return { artists: pick("artists"), labels: pick("labels"), releases: pick("releases") };
}
