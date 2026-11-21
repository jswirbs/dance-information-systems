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

export type ScoreInput =
  | { kind: "catalog"; primaryLabels: number; appearLabels: number; sharedReleases: number }
  | { kind: "roster"; artistCount: number; artistPoints: number; family: "sublabel" | "parent" | null }
  | {
      kind: "release";
      labels: number;
      primaryArtists: number;
      creditPoints: number;
      styles: number;
      yearClose: boolean;
    }
  | { kind: "releases"; count: number; onLabel: boolean }
  | { kind: "credit" }
  | { kind: "issued" };

export type ReasonInput = {
  seedName: string;
  sublabel?: { relation: "sublabel" | "parent"; otherName: string };
  sharedArtists?: NameBridge[];
  sharedLabels?: NameBridge[];
  sharedReleases?: ReleaseBridge[];
  sameLabels?: string[];
  sameArtists?: string[];
  sharedStyles?: string[];
  direct?: string;
  score?: ScoreInput;
};

const CATALOG = "Calculated from shared catalogue:\nA primary label counts 1, any other shared label 0.25, and a shared release 2.";
const ROSTER =
  "Calculated from shared roster:\nArtists on both labels count more when primary on both, and less when an artist is on many labels.\nA parent or sublabel link adds 1.5.";
const RELEASE =
  "Calculated from shared releases:\nA shared label counts 2.\nA shared primary artist counts 4.\nShared credits count 1, up to 3.\nA shared style counts 1, up to 3.\nReleases within 3 years count 1.";

/** Turn per-seed pieces into the row sentence and the score tooltip. */
export function formatReasons(pieces: ReasonInput[]): { reason: string; reasons: ReasonPiece[]; scoreNote: string } {
  const scoreNote = formatScoreNote(pieces);
  const reasons = pieces
    .map((piece) => ({ seedName: piece.seedName, text: textOf(piece) }))
    .filter((piece) => piece.text.length > 0);
  if (reasons.length === 0) return { reason: "", reasons: [], scoreNote };
  if (reasons.length === 1) return { reason: reasons[0].text, reasons, scoreNote };
  return {
    reason: reasons.map((piece) => `Via ${piece.seedName} — ${piece.text}`).join(" "),
    reasons,
    scoreNote,
  };
}

export function formatScoreNote(pieces: Pick<ReasonInput, "seedName" | "score">[]): string {
  const scored = pieces.filter((piece): piece is { seedName: string; score: ScoreInput } => piece.score != null);
  if (scored.length === 0) return "";
  const kind = scored[0].score.kind;
  if (!scored.every((piece) => piece.score.kind === kind)) {
    return scored
      .map((piece) => {
        const note = singleScore(piece.score);
        return note ? `Via ${piece.seedName} — ${note}` : "";
      })
      .filter((note) => note.length > 0)
      .join(" ");
  }
  if (kind === "credit") {
    return scored.length > 1
      ? "Calculated from credits on these releases:\nEach credit scores 1. Those add up across the seeds."
      : "Calculated from credits on this release:\nEach credit scores 1.";
  }
  if (kind === "issued") {
    return scored.length > 1
      ? "Calculated from the labels that issued these releases:\nEach label scores 1. Those add up across the seeds."
      : "Calculated from the label that issued this release:\nEach label scores 1.";
  }
  if (kind === "releases") {
    return scored
      .map((piece) => {
        const sentence = piece.score.kind === "releases" ? releaseCountSentence(piece.score) : "";
        return scored.length === 1 ? sentence : `Via ${piece.seedName}: ${sentence}`;
      })
      .filter((line) => line.length > 0)
      .join("\n");
  }
  const lines = scored
    .map((piece) => ({ name: piece.seedName, equation: equation(piece.score) }))
    .filter((piece) => piece.equation.length > 0);
  if (lines.length === 0) return "";
  const math = lines.length === 1 ? lines[0].equation : lines.map((piece) => `Via ${piece.name}: ${piece.equation}`).join("\n");
  return `${ruleFor(kind)}\n\n${math}`;
}

