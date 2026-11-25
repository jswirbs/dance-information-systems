import type { SiteId } from "../../src/shared/siteLinks";
import applemusic from "simple-icons/icons/applemusic.svg?raw";
import audiomack from "simple-icons/icons/audiomack.svg?raw";
import bandcamp from "simple-icons/icons/bandcamp.svg?raw";
import bandsintown from "simple-icons/icons/bandsintown.svg?raw";
import beatport from "simple-icons/icons/beatport.svg?raw";
import behance from "simple-icons/icons/behance.svg?raw";
import bilibili from "simple-icons/icons/bilibili.svg?raw";
import blogger from "simple-icons/icons/blogger.svg?raw";
import bluesky from "simple-icons/icons/bluesky.svg?raw";
import dailymotion from "simple-icons/icons/dailymotion.svg?raw";
import deezer from "simple-icons/icons/deezer.svg?raw";
import deviantart from "simple-icons/icons/deviantart.svg?raw";
import discogs from "simple-icons/icons/discogs.svg?raw";
import discord from "simple-icons/icons/discord.svg?raw";
import facebook from "simple-icons/icons/facebook.svg?raw";
import flickr from "simple-icons/icons/flickr.svg?raw";
import genius from "simple-icons/icons/genius.svg?raw";
import google from "simple-icons/icons/google.svg?raw";
import hearthis from "simple-icons/icons/hearthisdotat.svg?raw";
import iheart from "simple-icons/icons/iheartradio.svg?raw";
import imdb from "simple-icons/icons/imdb.svg?raw";
import instagram from "simple-icons/icons/instagram.svg?raw";
import archive from "simple-icons/icons/internetarchive.svg?raw";
import itunes from "simple-icons/icons/itunes.svg?raw";
import lastfm from "simple-icons/icons/lastdotfm.svg?raw";
import linktree from "simple-icons/icons/linktree.svg?raw";
import mixcloud from "simple-icons/icons/mixcloud.svg?raw";
import musicbrainz from "simple-icons/icons/musicbrainz.svg?raw";
import myspace from "simple-icons/icons/myspace.svg?raw";
import napster from "simple-icons/icons/napster.svg?raw";
import niconico from "simple-icons/icons/niconico.svg?raw";
import pandora from "simple-icons/icons/pandora.svg?raw";
import patreon from "simple-icons/icons/patreon.svg?raw";
import pinterest from "simple-icons/icons/pinterest.svg?raw";
import pixiv from "simple-icons/icons/pixiv.svg?raw";
import reddit from "simple-icons/icons/reddit.svg?raw";
import reverbnation from "simple-icons/icons/reverbnation.svg?raw";
import shazam from "simple-icons/icons/shazam.svg?raw";
import weibo from "simple-icons/icons/sinaweibo.svg?raw";
import snapchat from "simple-icons/icons/snapchat.svg?raw";
import songkick from "simple-icons/icons/songkick.svg?raw";
import soundcloud from "simple-icons/icons/soundcloud.svg?raw";
import spotify from "simple-icons/icons/spotify.svg?raw";
import telegram from "simple-icons/icons/telegram.svg?raw";
import threads from "simple-icons/icons/threads.svg?raw";
import tidal from "simple-icons/icons/tidal.svg?raw";
import tiktok from "simple-icons/icons/tiktok.svg?raw";
import traxsource from "simple-icons/icons/traxsource.svg?raw";
import tumblr from "simple-icons/icons/tumblr.svg?raw";
import twitch from "simple-icons/icons/twitch.svg?raw";
import vimeo from "simple-icons/icons/vimeo.svg?raw";
import vk from "simple-icons/icons/vk.svg?raw";
import wikidata from "simple-icons/icons/wikidata.svg?raw";
import wikipedia from "simple-icons/icons/wikipedia.svg?raw";
import youtube from "simple-icons/icons/youtube.svg?raw";
import youtubemusic from "simple-icons/icons/youtubemusic.svg?raw";

