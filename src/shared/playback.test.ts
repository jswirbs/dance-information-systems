import assert from "node:assert/strict";
import { test } from "node:test";
import { firstTitledTrackIndex, playbackProblemMessage } from "./playback.js";

test("the first titled track skips blank heading rows", () => {
  assert.equal(firstTitledTrackIndex([{ title: "" }, { title: "  " }, { title: "Open Eye Signal" }]), 2);
  assert.equal(firstTitledTrackIndex([{ title: "Go" }]), 0);
  assert.equal(firstTitledTrackIndex([]), -1);
});

test("playback problems say why nothing can play", () => {
  assert.equal(playbackProblemMessage("artist", "no_release"), "This artist has no releases.");
  assert.equal(playbackProblemMessage("label", "no_release"), "This label has no releases.");
  assert.equal(playbackProblemMessage("release", "no_tracks"), "This release has no tracks.");
  assert.equal(playbackProblemMessage("label", "no_tracks"), "The latest release has no tracks.");
  assert.equal(playbackProblemMessage("release", "no_video"), "No video found.");
  assert.equal(playbackProblemMessage("artist", "unavailable"), "Couldn't load playback.");
});
