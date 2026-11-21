import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReleaseRecord } from "./records.js";

export const BRIDGE_ARTIST_IDS = [194, 355];

const CREDIT_ROLES = ["remix", "producer"];

export type FilterConfig = {
  styles: Set<string>;
  seedLabels: Set<string>;
  deniedPrefixes: string[];
};

export function loadFilterConfig(root = process.cwd()): FilterConfig {
  const readLines = (file: string) =>
    readFileSync(path.join(root, "config", file), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

  return {
    styles: new Set(readLines("styles.txt").map((line) => line.toLowerCase())),
    seedLabels: new Set(readLines("seed-labels.txt").map((line) => line.toLowerCase())),
    deniedPrefixes: readLines("denylist-labels.txt").map((line) => line.toLowerCase()),
  };
}

export function isDeniedLabel(name: string, config: FilterConfig): boolean {
  const normalized = name.trim().toLowerCase();
  return config.deniedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `) || normalized.startsWith(`${prefix}(`),
  );
}

/** Keep accepted electronic releases in the style list, plus anything on a seed label. */
export function keepRelease(release: ReleaseRecord, config: FilterConfig): boolean {
  // The monthly dump leaves status off and only includes accepted releases. The fixture still sets Deleted.
  if (release.status && release.status !== "Accepted") return false;
  const electronic =
    release.genres.some((genre) => genre.toLowerCase() === "electronic") &&
    release.styles.some((style) => config.styles.has(style.toLowerCase()));
  const seeded = release.labels.some((label) => config.seedLabels.has(label.name.toLowerCase()));
  return electronic || seeded;
}

export function isCompilation(release: ReleaseRecord): boolean {
  if (release.artists.some((artist) => artist.id === 194)) return true;
  return release.formats.some((format) =>
    format.descriptions.some((description) => description.toLowerCase() === "compilation"),
  );
}

export function creditRole(role: string): "remix" | "producer" | null {
  for (const part of role.split(",")) {
    const head = part.trim().toLowerCase().split("[")[0]?.trim() ?? "";
    if (CREDIT_ROLES.includes(head)) return head as "remix" | "producer";
  }
  return null;
}

export function yearFrom(released: string): number | null {
  const match = /^(\d{4})/.exec(released.trim());
  return match ? Number(match[1]) : null;
}
