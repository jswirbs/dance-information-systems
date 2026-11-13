import assert from "node:assert/strict";
import { catalogLine, creditSentence, formatReasons, releaseSpan } from "./reasons.js";

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

assert.equal(releaseSpan(9, 2016, 2023, true), "9 releases on this label, 2016–2023.");
assert.equal(releaseSpan(6, 2004, 2011, false), "6 releases, 2004–2011.");
assert.equal(releaseSpan(1, 2010, 2010, true), "1 release on this label, 2010.");
assert.equal(catalogLine("ABC-001", 2016), "ABC-001 · 2016.");
assert.equal(creditSentence(["Remix"], false), "Remix.");
assert.equal(creditSentence(["Appears"], true), "Appears on compilation.");

console.log("reason lines ok");
