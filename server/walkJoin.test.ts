import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntityType } from "../src/shared/types.js";
import { alignInteriorStops, joinWalks, type Walk } from "./walkJoin.js";

function node(type: EntityType, id: number) {
  return { type, id, name: String(id) };
}

function link(source: ReturnType<typeof node>, target: ReturnType<typeof node>): Walk<ReturnType<typeof node>>["links"][number] {
  return { source, target, kind: "PRIMARY_ON", startId: source.id };
}

function walk(nodes: Array<ReturnType<typeof node>>): Walk<ReturnType<typeof node>> {
  const links = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    links.push(link(nodes[index]!, nodes[index + 1]!));
  }
  return { nodes, links };
}

test("interior aliases join onto the stop the user picked", () => {
  const start = node("artist", 1);
  const release = node("release", 9);
  const aliasIn = node("artist", 20);
  const aliasOut = node("artist", 21);
  const stop = node("artist", 2);
  const end = node("label", 3);
  const joined = joinWalks(
    alignInteriorStops(
      [walk([start, release, aliasIn]), walk([aliasOut, end])],
      [start, stop, end],
      [[1], [2, 20, 21], [3]],
    ),
  );
  assert.ok(joined);
  assert.deepEqual(
    joined.nodes.map((item) => item.id),
    [1, 9, 2, 3],
  );
  assert.equal(joined.links.at(-1)?.source.id, 2);
});

test("a repeated node still refuses the walk", () => {
  const start = node("artist", 1);
  const middle = node("release", 9);
  const joined = joinWalks([walk([start, middle]), walk([middle, start])]);
  assert.equal(joined, null);
});