// simple-icons 16 dropped these. The paths are the CC0 marks from 9.21.0 (bird) and 13.21.0 (LinkedIn).
const TWITTER =
  "M21.543 7.104c.015.211.015.423.015.636 0 6.507-4.954 14.01-14.01 14.01v-.003A13.94 13.94 0 0 1 0 19.539a9.88 9.88 0 0 0 7.287-2.041 4.93 4.93 0 0 1-4.6-3.42 4.916 4.916 0 0 0 2.223-.084A4.926 4.926 0 0 1 .96 9.167v-.062a4.887 4.887 0 0 0 2.235.616A4.928 4.928 0 0 1 1.67 3.148 13.98 13.98 0 0 0 11.82 8.292a4.929 4.929 0 0 1 8.39-4.49 9.868 9.868 0 0 0 3.128-1.196 4.941 4.941 0 0 1-2.165 2.724A9.828 9.828 0 0 0 24 4.555a10.019 10.019 0 0 1-2.457 2.549z";
const LINKEDIN =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";
// simple-icons declined this mark. This is the icon RA publishes for browser tabs.
const RA =
  "M.2 544.2l.3 200.3 172 .1c94.6.1 173.8.4 176 .8 7.7 1.4 19.1 5.8 27 10.3 8.2 4.8 17.6 14 184 181.4 9.1 9.1 16.5 16.5 16.5 16.4 0-.1 1.8 1.5 4 3.6 11 10.4 35.1 22.7 48 24.4 1.4.2 4.5.8 7 1.4 3.1.7 88.6 1 266.5 1h262l9.3-2.4c15-3.9 28.8-12.1 40.2-23.8 1.9-2 26.6-26.9 54.8-55.3 28.1-28.3 51.2-51.9 51.2-52.4s.6-1.5 1.3-2.2c6-6.3 9.2-24.2 6.4-35.8-1.4-5.8-5.6-13.6-9.9-18.5-2.4-2.7-31.1-31.9-63.8-64.8-32.7-32.8-96.2-96.6-141-141.7-44.8-45.1-102.2-102.7-127.4-128l-45.9-46.1-5.1 4.8c-2.8 2.6-5.3 5.1-5.6 5.5-.3.4-23.5 23.8-51.6 52.1l-51 51.3 29.4 29.4c145.5 146.1 264.2 265.7 264.4 266.4.3 1-416.6 1.1-425.7.1-10.7-1.2-26.7-7.7-34.4-13.9-2.2-1.8-50.1-49.7-168.9-168.9-14.7-14.8-28.7-28.6-31.2-30.6-11.1-9.4-30.1-19.4-41-21.6-.8-.2-3.4-.8-5.7-1.4-2.4-.7-6.6-1.4-9.5-1.8-2.9-.3-58.4-.7-123.3-.8-64.9-.1-118.4-.3-118.8-.4-.5 0-.7-3-.5-6.6.1-3.6-.1-6.5-.5-6.5-.5 0-.5-.5-.2-1 .4-.6.6-3.6.6-6.8-.1-3.1-.1-6.4-.1-7.2 0-.8.1-7 .2-13.8.2-6.7 0-12.2-.4-12.2s-.5-.6-.2-1.4c.9-2.3 1-10.6.1-10.6-.5 0-.5-.5-.1-1.1.3-.6.6-3.3.5-6l-.1-4.9 5.8-.1c34.6-.3 241.1.1 245.2.5 8.7.9 15.5 1.8 16 2.1.3.2 2.5.6 5 1 2.4.4 5.2 1.1 6.2 1.6s1.8.7 1.8.5c0-.3 1.9.2 4.3 1 2.3.9 4.9 1.7 5.7 1.9 6.2 1.3 30.6 12.9 37.4 17.7 5.8 4.1 17.6 13 19.6 14.7 4.5 4 21.8 21.2 86.2 85.9l63.7 64 49.3-49.5c27.1-27.2 52.6-52.7 56.6-56.7l7.4-7.3-45.6-45.9c-25.1-25.3-46.5-46.8-47.5-47.9-1-1.1-2.9-3-4.2-4.1-1.3-1.2-11.4-11.2-22.4-22.3-22.1-22.4-34.7-34.6-42-40.6-2.7-2.2-5.3-4.5-5.9-5-.6-.6-2.9-2.3-5.1-3.9-2.2-1.7-4.2-3.3-4.5-3.6-1.1-1.3-29-20-29-19.4 0 .3-1.2-.4-2.8-1.4-4-2.9-26.5-14.3-35.2-17.9-13.9-5.8-23.5-9.3-25-9.3-.9 0-2-.4-2.5-.8-.8-.7-7-2.8-11-3.8-.5-.1-6.6-1.6-13.5-3.3-10.9-2.6-16.9-3.7-35.5-6.6-2.2-.3-6.2-.9-9-1.2-2.7-.3-100.5-.8-217.3-1L0 343.9l.2 200.3z";

