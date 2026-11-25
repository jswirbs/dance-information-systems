export type SiteId = keyof typeof BRANDS;

export type ProfileLink = {
  key: string;
  href: string;
  label: string;
  icon: SiteId | null;
};

const BRANDS = {
  facebook: { label: "Facebook", suffixes: ["facebook.com", "fb.com", "fb.me"] },
  instagram: { label: "Instagram", suffixes: ["instagram.com"] },
  twitter: { label: "Twitter", suffixes: ["twitter.com", "x.com", "t.co"] },
  tiktok: { label: "TikTok", suffixes: ["tiktok.com"] },
  linkedin: { label: "LinkedIn", suffixes: ["linkedin.com"] },
  myspace: { label: "Myspace", suffixes: ["myspace.com"] },
  vk: { label: "VK", suffixes: ["vk.com", "vk.ru", "vkontakte.ru"] },
  threads: { label: "Threads", suffixes: ["threads.net", "threads.com"] },
  bluesky: { label: "Bluesky", suffixes: ["bsky.app", "bsky.social"] },
  pinterest: { label: "Pinterest", suffixes: ["pinterest.com"] },
  tumblr: { label: "Tumblr", suffixes: ["tumblr.com"] },
  flickr: { label: "Flickr", suffixes: ["flickr.com"] },
  weibo: { label: "Weibo", suffixes: ["weibo.com"] },
  twitch: { label: "Twitch", suffixes: ["twitch.tv"] },
  telegram: { label: "Telegram", suffixes: ["t.me", "telegram.me", "telegram.org"] },
  snapchat: { label: "Snapchat", suffixes: ["snapchat.com"] },
  reddit: { label: "Reddit", suffixes: ["reddit.com"] },
  discord: { label: "Discord", suffixes: ["discord.com", "discord.gg", "discordapp.com"] },
  youtube: { label: "YouTube", suffixes: ["youtube.com", "youtu.be"] },
  youtubemusic: { label: "YouTube Music", suffixes: ["music.youtube.com"] },
  vimeo: { label: "Vimeo", suffixes: ["vimeo.com"] },
  dailymotion: { label: "Dailymotion", suffixes: ["dailymotion.com"] },
  patreon: { label: "Patreon", suffixes: ["patreon.com"] },
  linktree: { label: "Linktree", suffixes: ["linktr.ee"] },
  behance: { label: "Behance", suffixes: ["behance.net"] },
  deviantart: { label: "DeviantArt", suffixes: ["deviantart.com"] },
  pixiv: { label: "Pixiv", suffixes: ["pixiv.net"] },
  soundcloud: { label: "SoundCloud", suffixes: ["soundcloud.com"] },
  bandcamp: { label: "Bandcamp", suffixes: ["bandcamp.com"] },
  spotify: { label: "Spotify", suffixes: ["spotify.com", "spoti.fi"] },
  applemusic: { label: "Apple Music", suffixes: ["music.apple.com"] },
  itunes: { label: "iTunes", suffixes: ["itunes.apple.com"] },
  mixcloud: { label: "Mixcloud", suffixes: ["mixcloud.com"] },
  beatport: { label: "Beatport", suffixes: ["beatport.com"] },
  deezer: { label: "Deezer", suffixes: ["deezer.com"] },
  lastfm: { label: "Last.fm", suffixes: ["last.fm"] },
  tidal: { label: "TIDAL", suffixes: ["tidal.com"] },
  discogs: { label: "Discogs", suffixes: ["discogs.com"] },
  ra: { label: "Resident Advisor", suffixes: ["ra.co", "residentadvisor.net"] },
  reverbnation: { label: "ReverbNation", suffixes: ["reverbnation.com"] },
  musicbrainz: { label: "MusicBrainz", suffixes: ["musicbrainz.org"] },
  genius: { label: "Genius", suffixes: ["genius.com"] },
  traxsource: { label: "Traxsource", suffixes: ["traxsource.com"] },
  hearthis: { label: "hearthis.at", suffixes: ["hearthis.at"] },
  songkick: { label: "Songkick", suffixes: ["songkick.com"] },
  bandsintown: { label: "Bandsintown", suffixes: ["bandsintown.com"] },
  shazam: { label: "Shazam", suffixes: ["shazam.com"] },
  audiomack: { label: "Audiomack", suffixes: ["audiomack.com"] },
  pandora: { label: "Pandora", suffixes: ["pandora.com"] },
  napster: { label: "Napster", suffixes: ["napster.com"] },
  iheart: { label: "iHeartRadio", suffixes: ["iheart.com"] },
  niconico: { label: "Niconico", suffixes: ["nicovideo.jp"] },
  bilibili: { label: "Bilibili", suffixes: ["bilibili.com"] },
  wikipedia: { label: "Wikipedia", suffixes: ["wikipedia.org"] },
  wikidata: { label: "Wikidata", suffixes: ["wikidata.org"] },
  imdb: { label: "IMDb", suffixes: ["imdb.com"] },
  archive: { label: "Internet Archive", suffixes: ["archive.org"] },
  google: { label: "Google", suffixes: ["google.com", "goo.gl"] },
  blogger: { label: "Blogger", suffixes: ["blogger.com"] },
} as const;

