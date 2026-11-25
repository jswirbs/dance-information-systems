import assert from "node:assert/strict";
import { test } from "node:test";
import { profileLinks } from "./siteLinks.js";

test("profile urls collapse to one icon per site, with the twitter bird for x.com", () => {
  const links = profileLinks([
    "https://soundcloud.com/rhyw",
    "https://www.instagram.com/rhyw",
    "https://rhyw.bandcamp.com/",
    "https://twitter.com/rhyw",
    "https://x.com/rhyw",
    "https://m.facebook.com/rhyw",
    "https://facebook.com/rhyw",
  ]);
  assert.deepEqual(
    links.map((link) => link.icon),
    ["soundcloud", "instagram", "bandcamp", "twitter", "facebook"],
  );
  assert.equal(links[3]?.href, "https://twitter.com/rhyw");
});

test("language wikipedia, youtube music, and apple music keep their own icons", () => {
  const links = profileLinks([
    "https://en.wikipedia.org/wiki/Rhyw",
    "https://en.m.wikipedia.org/wiki/Rhyw",
    "https://music.youtube.com/channel/abc",
    "https://youtu.be/abc",
    "https://music.apple.com/us/artist/rhyw/1",
    "https://itunes.apple.com/us/artist/rhyw/1",
    "https://ra.co/dj/rhyw",
    "https://www.residentadvisor.net/dj/rhyw",
  ]);
  assert.deepEqual(
    links.map((link) => [link.icon, link.label]),
    [
      ["wikipedia", "Wikipedia"],
      ["youtubemusic", "YouTube Music"],
      ["youtube", "YouTube"],
      ["applemusic", "Apple Music"],
      ["itunes", "iTunes"],
      ["ra", "Resident Advisor"],
    ],
  );
});

test("blogspot variants share the blogger icon, and other sites stay separate globes", () => {
  const links = profileLinks([
    "http://rhyw.blogspot.com/",
    "https://rhyw.blogspot.co.uk/2020/01/hello.html",
    "https://www.blogger.com/profile/1",
    "https://example.com/about",
    "https://blog.example.com/news",
    "https://other.org",
    "https://box.com/not-twitter",
  ]);
  assert.deepEqual(
    links.map((link) => [link.icon, link.label]),
    [
      ["blogger", "Blogger"],
      [null, "example.com"],
      [null, "other.org"],
      [null, "box.com"],
    ],
  );
});

test("loose discogs url text still resolves to the site", () => {
  const links = profileLinks([
    "instagram - instagram.com/rhyw",
    "facebook: facebook.com/rhyw",
    "[url=soundcloud.com/rhyw]",
    "lastfm.de/music/rhyw",
    "https://google.fr/search?q=rhyw",
  ]);
  assert.deepEqual(
    links.map((link) => link.icon),
    ["instagram", "facebook", "soundcloud", "lastfm", "google"],
  );
});
