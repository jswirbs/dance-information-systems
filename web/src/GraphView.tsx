import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { MAX_NODE_CAP, MIN_NODE_CAP } from "../../src/shared/constants";
import type { EntityType, GraphLink, GraphNode, GraphPayload } from "../../src/shared/types";
import { Popover } from "./Popover";

type DrawNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number };

type SimLink = {
  source: string | DrawNode;
  target: string | DrawNode;
  kind: GraphLink["kind"];
  score?: number;
};

type SimGraph = { nodes: DrawNode[]; links: SimLink[] };
type PlainGraph = { nodes: GraphNode[]; links: GraphLink[] };

type NodeMenu = {
  id: string;
  name: string;
  left: number;
  top: number;
};

const COLOR: Record<string, string> = {
  artist: "#8c3d2f",
  label: "#1e6a4a",
  release: "#2c4e7a",
};

const TYPES: EntityType[] = ["artist", "label", "release"];
const FOCUS_ZOOM = 2.4;
const PATH_STEP = 150;
const PATH_STAGGER = 36;
const PATH_CHAR_WIDTH = 6.4;

type GraphLayout = "force" | "path";

export function GraphView({
  payload,
  selectedId,
  nodeCap,
  onNodeCapChange,
  onSelect,
  emptyMessage = "Add a seed to draw the neighborhood.",
  showNodeCap = true,
  layout = "force",
}: {
  payload: GraphPayload | null;
  selectedId: string | null;
  nodeCap: number;
  onNodeCapChange: (value: number) => void;
  onSelect: (type: DrawNode["entityType"], id: number) => void;
  emptyMessage?: string;
  showNodeCap?: boolean;
  layout?: GraphLayout;
}) {
  const ref = useRef<ForceGraphMethods | undefined>(undefined);
  const frameRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState<Record<EntityType, boolean>>({ artist: true, label: true, release: true });
  const closeSettings = useCallback(() => setOpen(false), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const graphStore = useRef<{ signature: string; layout: GraphLayout; data: SimGraph; cache: Map<string, DrawNode> }>({
    signature: "",
    layout,
    data: { nodes: [], links: [] },
    cache: new Map(),
  });
  const focusedId = useRef<string | null>(null);

  const projected = useMemo(() => projectGraph(payload, removed, visible), [payload, removed, visible]);
  const data = useMemo(() => {
    const signature = layout === "path" ? orderedSignature(projected) : graphSignature(projected);
    const store = graphStore.current;
    if (signature === store.signature && store.layout === layout) return store.data;
    // Keep the same node objects so x/y survive. A fresh object list makes the
    // force layout treat every node as new and fly in from the origin.
    store.signature = signature;
    store.layout = layout;
    store.data = adoptGraph(projected, store.cache, layout);
    return store.data;
  }, [projected, layout]);

  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || layout === "path") return;
    const linkForce = ref.current?.d3Force("link") as { distance?: (fn: (link: GraphPayload["links"][number]) => number) => void } | undefined;
    linkForce?.distance?.((link) => (link.kind === "SIMILAR" && link.score ? Math.max(40, 150 / link.score) : 46));
    ref.current?.d3ReheatSimulation();
  }, [data, ready, layout]);

  useEffect(() => {
    if (layout === "path") return;
    if (!selectedId) {
      focusedId.current = null;
      return;
    }
    if (!ready || focusedId.current === selectedId) return;
    const node = data.nodes.find((item) => item.id === selectedId);
    const graph = ref.current;
    if (!graph || !node || node.x == null || node.y == null) return;
    focusedId.current = selectedId;
    // Zoom first so the center tween runs last and lands on the node.
    graph.zoom(FOCUS_ZOOM, 500);
    graph.centerAt(node.x, node.y, 500);
  }, [selectedId, data.nodes, ready, layout]);

  useEffect(() => {
    if (layout !== "path" || !ready || data.nodes.length === 0) return;
    const graph = ref.current;
    if (!graph) return;
    fitPath(graph, data.nodes, size.width, size.height);
  }, [layout, ready, data, size.width, size.height]);

  return (
    <>
      <div className="graph-settings" ref={settingsRef}>
        <button
          type="button"
          className="graph-settings-toggle"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Settings"
          title="Settings"
          onClick={() => setOpen((current) => !current)}
        >
          <GearIcon />
        </button>
        <Popover open={open} onClose={closeSettings} anchorRef={settingsRef} className="graph-settings-panel">
          {showNodeCap && (
            <label className="graph-cap">
              <span>Nodes {nodeCap}</span>
              <input
                type="range"
                min={MIN_NODE_CAP}
                max={MAX_NODE_CAP}
                step={5}
                value={nodeCap}
                onChange={(event) => onNodeCapChange(Number(event.target.value))}
              />
            </label>
          )}
          <fieldset>
            <legend>Show</legend>
            {TYPES.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={visible[type]}
                  onChange={() => setVisible((current) => ({ ...current, [type]: !current[type] }))}
                />
                {type}s
              </label>
            ))}
          </fieldset>
        </Popover>
      </div>
      <div className="graph-frame" ref={frameRef}>
        {!payload || data.nodes.length === 0 ? (
          <div className="graph-empty">{payload && payload.nodes.length > 0 ? "No nodes to show." : emptyMessage}</div>
        ) : ready ? (
          <ForceGraph2D
            ref={ref}
            width={size.width}
            height={size.height}
            graphData={data}
            backgroundColor="#ffffff"
            nodeId="id"
            cooldownTicks={90}
            nodeLabel={(node) => `${node.name} · ${node.entityType}`}
            linkLabel={(link) => (link.kind === "SIMILAR" && link.score ? `similar ${link.score}` : link.kind)}
            linkColor={(link) => (link.kind === "SIMILAR" ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.35)")}
            linkWidth={(link) => (link.kind === "SIMILAR" ? 1.5 : 0.7)}
            onNodeClick={(node) => {
              const drawn = node as DrawNode;
              onSelect(drawn.entityType, drawn.discogsId);
            }}
            onNodeRightClick={(node, event) => {
              const drawn = node as DrawNode;
              setOpen(false);
              setMenu({ id: drawn.id, name: drawn.name, ...menuPosition(event.clientX, event.clientY) });
            }}
            onBackgroundRightClick={closeMenu}
            nodeCanvasObject={(node, context, scale) => drawNode(node as DrawNode, context, scale, node.id === selectedId)}
            nodePointerAreaPaint={(node, color, context) => {
              context.fillStyle = color;
              context.beginPath();
              context.arc(node.x ?? 0, node.y ?? 0, 12, 0, Math.PI * 2);
              context.fill();
            }}
          />
        ) : null}
      </div>
      <Popover open={menu != null} onClose={closeMenu} className="context-menu" role="menu" style={menu ? { left: menu.left, top: menu.top } : undefined}>
        {menu && (
          <>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard.writeText(menu.name);
                setMenu(null);
              }}
            >
              Copy text
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRemoved((current) => (current.includes(menu.id) ? current : [...current, menu.id]));
                setMenu(null);
              }}
            >
              Remove node
            </button>
          </>
        )}
      </Popover>
    </>
  );
}

