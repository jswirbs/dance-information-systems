import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import type { ArtistRecord, LabelRecord, NamedRef, ReleaseArtist, ReleaseRecord } from "./records.js";

type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
};

export type ParseHandlers = {
  artist?: (artist: ArtistRecord) => Promise<void> | void;
  label?: (label: LabelRecord) => Promise<void> | void;
  release?: (release: ReleaseRecord) => Promise<void> | void;
};

const RECORD_PARENT: Record<string, string> = {
  artist: "artists",
  label: "labels",
  release: "releases",
};

/** Stream one Discogs dump. Each top-level record is handled before the next one is parsed. */
export async function parseDiscogs(stream: Readable, handlers: ParseHandlers): Promise<void> {
  const parser = new SaxesParser({ xmlns: false });
  const decoder = new StringDecoder("utf8");
  const stack: XmlNode[] = [];
  let pending: Promise<void> = Promise.resolve();

  const enqueue = (work: Promise<void> | void) => {
    pending = pending.then(() => work ?? undefined);
  };

  parser.on("opentag", (tag: SaxesTagPlain) => {
    stack.push({ name: tag.name, attrs: attrsOf(tag), text: "", children: [] });
  });

  parser.on("text", (text: string) => {
    const current = stack[stack.length - 1];
    if (current) current.text += text;
  });

  parser.on("closetag", () => {
    const node = stack.pop();
    const parent = stack[stack.length - 1];
    if (!node || !parent) return;
    if (isTopLevelRecord(node, parent, stack.length)) {
      enqueue(emit(node, handlers));
      return;
    }
    parent.children.push(node);
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    stream.on("data", (chunk: Buffer | string) => {
      stream.pause();
      try {
        const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
        if (text) parser.write(text);
      } catch (error) {
        fail(error);
        return;
      }
      void pending.then(() => stream.resume()).catch(fail);
    });
    stream.on("end", () => {
      try {
        const rest = decoder.end();
        if (rest) parser.write(rest);
        parser.close();
      } catch (error) {
        fail(error);
        return;
      }
      void pending.then(succeed).catch(fail);
    });
    stream.on("error", fail);
  });
}

function isTopLevelRecord(node: XmlNode, parent: XmlNode, ancestorCount: number): boolean {
  if (parent.name !== RECORD_PARENT[node.name]) return false;
  return ancestorCount <= 2;
}

function emit(node: XmlNode, handlers: ParseHandlers): Promise<void> | void {
  if (node.name === "artist") return handlers.artist?.(toArtist(node));
  if (node.name === "label") return handlers.label?.(toLabel(node));
  if (node.name === "release") return handlers.release?.(toRelease(node));
}

function toArtist(node: XmlNode): ArtistRecord {
  return {
    discogsId: numberText(node, "id"),
    name: text(node, "name"),
    realname: text(node, "realname"),
    profile: text(node, "profile"),
    dataQuality: text(node, "data_quality"),
    nameVariations: names(node, "namevariations"),
    urls: texts(node, "urls", "url"),
    imageCount: countImages(node),
    aliases: namedRefs(node, "aliases", "name"),
    groups: namedRefs(node, "groups", "name"),
    members: namedRefs(node, "members", "name"),
  };
}

function toLabel(node: XmlNode): LabelRecord {
  const parent = child(node, "parentLabel");
  return {
    discogsId: numberText(node, "id"),
    name: text(node, "name"),
    contactInfo: text(node, "contactinfo"),
    profile: text(node, "profile"),
    dataQuality: text(node, "data_quality"),
    urls: texts(node, "urls", "url"),
    imageCount: countImages(node),
    parentLabel: parent && attrNumber(parent, "id") > 0 ? { id: attrNumber(parent, "id"), name: parent.text.trim() } : null,
    sublabels: namedRefs(node, "sublabels", "label"),
  };
}

