export type EntityType = "artist" | "label" | "release";

export type Seed = {
  type: EntityType;
  id: number;
};

export type SearchHit = {
  type: EntityType;
  id: number;
  name: string;
  thumbUrl: string | null;
  disambiguator: string | null;
};

export type ReasonPiece = {
  seedName: string;
  text: string;
};

export type RelatedRow = {
  type: EntityType;
  id: number;
  name: string;
  score: number;
  reason: string;
  reasons: ReasonPiece[];
  thumbUrl: string | null;
  year: number | null;
  country: string | null;
  genres: string[];
  styles: string[];
};

export type GraphNode = {
  id: string;
  entityType: EntityType;
  discogsId: number;
  name: string;
  seed: boolean;
};

export type GraphLinkKind =
  | "SIMILAR"
  | "ISSUED"
  | "PRIMARY_ON"
  | "APPEARS_ON"
  | "REMIXED"
  | "ALIAS_OF"
  | "SUBLABEL_OF"
  | "MEMBER_OF";

export type GraphLink = {
  source: string;
  target: string;
  kind: GraphLinkKind;
  score?: number;
};

export type GraphPayload = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export type PathKind = "shortest" | "random";

export type PathTrack = {
  releaseId: number;
  releaseName: string;
  artistId: number | null;
  artistName: string | null;
  title: string;
  position: string;
  duration: string;
  hopIndex: number;
  videoSrc: string | null;
  searchQuery: string;
};

export type PathPayload = {
  hops: number | null;
  shortestHops: number | null;
  limit: number;
  nodes: GraphNode[];
  links: GraphLink[];
  rows: RelatedRow[];
  tracks: PathTrack[];
  fallback?: "shortest";
};

export type Credit = {
  id: number;
  name: string;
  anv: string;
  role: string;
  scope: "release" | "track";
  track?: string;
};

export type AliasRef = {
  id: number;
  name: string;
};

export type IssuedLabel = {
  id: number;
  name: string;
  catno: string | null;
};

export type CreditedArtist = {
  id: number;
  name: string;
  roles: string[];
};

export type Track = {
  position: string;
  title: string;
  duration: string;
  artists: { id: number; name: string; anv: string }[];
};

export type CompanyCredit = {
  id: number;
  name: string;
  entityType: string;
  catno: string;
};

export type VideoLink = {
  src: string;
  title: string;
};

export type Identifier = {
  type: string;
  value: string;
  description: string;
};

export type EntityDetail = {
  type: EntityType;
  id: number;
  name: string;
  imageUrl: string | null;
  thumbUrl: string | null;
  imageCount: number;
  realname: string | null;
  profile: string | null;
  contactInfo: string | null;
  dataQuality: string | null;
  nameVariations: string[];
  urls: string[];
  country: string | null;
  released: string | null;
  year: number | null;
  notes: string | null;
  genres: string[];
  styles: string[];
  formatNames: string[];
  formatSummary: string[];
  credits: Credit[];
  tracklist: Track[];
  companies: CompanyCredit[];
  videos: VideoLink[];
  identifiers: Identifier[];
  masterId: number | null;
  isMainRelease: boolean | null;
  aliases: AliasRef[];
  labels: IssuedLabel[];
  creditedArtists: CreditedArtist[];
};

export type ImageResult = {
  imageUrl: string | null;
  thumbUrl: string | null;
  fetched: boolean;
};
