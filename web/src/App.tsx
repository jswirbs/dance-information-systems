import { useEffect, useRef, useState } from "react";
import { DEFAULT_NODE_CAP } from "../../src/shared/constants";
import type { EntityDetail, EntityType, GraphPayload, PathKind, PathPayload, RelatedRow, SearchHit, Seed } from "../../src/shared/types";
import { ApiError, api } from "./api";
import { ExplorePanel } from "./ExplorePanel";
import { GraphView } from "./GraphView";
import { PathPanel } from "./PathPanel";
import { Detail, Thumb } from "./ui";

type Mode = "explore" | "path";

export function App() {
  const [mode, setMode] = useState<Mode>("explore");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
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
    const ready = stops.filter((stop): stop is SearchHit => stop != null);
    if (ready.length < 2) {
      setPathPayload(null);
      return;
    }
    let cancelled = false;
    setPathError(null);
    api
      .path(
        ready.map(({ type, id }) => ({ type, id })),
        pathKind,
        pathSeed,
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
        ? "Pick two entities."
        : pathPayload && pathPayload.shortestHops == null
          ? `No catalog path within ${pathPayload.limit} hops.`
          : pathPayload && pathPayload.nodes.length === 0
            ? "No catalog path within 12 hops."
            : "Pick two entities.";

  return (
    <div className="page">
      <header>
        <h1>DANCE INFORMATION SYSTEMS</h1>
        <div className="toggle mode-toggle" role="tablist" aria-label="Mode">
          <button type="button" role="tab" aria-selected={mode === "explore"} onClick={() => setMode("explore")}>
            Explore
          </button>
          <button type="button" role="tab" aria-selected={mode === "path"} onClick={() => setMode("path")}>
            Path finder
          </button>
        </div>
      </header>
      <main>
        <section className="panel">
          <label className="search">
            <span>Search artists, labels, or releases</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Workshop, Lawrence, Werk" />
          </label>
          {hits.length > 0 && (
            <ul className="hits">
              {hits.map((hit) => (
                <li key={`${hit.type}:${hit.id}`}>
                  <button type="button" onClick={() => (mode === "explore" ? addSeed(hit) : fillStop(hit))}>
                    <Thumb url={hit.thumbUrl} name={hit.name} type={hit.type} />
                    <span>
                      <strong>{hit.name}</strong>
                      <small>
                        {hit.type}
                        {hit.disambiguator ? ` · ${hit.disambiguator}` : ""}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
              onClear={(index) => {
                setStops((current) => current.map((stop, slot) => (slot === index ? null : stop)));
                setFocused(index);
                setPathError(null);
              }}
              onKind={setPathKind}
              onRegenerate={() => setPathSeed(Date.now())}
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
              emptyMessage="Add a seed to draw the neighborhood."
            />
          ) : (
            <GraphView
              payload={pathGraph}
              selectedId={selectedId}
              nodeCap={nodeCap}
              onNodeCapChange={setNodeCap}
              onSelect={(type, id) => void openDetail(type, id)}
              emptyMessage={pathEmpty}
              showNodeCap={false}
              layout="path"
            />
          )}
          <p className="map-note">
            {mode === "explore" ? "Proximity is an approximation of similarity." : "This is a catalog path, not a similarity score."}
          </p>
        </section>
      </main>
    </div>
  );
}