function singleScore(score: ScoreInput): string {
  if (score.kind === "credit") return "Calculated from credits on this release:\nEach credit scores 1.";
  if (score.kind === "issued") return "Calculated from the label that issued this release:\nEach label scores 1.";
  if (score.kind === "releases") return releaseCountSentence(score);
  const math = equation(score);
  if (!math) return "";
  return `${ruleFor(score.kind)}\n\n${math}`;
}

function ruleFor(kind: "catalog" | "roster" | "release"): string {
  if (kind === "catalog") return CATALOG;
  if (kind === "roster") return ROSTER;
  return RELEASE;
}

function equation(score: ScoreInput): string {
  const parts = scoreParts(score);
  if (parts.length === 0) return "";
  return `${points(scoreValue(score))} = ${parts.join(" + ")}.`;
}

function scoreValue(score: ScoreInput): number {
  if (score.kind === "catalog") return score.primaryLabels + score.appearLabels * 0.25 + score.sharedReleases * 2;
  if (score.kind === "roster") return score.artistPoints + (score.family ? 1.5 : 0);
  if (score.kind === "release") {
    return score.labels * 2 + score.primaryArtists * 4 + score.creditPoints + score.styles + (score.yearClose ? 1 : 0);
  }
  if (score.kind === "releases") return score.count;
  return 1;
}

function releaseCountSentence(score: Extract<ScoreInput, { kind: "releases" }>): string {
  const noun = score.count === 1 ? "release" : "releases";
  if (score.onLabel) return `${amount(score.count)} ${noun} on this label.`;
  return `${amount(score.count)} ${noun} ${score.count === 1 ? "connects" : "connect"} them.`;
}

function scoreParts(score: ScoreInput): string[] {
  if (score.kind === "catalog") {
    const parts: string[] = [];
    if (score.primaryLabels > 0) parts.push(`${amount(score.primaryLabels)} primary × 1`);
    if (score.appearLabels > 0) parts.push(`${amount(score.appearLabels)} other × 0.25`);
    if (score.sharedReleases > 0) parts.push(`${amount(score.sharedReleases)} ${score.sharedReleases === 1 ? "release" : "releases"} × 2`);
    return parts;
  }
  if (score.kind === "roster") {
    const parts: string[] = [];
    if (score.artistCount > 0) parts.push(`${countPhrase(score.artistCount, "artist")} (${points(score.artistPoints)})`);
    if (score.family === "sublabel") parts.push("sublabel (1.5)");
    if (score.family === "parent") parts.push("parent (1.5)");
    return parts;
  }
  if (score.kind === "release") {
    const parts: string[] = [];
    if (score.labels > 0) parts.push(`${countPhrase(score.labels, "label")} × 2`);
    if (score.primaryArtists > 0) parts.push(`${countPhrase(score.primaryArtists, "primary artist")} × 4`);
    if (score.creditPoints > 0) parts.push(`${countPhrase(score.creditPoints, "credit")} × 1`);
    if (score.styles > 0) parts.push(`${countPhrase(score.styles, "style")} × 1`);
    if (score.yearClose) parts.push("within 3 years × 1");
    return parts;
  }
  return [];
}

function countPhrase(count: number, singular: string): string {
  return `${amount(count)} ${count === 1 ? singular : `${singular}s`}`;
}

function amount(count: number): string {
  return Number.isInteger(count) ? String(count) : points(count);
}

function points(value: number): string {
  return String(Math.round(value * 1000) / 1000);
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
  if (piece.sharedStyles && piece.sharedStyles.length > 0) sentences.push(sameSentence("style", piece.sharedStyles));
  if (piece.sharedReleases && piece.sharedReleases.length > 0) sentences.push(together(piece.sharedReleases));
  return sentences.join(" ");
}

function countSentence(count: number, singular: string, plural: string, names: string[]): string {
  const shown = names.slice(0, 3);
  const noun = count === 1 ? singular : plural;
  if (count <= 3) return `${count} ${noun}: ${joinNames(shown)}.`;
  return `${count} ${noun}, including ${joinNames(shown)}.`;
}

function sameSentence(kind: "label" | "artist" | "style", names: string[]): string {
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
