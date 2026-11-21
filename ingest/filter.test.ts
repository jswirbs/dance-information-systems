import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReleaseRecord } from "./records.js";
import { creditRole, keepRelease, yearFrom, type FilterConfig } from "./filter.js";

const config: FilterConfig = {
  styles: new Set(["house", "techno"]),
  seedLabels: new Set(["workshop"]),
  deniedPrefixes: [],
};

function release(partial: Partial<ReleaseRecord>): ReleaseRecord {
  return {
    discogsId: 1,
    status: "",
    title: "t",
    country: "",
    released: "",
    notes: "",
    dataQuality: "",
    masterId: null,
    isMainRelease: false,
    artists: [],
    labels: [],
    extraartists: [],
    formats: [],
    genres: [],
    styles: [],
    tracklist: [],
    identifiers: [],
    videos: [],
    companies: [],
    imageCount: 0,
    ...partial,
  };
}

test("keepRelease keeps styled electronic releases and seed labels", () => {
  assert.equal(
    keepRelease(release({ genres: ["Electronic"], styles: ["House"] }), config),
    true,
  );
  assert.equal(
    keepRelease(release({ genres: ["Electronic"], styles: ["Ambient"] }), config),
    false,
  );
  assert.equal(
    keepRelease(release({ genres: ["Blues"], labels: [{ id: 1, name: "Workshop", catno: "1" }] }), config),
    true,
  );
  assert.equal(keepRelease(release({ status: "Deleted", genres: ["Electronic"], styles: ["House"] }), config), false);
});

test("creditRole and yearFrom", () => {
  assert.equal(creditRole("Remix"), "remix");
  assert.equal(creditRole("Producer, Remix"), "producer");
  assert.equal(creditRole("Written-By"), null);
  assert.equal(yearFrom("1999-03-01"), 1999);
  assert.equal(yearFrom("Mar 1999"), null);
});
