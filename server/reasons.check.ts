import assert from "node:assert/strict";
import { catalogLine, creditSentence, formatReasons, formatScoreNote, releaseSpan } from "./reasons.js";

const labels = formatReasons([
  {
    seedName: "Warp",
    sharedArtists: [
      { id: 1, name: "Broadcast", weight: 0.2 },
      { id: 2, name: "Autechre", weight: 0.9 },
      { id: 3, name: "Boards of Canada", weight: 0.5 },
      { id: 4, name: "LFO", weight: 0.1 },
      { id: 5, name: "Nightmares on Wax", weight: 0.05 },
    ],
    sublabel: { relation: "sublabel", otherName: "Warp" },
  },
]);
assert.equal(
  labels.reason,
  "Sublabel of Warp. 5 shared artists, including Autechre, Boards of Canada, and Broadcast.",
);

const artists = formatReasons([
  {
    seedName: "Objekt",
    sharedLabels: [
      { id: 1, name: "Workshop", weight: 2 },
      { id: 2, name: "Dial", weight: 4 },
    ],
    sharedReleases: [{ id: 9, title: "K2", remix: true }],
  },
]);
assert.equal(artists.reason, '2 shared labels: Dial and Workshop. Together on "K2" (remix).');

const pair = formatReasons([
  { seedName: "Objekt", sharedLabels: [{ id: 1, name: "PAN", weight: 2 }, { id: 2, name: "Leisure System", weight: 1 }] },
  { seedName: "Call Super", sharedLabels: [{ id: 3, name: "Houndstooth", weight: 1 }] },
]);
assert.equal(
  pair.reason,
  "Via Objekt — 2 shared labels: PAN and Leisure System. Via Call Super — 1 shared label: Houndstooth.",
);

const releases = formatReasons([
  {
    seedName: "It's Elastic",
    sameLabels: ["Fever AM"],
    sameArtists: ["Workshop"],
    sharedStyles: ["Electro", "Techno"],
  },
]);
assert.equal(releases.reason, "Same label: Fever AM. Shared artist: Workshop. Shared styles: Electro and Techno.");

assert.equal(releaseSpan(9, 2016, 2023, true), "9 releases on this label, 2016–2023.");
assert.equal(releaseSpan(6, 2004, 2011, false), "6 releases, 2004–2011.");
assert.equal(releaseSpan(1, 2010, 2010, true), "1 release on this label, 2010.");
assert.equal(catalogLine("ABC-001", 2016), "ABC-001 · 2016.");
assert.equal(creditSentence(["Remix"], false), "Remix.");
assert.equal(creditSentence(["Appears"], true), "Appears on compilation.");
assert.equal(labels.scoreNote, "");

const catalog = formatScoreNote([
  { seedName: "Objekt", score: { kind: "catalog", primaryLabels: 2, appearLabels: 1, sharedReleases: 1 } },
]);
assert.equal(
  catalog,
  "Calculated from shared catalogue:\nA primary label counts 1, any other shared label 0.25, and a shared release 2.\n\n4.25 = 2 primary × 1 + 1 other × 0.25 + 1 release × 2.",
);

const roster = formatScoreNote([
  { seedName: "Warp", score: { kind: "roster", artistCount: 6, artistPoints: 3.2, family: "sublabel" } },
  { seedName: "Skam", score: { kind: "roster", artistCount: 1, artistPoints: 0.8, family: null } },
]);
assert.equal(
  roster,
  "Calculated from shared roster:\nArtists on both labels count more when primary on both, and less when an artist is on many labels.\nA parent or sublabel link adds 1.5.\n\nVia Warp: 4.7 = 6 artists (3.2) + sublabel (1.5).\nVia Skam: 0.8 = 1 artist (0.8).",
);

const similarRelease = formatScoreNote([
  {
    seedName: "It's Elastic",
    score: { kind: "release", labels: 1, primaryArtists: 1, creditPoints: 2, styles: 2, yearClose: true },
  },
]);
assert.equal(
  similarRelease,
  "Calculated from shared releases:\nA shared label counts 2.\nA shared primary artist counts 4.\nShared credits count 1, up to 3.\nA shared style counts 1, up to 3.\nReleases within 3 years count 1.\n\n11 = 1 label × 2 + 1 primary artist × 4 + 2 credits × 1 + 2 styles × 1 + within 3 years × 1.",
);

assert.equal(
  formatScoreNote([{ seedName: "Rhyw", score: { kind: "releases", count: 10, onLabel: false } }]),
  "10 releases connect them.",
);
assert.equal(
  formatScoreNote([{ seedName: "Warp", score: { kind: "releases", count: 1, onLabel: true } }]),
  "1 release on this label.",
);
assert.equal(
  formatScoreNote([{ seedName: "Forever", score: { kind: "credit" } }]),
  "Calculated from credits on this release:\nEach credit scores 1.",
);
assert.equal(
  formatScoreNote([{ seedName: "Fever AM", score: { kind: "issued" } }]),
  "Calculated from the label that issued this release:\nEach label scores 1.",
);

console.log("reason lines ok");