const MULTI = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "co.jp",
  "or.jp",
  "ne.jp",
  "ac.jp",
  "com.br",
  "co.nz",
  "co.za",
  "com.mx",
  "com.ar",
  "com.tr",
  "co.kr",
  "com.tw",
  "com.hk",
  "com.sg",
  "co.in",
  "com.ua",
  "com.pl",
  "com.co",
]);

type Matched = { id: string; label: string; icon: SiteId | null };

const SUFFIXES: { suffix: string; site: Matched }[] = [];
for (const id of Object.keys(BRANDS) as SiteId[]) {
  const brand = BRANDS[id];
  for (const suffix of brand.suffixes) {
    SUFFIXES.push({ suffix, site: { id, label: brand.label, icon: id } });
  }
}
SUFFIXES.sort((a, b) => b.suffix.length - a.suffix.length);

function labeled(host: string, label: string): boolean {
  const parts = host.split(".");
  if (parts[0] !== label) return false;
  if (parts.length === 2) return true;
  return parts.length === 3 && MULTI.has(parts.slice(1).join("."));
}

function siteForHost(host: string): Matched | null {
  if (host.split(".").includes("blogspot") || labeled(host, "blogger")) return { id: "blogger", label: BRANDS.blogger.label, icon: "blogger" };
  if (host === "last.fm" || host.endsWith(".last.fm") || labeled(host, "lastfm")) return { id: "lastfm", label: BRANDS.lastfm.label, icon: "lastfm" };
  if (host === "google.com" || host.endsWith(".google.com") || host === "goo.gl" || labeled(host, "google")) {
    return { id: "google", label: BRANDS.google.label, icon: "google" };
  }
  for (const entry of SUFFIXES) {
    if (host === entry.suffix || host.endsWith(`.${entry.suffix}`)) return entry.site;
  }
  return null;
}

export function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  if (MULTI.has(last2) && parts.length >= 3) return parts.slice(-3).join(".");
  return last2;
}

function cleanTail(value: string): string {
  return value.replace(/[)\].,;]+$/g, "");
}

function parseHttp(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function absoluteHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const embedded = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (embedded) {
    const parsed = parseHttp(cleanTail(embedded[0]));
    if (parsed) return parsed;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const parsed = parseHttp(cleanTail(`https://${trimmed}`));
    if (parsed) return parsed;
  }
  const domain = trimmed.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  if (!domain || domain.index == null) return null;
  const rest = cleanTail(trimmed.slice(domain.index).split(/\s/)[0] ?? "");
  return parseHttp(`https://${rest.replace(/^\/+/, "")}`);
}

/** One icon per site, in the order the URLs were listed. Unknown hosts collapse to their registrable domain. */
export function profileLinks(urls: string[]): ProfileLink[] {
  const seen = new Set<string>();
  const links: ProfileLink[] = [];
  for (const raw of urls) {
    const href = absoluteHttpUrl(raw);
    if (!href) continue;
    const host = new URL(href).hostname.replace(/^www\./i, "").toLowerCase();
    const site = siteForHost(host);
    const key = site ? site.id : `web:${registrableDomain(host)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      key,
      href,
      label: site?.label ?? registrableDomain(host),
      icon: site?.icon ?? null,
    });
  }
  return links;
}
