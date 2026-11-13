export type NamedRef = { id: number; name: string };

export type ArtistRecord = {
  discogsId: number;
  name: string;
  realname: string;
  profile: string;
  dataQuality: string;
  nameVariations: string[];
  urls: string[];
  imageCount: number;
  aliases: NamedRef[];
  groups: NamedRef[];
  members: NamedRef[];
};

export type LabelRecord = {
  discogsId: number;
  name: string;
  contactInfo: string;
  profile: string;
  dataQuality: string;
  urls: string[];
  imageCount: number;
  parentLabel: NamedRef | null;
  sublabels: NamedRef[];
};

export type ReleaseArtist = {
  id: number;
  name: string;
  anv: string;
  role: string;
};

export type ReleaseRecord = {
  discogsId: number;
  status: string;
  title: string;
  country: string;
  released: string;
  notes: string;
  dataQuality: string;
  masterId: number | null;
  isMainRelease: boolean;
  artists: ReleaseArtist[];
  labels: { id: number; name: string; catno: string }[];
  extraartists: ReleaseArtist[];
  formats: { name: string; qty: string; text: string; descriptions: string[] }[];
  genres: string[];
  styles: string[];
  tracklist: {
    position: string;
    title: string;
    duration: string;
    artists: ReleaseArtist[];
    extraartists: ReleaseArtist[];
  }[];
  identifiers: { type: string; value: string; description: string }[];
  videos: { src: string; title: string }[];
  companies: { id: number; name: string; entityType: string; catno: string }[];
  imageCount: number;
};
