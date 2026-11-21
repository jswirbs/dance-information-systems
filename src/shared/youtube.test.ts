import assert from "node:assert/strict";
import { test } from "node:test";
import { titlesMatch } from "./youtube.js";

test("titles match when they are the same phrase", () => {
  assert.equal(titlesMatch("Open Eye Signal", "Open Eye Signal (Official Video)"), true);
  assert.equal(titlesMatch("Go", "Go"), true);
});

test("a short title does not match a longer one by substring", () => {
  assert.equal(titlesMatch("Go", "Go Away"), false);
  assert.equal(titlesMatch("Open", "Open Eye Signal"), false);
});
