import { useEffect, useRef, useState } from "react";
import { DEFAULT_NODE_CAP } from "../../src/shared/constants";
import type { EntityDetail, EntityType, GraphPayload, PathKind, PathPayload, RelatedRow, SearchHit, Seed } from "../../src/shared/types";
import { ApiError, api } from "./api";
import { ExplorePanel } from "./ExplorePanel";
import { GraphView } from "./GraphView";
import { PathPanel } from "./PathPanel";
import { PlayerProvider } from "./player";
import { SearchSuggest } from "./SearchSuggest";
import { Detail } from "./ui";

type Mode = "explore" | "path";

export function App() {
  const [mode, setMode] = useState<Mode>("explore");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailToken = useRef(0);

  const [seeds, setSeeds] = useState<SearchHit[]>([]);
  const [exploreTarget, setExploreTarget] = useState<EntityType>("label");
  const [rows, setRows] = useState<RelatedRow[]>([]);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [nodeCap, setNodeCap] = useState(DEFAULT_NODE_CAP);
  const [graphCap, setGraphCap] = useState(DEFAULT_NODE_CAP);

  const [stops, setStops] = useState<Array<SearchHit | null>>([null, null]);
  const [focused, setFocused] = useState(0);
  const [pathKind, setPathKind] = useState<PathKind>("shortest");
  const [pathSeed, setPathSeed] = useState(() => Date.now());
  const pathAvoid = useRef<string | null>(null);
  const [pathPayload, setPathPayload] = useState<PathPayload | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setGraphCap(nodeCap), 250);
    return () => clearTimeout(handle);
  }, [nodeCap]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      api.search(query.trim()).then(setHits).catch((reason) => setExploreError(String(reason)));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (seeds.length === 0) {
      setRows([]);
      setGraph(null);
      return;
    }
    const body: Seed[] = seeds.map(({ type, id }) => ({ type, id }));
    let cancelled = false;
    setExploreError(null);
    Promise.all([api.related(body, exploreTarget), api.graph(body, exploreTarget, graphCap)])
      .then(([nextRows, nextGraph]) => {
        if (cancelled) return;
        setRows(nextRows);
        setGraph(nextGraph);
      })
      .catch((reason) => {
        if (!cancelled) setExploreError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [seeds, exploreTarget, graphCap]);

  useEffect(() => {
    pathAvoid.current = null;
  }, [stops, pathKind]);

  useEffect(() => {
    const ready = stops.filter((stop): stop is SearchHit => stop != null);
    if (ready.length < 2) {
      setPathPayload(null);
      return;
    }
    let cancelled = false;
    setPathError(null);
    const avoid = pathKind === "random" ? pathAvoid.current : null;
    api
      .path(
        ready.map(({ type, id }) => ({ type, id })),
        pathKind,
        pathSeed,
        avoid ?? undefined,
      )
      .then((payload) => {
        if (!cancelled) setPathPayload(payload);
      })
      .catch((reason) => {
        if (cancelled) return;
        setPathPayload(null);
        setPathError(reason instanceof ApiError ? reason.code : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [stops, pathKind, pathSeed]);

  function startPath(node: { entityType: EntityType; discogsId: number; name: string }) {
    setQuery("");
    setHits([]);
    setStops([
      {
        type: node.entityType,
        id: node.discogsId,
        name: node.name,
        thumbUrl: null,
        disambiguator: null,
      },
      null,
    ]);
    setFocused(1);
    setPathError(null);
    setPathPayload(null);
    setMode("path");
    void openDetail(node.entityType, node.discogsId);
  }

  function exploreNode(node: { entityType: EntityType; discogsId: number; name: string }) {
    setQuery("");
    setHits([]);
    setSeeds([
      {
        type: node.entityType,
        id: node.discogsId,
        name: node.name,
        thumbUrl: null,
        disambiguator: null,
      },
    ]);
    setMode("explore");
    void openDetail(node.entityType, node.discogsId);
  }

  async function addSeed(hit: SearchHit) {
    setQuery("");
    setHits([]);
    if (hit.type === "artist") {
      const record = await api.entity("artist", hit.id);
      const clique = new Set([hit.id, ...record.aliases.map((alias) => alias.id)]);
      setSeeds((current) => {
        if (current.some((seed) => seed.type === "artist" && clique.has(seed.id))) return current;
        return [...current, hit];
      });
    } else {
      setSeeds((current) => (current.some((seed) => seed.type === hit.type && seed.id === hit.id) ? current : [...current, hit]));
    }
    await openDetail(hit.type, hit.id);
  }

  async function fillStop(hit: SearchHit, index = focused) {
    setQuery("");
    setHits([]);
    if (hit.type === "artist") {
      const record = await api.entity("artist", hit.id);
      const clique = new Set([hit.id, ...record.aliases.map((alias) => alias.id)]);
      const other = stops.find((stop, slot) => slot !== index && stop?.type === "artist" && clique.has(stop.id));
      if (other) {
        setPathError("same_clique");
        return;
      }
    } else {
      const other = stops.find((stop, slot) => slot !== index && stop?.type === hit.type && stop.id === hit.id);
      if (other) {
        setPathError("same_clique");
        return;
      }
    }
    setPathError(null);
    setStops((current) => current.map((stop, slot) => (slot === index ? hit : stop)));
    setFocused(index === 0 && stops[1] == null ? 1 : index);
    await openDetail(hit.type, hit.id);
  }

  async function openDetail(type: EntityType, id: number) {
    const token = ++detailToken.current;
    setSelectedId(`${type}:${id}`);
    const record = await api.entity(type, id);
    if (token !== detailToken.current) return;
    setDetail(record);
    if (record.imageCount <= 0 || record.imageUrl || record.thumbUrl) return;
    const image = await api.image(type, id);
    if (token !== detailToken.current) return;
    if (image.imageUrl) setDetail({ ...record, imageUrl: image.imageUrl, thumbUrl: image.thumbUrl });
  }

  const detailIsSeed =
    detail != null && seeds.some((seed) => seed.type === detail.type && seed.id === detail.id);

  function useFromDetail() {
    if (!detail) return;
    if (mode === "explore" && detailIsSeed) {
      setSeeds((current) => current.filter((seed) => !(seed.type === detail.type && seed.id === detail.id)));
      return;
    }
    const hit: SearchHit = {
      type: detail.type,
      id: detail.id,
      name: detail.name,
      thumbUrl: detail.thumbUrl,
      disambiguator: null,
    };
    if (mode === "explore") void addSeed(hit);
    else void fillStop(hit);
  }

  const pathGraph: GraphPayload | null = pathPayload ? { nodes: pathPayload.nodes, links: pathPayload.links } : null;
  const pathEmpty =
    pathError === "same_clique"
      ? "Those are the same artist (aliases)."
      : stops.some((stop) => stop == null)
        ? "Pick two entities to find a path from A to B."
        : pathPayload && pathPayload.shortestHops == null
          ? `No catalog path within ${pathPayload.limit} hops.`
          : pathPayload && pathPayload.nodes.length === 0
            ? `No catalog path within ${pathPayload.limit} hops.`
            : "Pick two entities to find a path from A to B.";

  return (
    <PlayerProvider onOpen={(type, id) => void openDetail(type, id)}>
      <div className="page">
      <header>
        <h1>DANCE INFORMATION SYSTEMS</h1>
        <div className="toggle mode-toggle" role="tablist" aria-label="Mode">
          <button type="button" role="tab" aria-selected={mode === "explore"} onClick={() => setMode("explore")}>
            Explore
          </button>
          <button type="button" role="tab" aria-selected={mode === "path"} onClick={() => setMode("path")}>
            Pathfinder
          </button>
        </div>
      </header>
      <main>
        <section className="panel">
          {mode === "explore" && (
            <>
              <label className="search">
                <span>Search artists, labels, or releases to add to the graph as a seed</span>
                <span className="search-field">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setSearchOpen(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.blur();
                        return;
                      }
                      if (event.key === "Enter" && searchOpen && hits[0]) {
                        event.preventDefault();
                        void addSeed(hits[0]);
                      }
                    }}
                    placeholder="Workshop, Lawrence, Werk"
                    aria-expanded={searchOpen && hits.length > 0}
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {searchOpen && <SearchSuggest hits={hits} onPick={(hit) => void addSeed(hit)} />}
                </span>
              </label>
            </>
          )}
          {mode === "explore" ? (
            <ExplorePanel
              seeds={seeds}
              target={exploreTarget}
              rows={rows}
              error={exploreError}
              onRemoveSeed={(seed) => setSeeds((current) => current.filter((item) => item !== seed))}
              onTarget={setExploreTarget}
              onOpen={(type, id) => void openDetail(type, id)}
            />
          ) : (
            <PathPanel
              stops={stops}
              focused={focused}
              kind={pathKind}
              payload={pathPayload}
              error={pathError}
              onFocus={setFocused}
              onPick={(hit, index) => void fillStop(hit, index)}
              onClear={(index) => {
                setStops((current) => current.map((stop, slot) => (slot === index ? null : stop)));
                setFocused(index);
                setPathError(null);
              }}
              onKind={setPathKind}
              onRegenerate={() => {
                pathAvoid.current = pathPayload?.nodes.map((node) => node.id).join(">") ?? null;
                setPathSeed(Date.now());
              }}
              onOpen={(type, id) => void openDetail(type, id)}
            />
          )}
          {detail && (
            <Detail
              record={detail}
              useLabel={mode === "explore" ? (detailIsSeed ? "Remove seed" : "Use as seed") : null}
              onUse={useFromDetail}
              onOpen={(type, id) => void openDetail(type, id)}
            />
          )}
        </section>
        <section className="map">
          {mode === "explore" ? (
            <GraphView
              payload={graph}
              selectedId={selectedId}
              nodeCap={nodeCap}
              onNodeCapChange={setNodeCap}
              onSelect={(type, id) => void openDetail(type, id)}
              onToggleSeed={(node) => {
                if (node.seed) {
                  setSeeds((current) => current.filter((seed) => !(seed.type === node.entityType && seed.id === node.discogsId)));
                  return;
                }
                void addSeed({
                  type: node.entityType,
                  id: node.discogsId,
                  name: node.name,
                  thumbUrl: null,
                  disambiguator: null,
                });
              }}
              relatedType={exploreTarget}
              emptyMessage="Add a seed to draw the neighborhood."
              onStartPath={startPath}
            />
          ) : (
            <GraphView
              payload={pathGraph}
              selectedId={selectedId}
              nodeCap={nodeCap}
              onNodeCapChange={setNodeCap}
              onSelect={(type, id) => void openDetail(type, id)}
              onExploreNode={exploreNode}
              emptyMessage={pathEmpty}
              showNodeCap={false}
              layout="path"
            />
          )}
        </section>
      </main>
      </div>
    </PlayerProvider>
  );
}
