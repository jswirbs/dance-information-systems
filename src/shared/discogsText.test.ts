import assert from "node:assert/strict";
import { test } from "node:test";
import { discogsKeys, discogsMentionUrl, emptyDiscogsLookup, linkDiscogsText, type DiscogsLookup } from "./discogsText.js";
import type { AboutMention, AboutRun } from "./types.js";

function mentions(runs: AboutRun[]): AboutMention[] {
  const found: AboutMention[] = [];
  for (const run of runs) {
    if (run.kind === "mention") found.push(run);
    else if (run.kind === "mark") found.push(...mentions(run.children));
  }
  return found;
}

function text(runs: AboutRun[]): string {
  return runs
    .map((run) => {
      if (run.kind === "text" || run.kind === "url") return run.text;
      if (run.kind === "mention") return run.name;
      return text(run.children);
    })
    .join("");
}

test("name links keep the disambiguator and the written capitalization of the prefix", () => {
  const runs = linkDiscogsText(
    "headed by [A=Nowhereman (2)] and [a=DJ Unitone]. Not [L=Vertigo Records (3)] or [l=Vertigo].",
    emptyDiscogsLookup(),
  );
  assert.deepEqual(
    mentions(runs).map((mention) => ({ entity: mention.entity, name: mention.name, inCatalog: mention.inCatalog })),
    [
      { entity: "artist", name: "Nowhereman (2)", inCatalog: false },
      { entity: "artist", name: "DJ Unitone", inCatalog: false },
      { entity: "label", name: "Vertigo Records (3)", inCatalog: false },
      { entity: "label", name: "Vertigo", inCatalog: false },
    ],
  );
  assert.equal(text(runs), "headed by Nowhereman (2) and DJ Unitone. Not Vertigo Records (3) or Vertigo.");
});

test("an unclosed name tag stays text and does not swallow the next link", () => {
  const runs = linkDiscogsText("see [a=Ital (3) and [a=Carl Craig].", emptyDiscogsLookup());
  assert.equal(text(runs), "see [a=Ital (3) and Carl Craig.");
  assert.deepEqual(mentions(runs).map((mention) => mention.name), ["Carl Craig"]);
});

test("id tags and equals-id tags resolve to the stored name", () => {
  const lookup = emptyDiscogsLookup();
  lookup.artistById.set(265405, "Vertigo");
  lookup.labelById.set(293581, "Philips");
  lookup.labelById.set(2266, "Vertigo");
  lookup.releaseById.set(590773, "Black Sabbath");
  lookup.releaseById.set(15703, "Domina");
  lookup.masterById.set(27265, { id: 3, name: "Profound Sounds Vol. 1" });
  const runs = linkDiscogsText(
    "launched by [l293581] in the [l2266] group. Logo by [a265405]. See [r590773], [r=15703], and [m27265].",
    lookup,
  );
  assert.deepEqual(
    mentions(runs).map((mention) => ({ entity: mention.entity, id: mention.id, name: mention.name, inCatalog: mention.inCatalog })),
    [
      { entity: "label", id: 293581, name: "Philips", inCatalog: true },
      { entity: "label", id: 2266, name: "Vertigo", inCatalog: true },
      { entity: "artist", id: 265405, name: "Vertigo", inCatalog: true },
      { entity: "release", id: 590773, name: "Black Sabbath", inCatalog: true },
      { entity: "release", id: 15703, name: "Domina", inCatalog: true },
      { entity: "release", id: 3, name: "Profound Sounds Vol. 1", inCatalog: true },
    ],
  );
});

test("a master we do not have stays a master, and a release we do not have keeps its id", () => {
  const runs = linkDiscogsText("See [m27265] and [r18832].", emptyDiscogsLookup());
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "master", id: 27265, name: "master 27265", inCatalog: false },
    { kind: "mention", entity: "release", id: 18832, name: "release 18832", inCatalog: false },
  ]);
  assert.equal(discogsMentionUrl(mentions(runs)[0]), "https://www.discogs.com/master/27265");
  assert.equal(discogsMentionUrl(mentions(runs)[1]), "https://www.discogs.com/release/18832");
});

test("a case difference uses the catalog name when that spelling is unique", () => {
  const lookup = emptyDiscogsLookup();
  lookup.labelByFold.set("Vertigo records", { id: 36426, name: "Vertigo Records" });
  const runs = linkDiscogsText("[L=Vertigo records] founder.", lookup);
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "label", id: 36426, name: "Vertigo Records", inCatalog: true },
  ]);
});

test("a name we cannot find has no id and searches Discogs", () => {
  const runs = linkDiscogsText("[a=Ital (3)]", emptyDiscogsLookup());
  const mention = mentions(runs)[0];
  assert.equal(mention.id, null);
  assert.equal(mention.inCatalog, false);
  assert.equal(discogsMentionUrl(mention), "https://www.discogs.com/search/?q=Ital%20(3)&type=artist");
});

