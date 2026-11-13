import type { ReasonPiece } from "../src/shared/types.js";

export type NameBridge = {
  id: number;
  name: string;
  weight: number;
};

export type ReleaseBridge = {
  id: number;
  title: string;
  remix: boolean;
};

export type ReasonInput = {
  seedName: string;
  sublabel?: { relation: "sublabel" | "parent"; otherName: string };
  sharedArtists?: NameBridge[];
  sharedLabels?: NameBridge[];
  sharedReleases?: ReleaseBridge[];
  sameLabels?: string[];
  sameArtists?: string[];
  direct?: string;
};

export function formatReasons(pieces: ReasonInput[]): { reason: string; reasons: ReasonPiece[] } {
  const reasons = pieces
    .map((piece) => ({ seedName: piece.seedName, text: textOf(piece) }))
    .filter((piece) => piece.text.length > 0);
  if (reasons.length === 0) return { reason: "", reasons: [] };
  if (reasons.length === 1) return { reason: reasons[0].text, reasons };
  return {
    reason: reasons.map((piece) => `Via ${piece.seedName} — ${piece.text}`).join(" "),
    reasons,
  };
}

export function releaseSpan(count: number, fromYear: number | null, toYear: number | null, onLabel: boolean): string {
  const noun = count === 1 ? "release" : "releases";
  const where = onLabel ? " on this label" : "";
  const years =
    fromYear == null ? "" : toYear == null || fromYear === toYear ? `, ${fromYear}` : `, ${fromYear}–${toYear}`;
  return `${count} ${noun}${where}${years}.`;
}

export function catalogLine(catno: string | null, year: number | null): string {
  if (catno && year != null) return `${catno} · ${year}.`;
  if (catno) return `${catno}.`;
  if (year != null) return `${year}.`;
  return "On this label.";
}

export function creditSentence(roles: string[], compilation: boolean): string {
  if (roles.includes("Primary")) return "Primary artist.";
  if (roles.includes("Remix")) return "Remix.";
  if (roles.includes("Producer")) return "Producer.";
  if (compilation || roles.includes("Appears")) return "Appears on compilation.";
  return "Credited.";
}

function textOf(piece: ReasonInput): string {
  if (piece.direct) return finish(piece.direct);
  const sentences: string[] = [];
  if (piece.sublabel?.relation === "sublabel") sentences.push(`Sublabel of ${piece.sublabel.otherName}.`);
  if (piece.sublabel?.relation === "parent") sentences.push(`Parent label of ${piece.sublabel.otherName}.`);
  if (piece.sharedArtists && piece.sharedArtists.length > 0) {
    const names = [...piece.sharedArtists]
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
      .map((artist) => artist.name);
    sentences.push(countSentence(piece.sharedArtists.length, "shared artist", "shared artists", names));
  }
  if (piece.sharedLabels && piece.sharedLabels.length > 0) {
    const names = [...piece.sharedLabels]
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
      .map((label) => label.name);
    sentences.push(countSentence(piece.sharedLabels.length, "shared label", "shared labels", names));
  }
  if (piece.sameLabels && piece.sameLabels.length > 0) sentences.push(sameSentence("label", piece.sameLabels));
  if (piece.sameArtists && piece.sameArtists.length > 0) sentences.push(sameSentence("artist", piece.sameArtists));
  if (piece.sharedReleases && piece.sharedReleases.length > 0) sentences.push(together(piece.sharedReleases));
  return sentences.join(" ");
}

function countSentence(count: number, singular: string, plural: string, names: string[]): string {
  const shown = names.slice(0, 3);
  const noun = count === 1 ? singular : plural;
  if (count <= 3) return `${count} ${noun}: ${joinNames(shown)}.`;
  return `${count} ${noun}, including ${joinNames(shown)}.`;
}

function sameSentence(kind: "label" | "artist", names: string[]): string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const noun = sorted.length === 1 ? kind : `${kind}s`;
  const verb = kind === "label" ? "Same" : "Shared";
  if (sorted.length <= 3) return `${verb} ${noun}: ${joinNames(sorted)}.`;
  return `${verb} ${noun}, including ${joinNames(sorted.slice(0, 3))}.`;
}

function together(releases: ReleaseBridge[]): string {
  const ordered = [...releases].sort((a, b) => Number(b.remix) - Number(a.remix) || a.title.localeCompare(b.title));
  const first = ordered[0];
  const remix = first.remix ? " (remix)" : "";
  if (ordered.length === 1) return `Together on "${first.title}"${remix}.`;
  return `Together on ${ordered.length} releases, including "${first.title}"${remix}.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function finish(sentence: string): string {
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}
