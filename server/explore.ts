import { closeDriver } from "../src/db.js";
import type { EntityType } from "../src/shared/types.js";
import { related, search } from "./queries.js";

const args = process.argv.slice(2);
const target = readFlag(args, "--target") as EntityType | null;
const preferred = readFlag(args, "--type") as EntityType | null;
const names = args.filter((arg, index) => arg !== "--target" && arg !== "--type" && args[index - 1] !== "--target" && args[index - 1] !== "--type");

try {
  if (names.length === 0 || (target && !isType(target)) || (preferred && !isType(preferred))) {
    console.error('Usage: pnpm explore [--target artist|label|release] [--type artist|label|release] "Name" ["Name" ...]');
    process.exitCode = 1;
  } else {
    const seeds = [];
    for (const name of names) {
      const hits = await search(name);
      const hit = hits.find((candidate) => !preferred || candidate.type === preferred) ?? null;
      if (!hit || (preferred && hit.type !== preferred)) {
        console.log(`No match for ${name}`);
        continue;
      }
      console.log(`Seed ${hit.type} ${hit.name} (${hit.id})`);
      seeds.push({ type: hit.type, id: hit.id });
    }
    const targets: EntityType[] = target ? [target] : ["label", "artist", "release"];
    for (const list of targets) {
      console.log(`\n${list}s`);
      const rows = await related(seeds, list, 8);
      if (rows.length === 0) console.log("  none");
      for (const row of rows) {
        const extra = row.styles.length > 0 ? ` [${row.styles.join(", ")}]` : "";
        console.log(`  ${row.score.toFixed(3)}  ${row.name}${extra}`);
        console.log(`         ${row.reason}`);
      }
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDriver();
}

function readFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function isType(value: string): value is EntityType {
  return value === "artist" || value === "label" || value === "release";
}