function iconPath(svg: string): string {
  const match = /d="([^"]+)"/.exec(svg);
  if (!match?.[1]) throw new Error("simple-icons svg has no path");
  return match[1];
}

const PATHS = {
  applemusic: iconPath(applemusic),
  audiomack: iconPath(audiomack),
  bandcamp: iconPath(bandcamp),
  bandsintown: iconPath(bandsintown),
  beatport: iconPath(beatport),
  behance: iconPath(behance),
  bilibili: iconPath(bilibili),
  blogger: iconPath(blogger),
  bluesky: iconPath(bluesky),
  dailymotion: iconPath(dailymotion),
  deezer: iconPath(deezer),
  deviantart: iconPath(deviantart),
  discogs: iconPath(discogs),
  discord: iconPath(discord),
  facebook: iconPath(facebook),
  flickr: iconPath(flickr),
  genius: iconPath(genius),
  google: iconPath(google),
  hearthis: iconPath(hearthis),
  iheart: iconPath(iheart),
  imdb: iconPath(imdb),
  instagram: iconPath(instagram),
  archive: iconPath(archive),
  itunes: iconPath(itunes),
  lastfm: iconPath(lastfm),
  linkedin: LINKEDIN,
  linktree: iconPath(linktree),
  mixcloud: iconPath(mixcloud),
  musicbrainz: iconPath(musicbrainz),
  myspace: iconPath(myspace),
  napster: iconPath(napster),
  niconico: iconPath(niconico),
  pandora: iconPath(pandora),
  patreon: iconPath(patreon),
  pinterest: iconPath(pinterest),
  pixiv: iconPath(pixiv),
  ra: RA,
  reddit: iconPath(reddit),
  reverbnation: iconPath(reverbnation),
  shazam: iconPath(shazam),
  snapchat: iconPath(snapchat),
  songkick: iconPath(songkick),
  soundcloud: iconPath(soundcloud),
  spotify: iconPath(spotify),
  telegram: iconPath(telegram),
  threads: iconPath(threads),
  tidal: iconPath(tidal),
  tiktok: iconPath(tiktok),
  traxsource: iconPath(traxsource),
  tumblr: iconPath(tumblr),
  twitch: iconPath(twitch),
  twitter: TWITTER,
  vimeo: iconPath(vimeo),
  vk: iconPath(vk),
  weibo: iconPath(weibo),
  wikidata: iconPath(wikidata),
  wikipedia: iconPath(wikipedia),
  youtube: iconPath(youtube),
  youtubemusic: iconPath(youtubemusic),
} satisfies Record<SiteId, string>;

const VIEWBOX: Partial<Record<SiteId, string>> = {
  ra: "0 320 1328 688",
};

export function SiteIcon({ id }: { id: SiteId | null }) {
  if (!id) return <WebsiteIcon />;
  const wide = id === "ra";
  return (
    <svg className={wide ? "site-icon site-icon-wide" : "site-icon"} viewBox={VIEWBOX[id] ?? "0 0 24 24"} aria-hidden="true">
      <path d={PATHS[id]} />
    </svg>
  );
}

function WebsiteIcon() {
  return (
    <svg className="site-web" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.7 4 5.7 4 9s-1.4 6.3-4 9c-2.6-2.7-4-5.7-4-9s1.4-6.3 4-9z" />
    </svg>
  );
}