test("a name can start with a digit, and an id tag is not a name that happens to be digits", () => {
  const lookup = emptyDiscogsLookup();
  lookup.labelByName.set("8th Bar", 8);
  lookup.artistById.set(4091, "De La Soul");
  const runs = linkDiscogsText("[l=8th Bar] and [a4091] and [a=4091]", lookup);
  assert.deepEqual(
    mentions(runs).map((mention) => ({ entity: mention.entity, id: mention.id, name: mention.name, inCatalog: mention.inCatalog })),
    [
      { entity: "label", id: 8, name: "8th Bar", inCatalog: true },
      { entity: "artist", id: 4091, name: "De La Soul", inCatalog: true },
      { entity: "artist", id: null, name: "4091", inCatalog: false },
    ],
  );
});

test("a discogs url slug still yields the id", () => {
  const runs = linkDiscogsText("[url=https://www.discogs.com/artist/4091-De-La-Soul]De La Soul[/url]", emptyDiscogsLookup());
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "artist", id: 4091, name: "De La Soul", inCatalog: false },
  ]);
});

test("exact names are the lookup keys, including the disambiguator", () => {
  const keys = discogsKeys("[a=Nowhereman (2)] and [l=Vertigo] and [l2266] and [m9]");
  assert.deepEqual(keys.artistNames, ["Nowhereman (2)"]);
  assert.deepEqual(keys.labelNames, ["Vertigo"]);
  assert.deepEqual(keys.labelIds, [2266]);
  assert.deepEqual(keys.masterIds, [9]);
});

test("found names link to that entity and keep the written label", () => {
  const lookup: DiscogsLookup = emptyDiscogsLookup();
  lookup.artistByName.set("Carl Craig", 42);
  const runs = linkDiscogsText("[a=Carl Craig]'s label, also [a= Carl Craig ].", lookup);
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "artist", id: 42, name: "Carl Craig", inCatalog: true },
    { kind: "mention", entity: "artist", id: 42, name: "Carl Craig", inCatalog: true },
  ]);
  assert.equal(text(runs), "Carl Craig's label, also Carl Craig.");
});

test("formatting wraps links, and an unclosed format tag stays text", () => {
  const lookup = emptyDiscogsLookup();
  lookup.artistByName.set("Pete Namlook", 7);
  const runs = linkDiscogsText("[b]NOT[/b] a label. [b][a=Pete Namlook][/b]. [b]not closed and [a=Pete Namlook]", lookup);
  assert.equal(runs[0]?.kind, "mark");
  if (runs[0]?.kind === "mark") assert.equal(runs[0].mark, "bold");
  assert.equal(text(runs), "NOT a label. Pete Namlook. [b]not closed and Pete Namlook");
  assert.equal(mentions(runs).length, 2);
});

test("external urls become links and discogs urls become entities", () => {
  const lookup = emptyDiscogsLookup();
  lookup.releaseById.set(961369, "LRCAN004");
  lookup.releaseById.set(3535883, "Music And Wine");
  const runs = linkDiscogsText(
    '[url=http://www.barcodezine.com/Peter%20Namlook%20Interview.html]interview[/url] and [url=http://www.discogs.com/release/961369]LRCAN004 12"[/url] and [url=http://www.discogs.com/Blue-Six-Music-And-Wine/release/3535883]Naked Music Classics cover[/url].',
    lookup,
  );
  assert.equal(runs[0]?.kind, "url");
  if (runs[0]?.kind === "url") assert.equal(runs[0].href, "http://www.barcodezine.com/Peter%20Namlook%20Interview.html");
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "release", id: 961369, name: 'LRCAN004 12"', inCatalog: true },
    { kind: "mention", entity: "release", id: 3535883, name: "Naked Music Classics cover", inCatalog: true },
  ]);
});

test("a discogs url for a release we do not have keeps the editor's words", () => {
  const runs = linkDiscogsText("[url=https://www.discogs.com/release/159649]Jazz Carnival[/url]", emptyDiscogsLookup());
  assert.deepEqual(mentions(runs), [
    { kind: "mention", entity: "release", id: 159649, name: "Jazz Carnival", inCatalog: false },
  ]);
});

test("a non-http url and an unknown tag are left alone", () => {
  const source = "[url=javascript:alert(1)]x[/url] [g1.2.3] [r=Domina]";
  const runs = linkDiscogsText(source, emptyDiscogsLookup());
  assert.deepEqual(runs, [{ kind: "text", text: source }]);
});

test("plain prose, including line breaks, is unchanged", () => {
  const source = "Line one.\r\n\r\nLine two.";
  assert.deepEqual(linkDiscogsText(source, emptyDiscogsLookup()), [{ kind: "text", text: source }]);
});