function projectGraph(payload: GraphPayload | null, removed: string[], visible: Record<EntityType, boolean>): PlainGraph {
  if (!payload) return { nodes: [], links: [] };
  const hidden = new Set(removed);
  const nodes = payload.nodes.filter((node) => visible[node.entityType] && !hidden.has(node.id));
  const ids = new Set(nodes.map((node) => node.id));
  const links = payload.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  return { nodes, links };
}

function graphSignature(graph: PlainGraph): string {
  const nodes = graph.nodes.map((node) => `${node.id}\0${node.seed ? 1 : 0}`).sort().join("\n");
  const links = graph.links.map((link) => `${link.kind}\0${link.source}\0${link.target}`).sort().join("\n");
  return `${nodes}\n~\n${links}`;
}

function orderedSignature(graph: PlainGraph): string {
  const nodes = graph.nodes.map((node) => `${node.id}\0${node.seed ? 1 : 0}`).join("\n");
  const links = graph.links.map((link) => `${link.kind}\0${link.source}\0${link.target}`).join("\n");
  return `${nodes}\n~\n${links}`;
}

function adoptGraph(graph: PlainGraph, cache: Map<string, DrawNode>, layout: GraphLayout): SimGraph {
  const seeds = graph.nodes.filter((node) => node.seed);
  const nodes = graph.nodes.map((node) => reuseNode(node, seeds, cache));
  if (layout === "path") pinPath(nodes);
  else placeNewcomers(nodes, graph.links);
  return { nodes, links: graph.links.map((link) => ({ ...link })) };
}