function toRelease(node: XmlNode): ReleaseRecord {
  const master = child(node, "master_id");
  return {
    discogsId: attrNumber(node, "id"),
    status: node.attrs.status ?? "",
    title: text(node, "title"),
    country: text(node, "country"),
    released: text(node, "released"),
    notes: text(node, "notes"),
    dataQuality: text(node, "data_quality"),
    masterId: masterIdOf(master),
    isMainRelease: masterIdOf(master) != null && master?.attrs.is_main_release === "true",
    artists: artistsOf(child(node, "artists")),
    labels: (child(node, "labels")?.children ?? [])
      .filter((label) => label.name === "label")
      .map((label) => ({
        id: attrNumber(label, "id"),
        name: label.attrs.name ?? "",
        catno: label.attrs.catno ?? "",
      })),
    extraartists: artistsOf(child(node, "extraartists")),
    formats: (child(node, "formats")?.children ?? [])
      .filter((format) => format.name === "format")
      .map((format) => ({
        name: format.attrs.name ?? "",
        qty: format.attrs.qty ?? "",
        text: format.attrs.text ?? "",
        descriptions: texts(format, "descriptions", "description"),
      })),
    genres: texts(node, "genres", "genre"),
    styles: texts(node, "styles", "style"),
    tracklist: (child(node, "tracklist")?.children ?? [])
      .filter((track) => track.name === "track")
      .map((track) => ({
        position: text(track, "position"),
        title: text(track, "title"),
        duration: text(track, "duration"),
        artists: artistsOf(child(track, "artists")),
        extraartists: artistsOf(child(track, "extraartists")),
      })),
    identifiers: (child(node, "identifiers")?.children ?? [])
      .filter((identifier) => identifier.name === "identifier")
      .map((identifier) => ({
        type: identifier.attrs.type ?? "",
        value: identifier.attrs.value ?? "",
        description: identifier.attrs.description ?? "",
      })),
    videos: (child(node, "videos")?.children ?? [])
      .filter((video) => video.name === "video")
      .map((video) => ({ src: video.attrs.src ?? "", title: text(video, "title") })),
    companies: (child(node, "companies")?.children ?? [])
      .filter((company) => company.name === "company")
      .map((company) => ({
        id: numberText(company, "id"),
        name: text(company, "name"),
        entityType: text(company, "entity_type_name"),
        catno: text(company, "catno"),
      })),
    imageCount: countImages(node),
  };
}

function artistsOf(node: XmlNode | undefined): ReleaseArtist[] {
  if (!node) return [];
  return node.children
    .filter((artist) => artist.name === "artist")
    .map((artist) => ({
      id: numberText(artist, "id"),
      name: text(artist, "name"),
      anv: text(artist, "anv"),
      role: text(artist, "role"),
    }));
}

function namedRefs(node: XmlNode, group: string, item: string): NamedRef[] {
  return (child(node, group)?.children ?? [])
    .filter((entry) => entry.name === item && attrNumber(entry, "id") > 0)
    .map((entry) => ({ id: attrNumber(entry, "id"), name: entry.text.trim() }));
}

function names(node: XmlNode, group: string): string[] {
  return (child(node, group)?.children ?? [])
    .filter((entry) => entry.name === "name")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
}

function texts(node: XmlNode, group: string, item: string): string[] {
  return (child(node, group)?.children ?? [])
    .filter((entry) => entry.name === item)
    .map((entry) => entry.text.trim())
    .filter(Boolean);
}

function countImages(node: XmlNode): number {
  return child(node, "images")?.children.filter((image) => image.name === "image").length ?? 0;
}

function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((entry) => entry.name === name);
}

function text(node: XmlNode, name: string): string {
  return child(node, name)?.text.trim() ?? "";
}

function numberText(node: XmlNode, name: string): number {
  const value = text(node, name);
  return value ? Number(value) : 0;
}

function masterIdOf(node: XmlNode | undefined): number | null {
  const value = node?.text.trim() ? Number(node.text.trim()) : 0;
  return value > 0 ? value : null;
}

function attrNumber(node: XmlNode, name: string): number {
  const value = node.attrs[name];
  return value ? Number(value) : 0;
}

function attrsOf(tag: SaxesTagPlain): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(tag.attributes)) {
    if (typeof value === "string") attrs[key] = value;
  }
  return attrs;
}
