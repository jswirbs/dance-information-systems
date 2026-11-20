import type {
  EntityDetail,
  EntityType,
  GraphPayload,
  ImageResult,
  PathKind,
  PathPayload,
  RelatedRow,
  SearchHit,
  Seed,
} from "../../src/shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await apiError(response);
  return response.json() as Promise<T>;
}

async function apiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  const code = typeof body?.error === "string" ? body.error : response.statusText;
  return new ApiError(response.status, code);
}

export const api = {
  search: (q: string) => getJson<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  related: (seeds: Seed[], target: EntityType) => postJson<RelatedRow[]>("/api/related", { seeds, target, limit: 25 }),
  graph: (seeds: Seed[], target: EntityType, nodeCap: number) =>
    postJson<GraphPayload>("/api/graph", { seeds, target, nodeCap }),
  path: (stops: Seed[], kind: PathKind, seed: number, avoid?: string) =>
    postJson<PathPayload>("/api/path", { stops, kind, seed, ...(avoid ? { avoid } : {}) }),
  youtubeSearch: (q: string) => getJson<{ videoId: string | null; searchUrl: string }>(`/api/youtube-search?q=${encodeURIComponent(q)}`),
  entity: (type: EntityType, id: number) => getJson<EntityDetail>(`/api/entities/${type}/${id}`),
  image: (type: EntityType, id: number) => postJson<ImageResult>(`/api/entities/${type}/${id}/image`, {}),
};