function pinPath(nodes: DrawNode[]) {
  const mid = (nodes.length - 1) / 2;
  nodes.forEach((node, index) => {
    const x = (index - mid) * PATH_STEP;
    const y = (index % 2) * PATH_STAGGER;
    node.fx = x;
    node.fy = y;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
  });
}

function fitPath(graph: ForceGraphMethods, nodes: DrawNode[], width: number, height: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const label = node.name.length * PATH_CHAR_WIDTH;
    minX = Math.min(minX, x - 14);
    maxX = Math.max(maxX, x + 14 + label);
    minY = Math.min(minY, y - 14);
    maxY = Math.max(maxY, y + 14);
  }
  const pad = 36;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(FOCUS_ZOOM, (width - pad * 2) / spanX, (height - pad * 2) / spanY);
  graph.zoom(Math.max(scale, 0.15), 400);
  graph.centerAt((minX + maxX) / 2, (minY + maxY) / 2, 400);
}

function reuseNode(node: GraphNode, seeds: GraphNode[], cache: Map<string, DrawNode>): DrawNode {
  const index = seeds.findIndex((seed) => seed.id === node.id);
  const existing = cache.get(node.id);
  if (!existing) {
    const created: DrawNode = { ...node };
    if (index >= 0) {
      created.fx = (index - (seeds.length - 1) / 2) * 80;
      created.fy = 0;
    }
    cache.set(node.id, created);
    return created;
  }
  const wasSeed = existing.seed;
  existing.entityType = node.entityType;
  existing.discogsId = node.discogsId;
  existing.name = node.name;
  existing.seed = node.seed;
  existing.vx = 0;
  existing.vy = 0;
  if (index >= 0 && !wasSeed) {
    existing.fx = (index - (seeds.length - 1) / 2) * 80;
    existing.fy = 0;
  } else if (index < 0 && wasSeed) {
    delete existing.fx;
    delete existing.fy;
  }
  return existing;
}

function placeNewcomers(nodes: DrawNode[], links: GraphLink[]) {
  const placed = (node: DrawNode) => Number.isFinite(node.x) && Number.isFinite(node.y);
  if (!nodes.some(placed)) return;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let pending = nodes.filter((node) => node.fx == null && !placed(node));
  for (let pass = 0; pass < nodes.length && pending.length > 0; pass++) {
    const next: DrawNode[] = [];
    for (const node of pending) {
      const anchor = anchoredNeighbor(node.id, links, byId);
      if (!anchor) {
        next.push(node);
        continue;
      }
      const angle = (byId.size - pending.length + next.length) * 2.4;
      node.x = anchor.x! + Math.cos(angle) * 36;
      node.y = anchor.y! + Math.sin(angle) * 36;
    }
    if (next.length === pending.length) break;
    pending = next;
  }
}

function anchoredNeighbor(id: string, links: GraphLink[], byId: Map<string, DrawNode>): DrawNode | undefined {
  for (const link of links) {
    const otherId = link.source === id ? link.target : link.target === id ? link.source : "";
    const other = otherId ? byId.get(otherId) : undefined;
    if (other && Number.isFinite(other.x) && Number.isFinite(other.y)) return other;
  }
  return undefined;
}

function menuPosition(x: number, y: number) {
  const width = 168;
  const height = 64;
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  };
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function drawNode(node: DrawNode, context: CanvasRenderingContext2D, scale: number, selected: boolean) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const radius = node.seed ? 7 : 5;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = COLOR[node.entityType] ?? "#221c16";
  context.fill();
  if (selected) {
    context.lineWidth = 2 / scale;
    context.strokeStyle = "#000";
    context.stroke();
  }
  const fontSize = 11 / scale;
  context.font = `${fontSize}px sans-serif`;
  context.fillStyle = "#000";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(node.name, x + radius + 4, y);
}
