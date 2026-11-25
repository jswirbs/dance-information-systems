import { useEffect, useRef, useState } from "react";
import { DEFAULT_NODE_CAP } from "../../src/shared/constants";
import type { AboutMention, EntityDetail, EntityType, GraphPayload, PathKind, PathPayload, RelatedRow, SearchHit, Seed } from "../../src/shared/types";
import { ApiError, api } from "./api";
import { ExplorePanel } from "./ExplorePanel";
import { GraphView } from "./GraphView";
import { PathPanel, pathProblemTitle } from "./PathPanel";
import { PlayerProvider } from "./player";
import { SearchSuggest } from "./SearchSuggest";
import { ThemeToggle } from "./theme";
import { Detail, MissingDetail } from "./ui";

type Mode = "explore" | "path";

export function App() {
  const [mode, setMode] = useState<Mode>("explore");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [missing, setMissing] = useState<AboutMention | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailToken = useRef(0);

  const [seeds, setSeeds] = useState<SearchHit[]>([]);
  const [exploreTarget, setExploreTarget] = useState<EntityType>("label");
  const [rows, setRows] = useState<RelatedRow[]>([]);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [nodeCap, setNodeCap] = useState(DEFAULT_NODE_CAP);
  const [graphCap, setGraphCap] = useState(DEFAULT_NODE_CAP);

  const [stops, setStops] = useState<Array<SearchHit | null>>([null, null]);
  const [focused, setFocused] = useState(0);
  const [pathKind, setPathKind] = useState<PathKind>("shortest");
  const [pathSeed, setPathSeed] = useState(() => Date.now());
  const pathAvoid = useRef<string | null>(null);
  const [pathPayload, setPathPayload] = useState<PathPayload | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const detailRef = useRef<EntityDetail | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setGraphCap(nodeCap), 250);
    return () => clearTimeout(handle);
  }, [nodeCap]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setHits([]);
      setSearchError(null);
      setSearchedQuery(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .search(q)
        .then((next) => {
          if (cancelled) return;
          setHits(next);
          setSearchError(null);
          setSearchedQuery(q);
        })
        .catch((reason) => {
          if (cancelled) return;
          setHits([]);
          setSearchedQuery(null);
          setSearchError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    if (seeds.length === 0) {
      setRows([]);
      setGraph(null);
      setExploreLoading(false);
      return;
    }
    const body: Seed[] = seeds.map(({ type, id }) => ({ type, id }));
    let cancelled = false;
    setExploreError(null);
    setExploreLoading(true);
    setRows([]);
    setGraph(null);
    Promise.all([api.related(body, exploreTarget), api.graph(body, exploreTarget, graphCap)])
      .then(([nextRows, nextGraph]) => {
        if (cancelled) return;
        setRows(nextRows);
        setGraph(nextGraph);
        setExploreLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setRows([]);
        setGraph(null);
        setExploreError(reason instanceof Error ? reason.message : String(reason));
        setExploreLoading(false);
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
      setPathLoading(false);
      return;
    }
    let cancelled = false;
    setPathError(null);
    setPathLoading(true);
    setPathPayload(null);
    const avoid = pathKind === "random" ? pathAvoid.current : null;
    api
      .path(
        ready.map(({ type, id }) => ({ type, id })),
        pathKind,
        pathSeed,
        avoid ?? undefined,
      )
      .then((payload) => {
        if (cancelled) return;
        setPathPayload(payload);
        setPathLoading(false);
      })
      .catch((reason) => {
        if (cancelled) return;
        setPathPayload(null);
        setPathLoading(false);
        setPathError(reason instanceof ApiError ? reason.code : "failed");
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
        setPathError(hit.type === "label" ? "same_label" : "same_release");
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
    try {
      const record = await api.entity(type, id);
      if (token !== detailToken.current) return;
      detailRef.current = record;
      setMissing(null);
      setDetail(record);
      if (record.imageCount <= 0 || record.imageUrl || record.thumbUrl) return;
      try {
        const image = await api.image(type, id);
        if (token !== detailToken.current) return;
        if (image.imageUrl) {
          const next = { ...record, imageUrl: image.imageUrl, thumbUrl: image.thumbUrl };
          detailRef.current = next;
          setDetail(next);
        }
      } catch {
        // The article is already showing. A missing image can wait for the next open.
      }
    } catch (error) {
      if (token !== detailToken.current) return;
      if (error instanceof ApiError && error.status === 404) {
        detailRef.current = null;
        setDetail(null);
        setSelectedId(null);
        setMissing({ entity: type, id, name: `${type} ${id}`, inCatalog: false });
        return;
      }
      const loaded = detailRef.current;
      setSelectedId(loaded ? `${loaded.type}:${loaded.id}` : null);
    }
  }

  function showMissing(mention: AboutMention) {
    detailToken.current += 1;
    detailRef.current = null;
    setDetail(null);
    setSelectedId(null);
    setMissing(mention);
  }

  function openMention(mention: AboutMention) {
    if (mention.inCatalog && mention.id != null && mention.entity !== "master") {
      void openDetail(mention.entity, mention.id);
      return;
    }
    showMissing(mention);
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

  function replaceSeed(hit: SearchHit) {
    setQuery("");
    setHits([]);
    setSeeds((current) =>
      current.length === 1 && current[0].type === hit.type && current[0].id === hit.id ? current : [hit],
    );
    void openDetail(hit.type, hit.id);
  }

  function replaceFromDetail() {
    if (!detail) return;
    replaceSeed({
      type: detail.type,
      id: detail.id,
      name: detail.name,
      thumbUrl: detail.thumbUrl,
      disambiguator: null,
    });
  }

  const pathGraph: GraphPayload | null = pathPayload ? { nodes: pathPayload.nodes, links: pathPayload.links } : null;
  const pathProblem = pathProblemTitle(pathError);
  const pathWaiting = stops.some((stop) => stop == null);
  const pathMissing = pathPayload != null && (pathPayload.shortestHops == null || pathPayload.nodes.length === 0);
  const pathEmpty =
    pathProblem ??
    (pathWaiting
      ? "Pick two entities to find a path from A to B."
      : pathLoading
        ? "Searching the catalog"
        : pathMissing
          ? `No catalog path within ${pathPayload.limit} hops.`
          : "Pick two entities to find a path from A to B.");

  return (
    <PlayerProvider onOpen={(type, id) => void openDetail(type, id)}>
      <div className="page">
      <header>
        <h1>DANCE INFORMATION SYSTEMS</h1>
        <div className="toggle mode-toggle">
          <div className="mode-tabs" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={mode === "explore"} onClick={() => setMode("explore")}>
              Explore
            </button>
            <button type="button" role="tab" aria-selected={mode === "path"} onClick={() => setMode("path")}>
              Pathfinder
            </button>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main>
        <section className="panel">
          {mode === "explore" && (
            <>
              <p className="mode-lead"><strong>Explore</strong> the connections surrounding any artist(s), label(s), or release(s)</p>
              <label className="search">
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
                    placeholder="Search artists, labels, or releases"
                    aria-label="Search artists, labels, or releases"
                    aria-expanded={searchOpen && searchedQuery != null && query.trim().length > 0}
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {searchOpen && searchedQuery != null && query.trim().length > 0 && (
                    <SearchSuggest hits={hits} onPick={(hit) => void addSeed(hit)} />
                  )}
                </span>
              </label>
              {searchError && <p className="error">{searchError}</p>}
            </>
          )}
          {mode === "explore" ? (
            <ExplorePanel
              seeds={seeds}
              target={exploreTarget}
              rows={rows}
              error={exploreError}
              loading={exploreLoading}
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
              loading={pathLoading}
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
              useLabel={mode === "explore" ? (detailIsSeed ? "Remove seed" : "Add seed") : null}
              replaceLabel={mode === "explore" ? (seeds.length > 1 ? "Replace seeds" : "Replace seed") : null}
              onUse={useFromDetail}
              onReplace={replaceFromDetail}
              onOpen={(type, id) => void openDetail(type, id)}
              onMention={openMention}
            />
          )}
          {!detail && missing && <MissingDetail mention={missing} />}
        </section>
        <section className="map">
          {mode === "explore" ? (
            <GraphView
              payload={graph}
              selectedId={selectedId}
              nodeCap={nodeCap}
              onNodeCapChange={setNodeCap}
              onSelect={(type, id) => void openDetail(type, id)}
              seedCount={seeds.length}
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
              onReplaceSeed={(node) =>
                replaceSeed({
                  type: node.entityType,
                  id: node.discogsId,
                  name: node.name,
                  thumbUrl: null,
                  disambiguator: null,
                })
              }
              relatedType={exploreTarget}
              loading={exploreLoading}
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
              emptyItalic={pathProblem != null || pathMissing}
              loading={pathLoading}
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
