import { forceCollide, forceRadial } from "d3-force";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { ThinkingOrb } from "thinking-orbs";
import { orbGravity } from "./cursor";
import { MAX_NODE_CAP, MIN_NODE_CAP } from "../../src/shared/constants";
import type { EntityType, GraphLink, GraphNode, GraphPayload } from "../../src/shared/types";
import { EntityPlayButton } from "./EntityPlay";
import { PATH_SOURCE, usePlayer } from "./player";
import { Popover } from "./Popover";
import { THEME_MOTION_MS, readLivePalette, useTheme, type ThemePalette } from "./theme";

type DrawNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number };

type SimLink = {
  source: string | DrawNode;
  target: string | DrawNode;
  kind: GraphLink["kind"];
  score?: number;
};

type SimGraph = { nodes: DrawNode[]; links: SimLink[] };
type PlainGraph = { nodes: GraphNode[]; links: GraphLink[] };
type ExploreLayout = "proximity" | "rings";
type GraphLayout = ExploreLayout | "path";
type Strength = number | ((...args: never[]) => number);

type NodeMenu = {
  name: string;
  seed: boolean;
  entityType: EntityType;
  discogsId: number;
  left: number;
  top: number;
};

type Box = { x: number; y: number; w: number; h: number };

const TYPES: EntityType[] = ["artist", "label", "release"];
const EXPLORE_LAYOUTS: ExploreLayout[] = ["proximity", "rings"];
const LAYOUT_LABEL: Record<ExploreLayout, string> = { proximity: "Proximity", rings: "Rings" };
const FOCUS_ZOOM = 2.4;
const PATH_STEP = 150;
const PATH_STAGGER = 36;
const PATH_JITTER_X = 20;
const PATH_JITTER_Y = 32;
const PATH_CHAR_WIDTH = 6.4;
const RING_ORDER: EntityType[] = ["artist", "label", "release"];
const RING_GAP = 175;
// Sibling spacing along a ring. Just past the collide diameter, so a fan stays put.
const RING_NODE_GAP = 32;
const DIM_ALPHA = 0.14;
const SELECTED_DIM_ALPHA = 0.32;
const LABEL_FONT = 11;
const LAYOUT_KEY = "graph-explore-layout";
const FADE_TAU = 110;
const FADE_SNAP = 0.02;
const PLAY_BUTTON = 22;
// Graph units. The play button sits this far off the node, matching the label.
const LABEL_GAP = 4;
// Hover hit circle, in graph units. Larger than the visible node so the pointer can
// reach the play button without dropping the node.
const NODE_HIT = 12;
const HOVER_CLEAR_MS = 48;
const BREATH_MS = 3900;
const PULSE_MS = 5200;
const AURA_FADE_TAU = 240;
const AURA_SETTLE_TAU = 300;

export function GraphView({
  payload,
  selectedId,
  nodeCap,
  onNodeCapChange,
  onSelect,
  onToggleSeed,
  onReplaceSeed,
  seedCount = 0,
  onExploreNode,
  onStartPath,
  emptyMessage = "Add a seed to draw the neighborhood.",
  showNodeCap = true,
  layout = "force",
  relatedType,
  loading = false,
  emptyItalic = false,
}: {
  payload: GraphPayload | null;
  selectedId: string | null;
  nodeCap: number;
  onNodeCapChange: (value: number) => void;
  onSelect: (type: DrawNode["entityType"], id: number) => void;
  onToggleSeed?: (node: { entityType: EntityType; discogsId: number; name: string; seed: boolean }) => void;
  onReplaceSeed?: (node: { entityType: EntityType; discogsId: number; name: string }) => void;
  seedCount?: number;
  onExploreNode?: (node: { entityType: EntityType; discogsId: number; name: string }) => void;
  onStartPath?: (node: { entityType: EntityType; discogsId: number; name: string }) => void;
  emptyMessage?: string;
  showNodeCap?: boolean;
  layout?: "force" | "path";
  relatedType?: EntityType;
  loading?: boolean;
  emptyItalic?: boolean;
}) {
  const { theme } = useTheme();
  const paletteRef = useRef<ThemePalette>(readLivePalette());
  const paintedTheme = useRef(theme);
  const [blending, setBlending] = useState(false);
  useEffect(() => {
    if (paintedTheme.current === theme) return;
    paintedTheme.current = theme;
    paletteRef.current = readLivePalette();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setBlending(true);
    const id = window.setTimeout(() => setBlending(false), THEME_MOTION_MS + 60);
    return () => window.clearTimeout(id);
  }, [theme]);
  const ref = useRef<ForceGraphMethods | undefined>(undefined);
  const frameRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [gearOver, setGearOver] = useState(false);
  const [gearReady, setGearReady] = useState(true);
  const [menu, setMenu] = useState<NodeMenu | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [visible, setVisible] = useState<Record<EntityType, boolean>>({ artist: true, label: true, release: true });
  const [exploreLayout, setExploreLayout] = useState<ExploreLayout>(readExploreLayout);
  const [fading, setFading] = useState(false);
  const [auraMoving, setAuraMoving] = useState(false);
  const auraMovingRef = useRef(false);
  const session = usePlayer().session;
  const nowPlaying = useRef<{ nodes: Set<string>; link: { release: string; artists: Set<string> } | null }>({
    nodes: new Set(),
    link: null,
  });
  const aura = useRef<Aura>({
    presence: 0,
    breath: 0,
    drift: 0,
    travel: 0,
    edge: 0,
    running: false,
    active: false,
    breathOrigin: 0,
    driftOrigin: 0,
    travelOrigin: 0,
    last: 0,
  });
  const motionKey = useRef("");
  const closeSettings = useCallback(() => setOpen(false), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const graphStore = useRef<{ signature: string; layout: string; data: SimGraph; cache: Map<string, DrawNode> }>({
    signature: "",
    layout: "",
    data: { nodes: [], links: [] },
    cache: new Map(),
  });
  const focusedId = useRef<string | null>(null);
  const labelIds = useRef<Set<string> | null>(null);
  const hoverRef = useRef<string | null>(null);
  const hoverLock = useRef(false);
  // Force-graph keeps the last pointer position, so a pointer that has left the frame
  // would otherwise keep the node under that stale point hovered.
  const pointerInside = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const hoverClear = useRef<number | null>(null);
  const playRef = useRef<HTMLDivElement>(null);
  const [hoverNode, setHoverNode] = useState<DrawNode | null>(null);
  const nodeAlpha = useRef(new Map<string, number>());
  const linkAlpha = useRef(new Map<string, number>());
  const fadeClock = useRef(0);
  const fadingRef = useRef(false);
  const activeLayout: GraphLayout = layout === "path" ? "path" : exploreLayout;
  const layoutRef = useRef(activeLayout);
  layoutRef.current = activeLayout;
  const nodeActive = activeLayout !== "path" && session != null;
  const linkActive = activeLayout === "path" && session?.source === PATH_SOURCE && session.releaseId != null;
  const auraRunning = (nodeActive || linkActive) && session != null && !session.paused;
  const trackKey = session ? `${session.source}:${session.index}:${session.releaseId ?? ""}` : "";
  if (trackKey !== motionKey.current) {
    const previous = motionKey.current;
    motionKey.current = trackKey;
    if (auraRunning && previous) {
      aura.current.travel = 0;
      aura.current.travelOrigin = performance.now();
    }
  }
  setAuraIntent(aura.current, nodeActive || linkActive, auraRunning, performance.now());
  const auraLive =
    auraRunning ||
    aura.current.breath > 0.015 ||
    aura.current.drift > 0.015 ||
    aura.current.travel > 0.015 ||
    aura.current.edge > 0.015 ||
    Math.abs(aura.current.presence - (nodeActive || linkActive ? 1 : 0)) > 0.015;
  if (linkActive && session?.releaseId != null) {
    nowPlaying.current.link = {
      release: `release:${session.releaseId}`,
      artists: new Set(session.artists.flatMap((artist) => (artist.id == null ? [] : [`artist:${artist.id}`]))),
    };
  } else if (activeLayout !== "path" || (aura.current.edge < 0.015 && aura.current.presence < 0.015)) {
    nowPlaying.current.link = null;
  }

  const projected = useMemo(() => projectGraph(payload, visible), [payload, visible]);
  const data = useMemo(() => {
    const signature = activeLayout === "path" ? orderedSignature(projected) : graphSignature(projected);
    const store = graphStore.current;
    const layoutChanged = store.layout !== activeLayout;
    if (signature === store.signature && !layoutChanged) {
      for (const node of projected.nodes) {
        const cached = store.cache.get(node.id);
        if (cached) cached.year = node.year ?? cached.year;
      }
      return store.data;
    }
    // Keep the same node objects so x/y survive. A fresh object list makes the
    // force layout treat every node as new and fly in from the origin.
    store.signature = signature;
    store.layout = activeLayout;
    store.data = adoptGraph(projected, store.cache, activeLayout, layoutChanged, relatedType);
    return store.data;
  }, [projected, activeLayout, relatedType]);
  if (nodeActive && session) nowPlaying.current.nodes = playingNodeIds(session, data.links);
  else if (activeLayout === "path" || aura.current.presence < 0.015) nowPlaying.current.nodes = EMPTY_IDS;

  const ready = size.width > 0 && size.height > 0;

  useEffect(() => {
    if (auraLive || auraMoving) ref.current?.resumeAnimation();
  }, [auraLive, auraMoving]);

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
    if (!ready || activeLayout === "path") return;
    const graph = ref.current;
    if (!graph) return;
    // Rings hold their shape with a positioning force, so link strength stays low.
    const linkForce = asForce(graph.d3Force("link"));
    const chargeForce = asForce(graph.d3Force("charge"));
    linkForce?.distance?.((link) => linkDistance(link, activeLayout));
    if (activeLayout === "rings") {
      const radii = ringRadii(data.nodes, relatedType);
      writeStrength(linkForce, 0.012);
      writeStrength(chargeForce, -4);
      putForce(graph, "radial", forceRadial<DrawNode>((node) => ringRadius(node, radii), 0, 0).strength(0.95));
      putForce(graph, "collide", forceCollide<DrawNode>(14));
    } else {
      // Similarity holds its rest length. Issued records and sublabels sit on their label; a credit only draws that clump toward the artist.
      // Rest lengths are longer than the collide diameter, so this only breaks up a pile, such as many artists on one seed.
      writeStrength(linkForce, ((link: SimLink) => proximityStrength(link)) as Strength);
      writeStrength(chargeForce, -22);
      putForce(graph, "radial", null);
      putForce(graph, "collide", forceCollide<DrawNode>(14));
    }
    graph.d3ReheatSimulation();
  }, [data, ready, activeLayout, relatedType]);

  useEffect(() => {
    if (activeLayout !== "proximity") return;
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
  }, [selectedId, data.nodes, ready, activeLayout]);

  useEffect(() => {
    if (activeLayout !== "rings") return;
    if (!ready || data.nodes.length === 0) return;
    let cancelled = false;
    const fit = () => {
      if (!cancelled) ref.current?.zoomToFit(0, 72);
    };
    const soon = window.setTimeout(fit, 50);
    const later = window.setTimeout(fit, 1100);
    return () => {
      cancelled = true;
      window.clearTimeout(soon);
      window.clearTimeout(later);
    };
  }, [activeLayout, ready, data, size.width, size.height]);

  useEffect(() => {
    if (activeLayout !== "path" || !ready || data.nodes.length === 0) return;
    const graph = ref.current;
    if (!graph) return;
    fitPath(graph, data.nodes, size.width, size.height);
  }, [activeLayout, ready, data, size.width, size.height]);

  const prepareLabels = useCallback(
    (context: CanvasRenderingContext2D, scale: number) => {
      paletteRef.current = readLivePalette();
      const hover = activeLayout === "path" ? null : hoverRef.current;
      const moving = easeHover(data.nodes, data.links, hover, selectedId, nodeAlpha.current, linkAlpha.current, fadeClock);
      labelIds.current = activeLayout === "path" ? null : chooseLabels(data.nodes, hover, selectedId, scale, context);
      stepAura(aura.current, performance.now());
      const glowMoving = auraBusy(aura.current);
      if (glowMoving !== auraMovingRef.current) {
        auraMovingRef.current = glowMoving;
        setAuraMoving(glowMoving);
      }
      if (moving !== fadingRef.current) {
        fadingRef.current = moving;
        setFading(moving);
      }
    },
    [activeLayout, data.nodes, data.links, selectedId],
  );

  const paintNode = useCallback(
    (node: DrawNode, context: CanvasRenderingContext2D, scale: number) => {
      const alpha = nodeAlpha.current.get(node.id) ?? 1;
      drawNode(node, context, scale, node.id === selectedId, alpha, nowPlaying.current.nodes.has(node.id), aura.current, paletteRef.current);
    },
    [selectedId],
  );

  const paintLabels = useCallback(
    (context: CanvasRenderingContext2D, scale: number) => {
      const ids = labelIds.current;
      const hover = hoverRef.current;
      const labeled = data.nodes.filter((node) => ids == null || ids.has(node.id));
      // Hovered and selected names paint last, so a must-show label stays on top of another name.
      labeled.sort((a, b) => labelRank(a, hover, selectedId) - labelRank(b, hover, selectedId));
      for (const node of labeled) drawLabel(node, context, scale, nodeAlpha.current.get(node.id) ?? 1, paletteRef.current.fg);
    },
    [data.nodes, selectedId],
  );

  useEffect(() => {
    hoverRef.current = null;
    setHoverNode(null);
    return () => {
      if (hoverClear.current != null) window.clearTimeout(hoverClear.current);
    };
  }, [data]);

  useLayoutEffect(() => {
    const node = hoverNode;
    if (!node) return;
    let frame = 0;
    const place = () => {
      const element = playRef.current;
      const graph = ref.current;
      if (!element || !graph || node.x == null || node.y == null || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
      const point = graph.graph2ScreenCoords(node.x, node.y);
      const radius = (node.seed ? 8 : 5) * graph.zoom();
      const gap = LABEL_GAP * graph.zoom();
      element.style.left = `${point.x - radius - gap - PLAY_BUTTON}px`;
      element.style.top = `${point.y - PLAY_BUTTON / 2}px`;
      element.style.visibility = "visible";
    };
    place();
    const tick = () => {
      place();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hoverNode]);

  function cancelHoverClear() {
    if (hoverClear.current != null) window.clearTimeout(hoverClear.current);
    hoverClear.current = null;
  }

  function releaseHover() {
    cancelHoverClear();
    hoverClear.current = window.setTimeout(() => {
      hoverClear.current = null;
      if (hoverLock.current) return;
      // Force-graph reports a node only when the object under the pointer changes.
      // A clear queued while the pointer is already on a node would drop that hover
      // and never get another report to bring it back.
      if (pointerInside.current) {
        const landed = nodeUnderPointer(pointer.current.x, pointer.current.y);
        if (landed) {
          holdHover(landed);
          return;
        }
      }
      hoverRef.current = null;
      setHoverNode(null);
      if (layoutRef.current !== "path") {
        fadeClock.current = 0;
        setFading(true);
      }
    }, HOVER_CLEAR_MS);
  }

  // Squared screen distance from the pointer to a node, or null when it cannot be placed.
  function pointerDist(clientX: number, clientY: number, node: DrawNode, origin: DOMRect): number | null {
    const graph = ref.current;
    if (!graph || node.x == null || node.y == null || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    const point = graph.graph2ScreenCoords(node.x, node.y);
    const dx = clientX - origin.left - point.x;
    const dy = clientY - origin.top - point.y;
    return dx * dx + dy * dy;
  }

  function pointerHitsNode(clientX: number, clientY: number, node: DrawNode): boolean {
    const graph = ref.current;
    const canvas = frameRef.current?.querySelector("canvas");
    if (!graph || !canvas) return false;
    const dist = pointerDist(clientX, clientY, node, canvas.getBoundingClientRect());
    if (dist == null) return false;
    const reach = NODE_HIT * graph.zoom();
    return dist <= reach * reach;
  }

  // Closest node whose hit circle contains the pointer. Later nodes win a tie, matching
  // the canvas hit test, which keeps the last color painted at that pixel.
  function nodeUnderPointer(clientX: number, clientY: number): DrawNode | null {
    const graph = ref.current;
    const canvas = frameRef.current?.querySelector("canvas");
    if (!graph || !canvas) return null;
    const origin = canvas.getBoundingClientRect();
    const reach = NODE_HIT * graph.zoom();
    const reachSq = reach * reach;
    let best: DrawNode | null = null;
    let bestDist = reachSq;
    for (const node of graphStore.current.data.nodes) {
      const dist = pointerDist(clientX, clientY, node, origin);
      if (dist == null || dist > bestDist) continue;
      best = node;
      bestDist = dist;
    }
    return best;
  }

  function holdHover(node: DrawNode) {
    cancelHoverClear();
    if (hoverRef.current === node.id) return;
    hoverRef.current = node.id;
    setHoverNode((current) => (current?.id === node.id ? current : node));
    if (layoutRef.current !== "path") {
      fadeClock.current = 0;
      setFading(true);
    }
  }

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const leaveGraph = () => {
      hoverLock.current = false;
      releaseHover();
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && frame.contains(event.relatedTarget)) return;
      leaveGraph();
    };
    // A pointer event outside the frame means the node is no longer hovered, including when the
    // pointer jumps away without a move across the canvas.
    const away = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      const target = event.target;
      if (target instanceof Node && (frame.contains(target) || playRef.current?.contains(target))) {
        pointerInside.current = true;
        return;
      }
      pointerInside.current = false;
      leaveGraph();
    };
    frame.addEventListener("pointerleave", leave);
    window.addEventListener("pointermove", away, true);
    window.addEventListener("pointerdown", away, true);
    return () => {
      frame.removeEventListener("pointerleave", leave);
      window.removeEventListener("pointermove", away, true);
      window.removeEventListener("pointerdown", away, true);
    };
  }, []);

  function chooseExploreLayout(next: ExploreLayout) {
    setExploreLayout(next);
    try {
      sessionStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Preference is optional.
    }
  }

  return (
    <>
      {layout !== "path" && (
        <div className="graph-settings" ref={settingsRef}>
          <button
            type="button"
            className="graph-settings-toggle"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label="Settings"
            title="Settings"
            style={{ "--gear-turn": `${open ? (gearReady && gearOver ? 120 : 180) : gearReady && gearOver ? 60 : 0}deg` } as CSSProperties}
            onPointerEnter={() => {
              if (gearReady) setGearOver(true);
            }}
            onPointerLeave={() => {
              setGearOver(false);
              setGearReady(true);
            }}
            onClick={() => {
              setGearReady(false);
              setGearOver(false);
              setOpen((current) => !current);
            }}
          >
            <GearIcon />
          </button>
          <Popover open={open} onClose={closeSettings} anchorRef={settingsRef} className="graph-settings-panel">
            <fieldset>
              <legend>Layout</legend>
              <div className="graph-layout" role="tablist" aria-label="Layout">
                {EXPLORE_LAYOUTS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={exploreLayout === option}
                    onClick={() => chooseExploreLayout(option)}
                  >
                    {LAYOUT_LABEL[option]}
                  </button>
                ))}
              </div>
            </fieldset>
            {showNodeCap && (
              <label className="graph-cap">
                <span>Max nodes</span>
                <input
                  type="range"
                  min={MIN_NODE_CAP}
                  max={MAX_NODE_CAP}
                  step={5}
                  value={nodeCap}
                  onChange={(event) => onNodeCapChange(Number(event.target.value))}
                />
                <span className="graph-cap-value">{nodeCap}</span>
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
      )}
      <div className="graph-frame" ref={frameRef}>
        {loading ? (
          <div className="graph-loading" role="status" aria-label={layout === "path" ? "Searching the catalog" : "Loading the neighborhood"}>
            <ThinkingOrb state={layout === "path" ? "connecting" : "working"} size={64} theme={theme} gravity={orbGravity()} />
          </div>
        ) : !payload || data.nodes.length === 0 ? (
          <div className={`graph-empty${emptyItalic ? " loading-note" : ""}`}>
            {payload && payload.nodes.length > 0 ? "No nodes to show." : emptyMessage}
          </div>
        ) : ready ? (
          <ForceGraph2D
            ref={ref}
            width={size.width}
            height={size.height}
            graphData={data}
            backgroundColor="var(--bg)"
            nodeId="id"
            cooldownTicks={activeLayout === "rings" ? 160 : 90}
            autoPauseRedraw={!fading && !auraLive && !auraMoving && !blending}
            nodeLabel={activeLayout === "path" ? () => "" : (node) => nodePhrase(node as DrawNode)}
            linkLabel={(link) => linkPhrase(link as SimLink)}
            linkColor={(link) => linkPaint(link as SimLink, linkPresence(link as SimLink, linkAlpha.current), paletteRef.current.ink)}
            linkWidth={(link) => linkWidth(link as SimLink, linkPresence(link as SimLink, linkAlpha.current))}
            linkCanvasObjectMode={(link) => (nowPlaying.current.link && linkCarries(link as SimLink, nowPlaying.current.link) ? "after" : undefined)}
            linkCanvasObject={(link, context, scale) => {
              const play = nowPlaying.current.link;
              if (play && linkCarries(link as SimLink, play)) paintEdgePulse(link as SimLink, context, scale, aura.current, paletteRef.current);
            }}
            onNodeClick={(node) => {
              const drawn = node as DrawNode;
              onSelect(drawn.entityType, drawn.discogsId);
            }}
            onNodeRightClick={(node, event) => {
              const drawn = node as DrawNode;
              setOpen(false);
              setMenu({
                name: drawn.name,
                seed: drawn.seed,
                entityType: drawn.entityType,
                discogsId: drawn.discogsId,
                ...menuPosition(
                  event.clientX,
                  event.clientY,
                  menuHeight(onToggleSeed != null, onReplaceSeed != null, onExploreNode != null, onStartPath != null),
                ),
              });
            }}
            onNodeHover={(node) => {
              if (!pointerInside.current) return;
              if (node) holdHover(node as DrawNode);
              else releaseHover();
            }}
            onBackgroundRightClick={closeMenu}
            onRenderFramePre={prepareLabels}
            onRenderFramePost={paintLabels}
            nodeCanvasObject={(node, context, scale) => paintNode(node as DrawNode, context, scale)}
            nodePointerAreaPaint={(node, color, context, scale) => {
              const drawn = node as DrawNode;
              const x = drawn.x ?? 0;
              const y = drawn.y ?? 0;
              const radius = drawn.seed ? 8 : 5;
              const scaleSafe = Math.max(scale, 0.01);
              const button = PLAY_BUTTON / scaleSafe;
              context.fillStyle = color;
              context.beginPath();
              context.arc(x, y, NODE_HIT, 0, Math.PI * 2);
              // A bridge to the play button, which sits just left of the circle. The button
              // itself is HTML, so the hit area only has to meet its right edge.
              const edge = radius + LABEL_GAP;
              if (edge > NODE_HIT) context.rect(x - edge, y - button / 2, edge - NODE_HIT, button);
              context.fill();
            }}
          />
        ) : null}
        {hoverNode && ready && !loading && (
          <div
            className="graph-play"
            ref={playRef}
            style={{ visibility: "hidden" }}
            onPointerEnter={() => {
              hoverLock.current = true;
              cancelHoverClear();
            }}
            onPointerLeave={(event) => {
              hoverLock.current = false;
              const ontoGraph = event.relatedTarget instanceof Node && frameRef.current?.contains(event.relatedTarget);
              if (!ontoGraph) {
                const node = hoverNode;
                if (node && pointerHitsNode(event.clientX, event.clientY, node)) {
                  cancelHoverClear();
                  return;
                }
                releaseHover();
                return;
              }
              // The leave point can sit just outside a hit circle, or still inside the
              // node that owns this button, while the pointer is traveling onto another
              // node. Force-graph reports hover from its own animation frame, and only
              // when the node under the pointer changes. Retarget after this move lands,
              // or a clear queued here drops the node the graph just reported and will
              // not report again.
              requestAnimationFrame(() => {
                if (hoverLock.current) return;
                const landed = nodeUnderPointer(pointer.current.x, pointer.current.y);
                if (landed) {
                  holdHover(landed);
                  return;
                }
                releaseHover();
              });
            }}
          >
            <EntityPlayButton key={hoverNode.id} type={hoverNode.entityType} id={hoverNode.discogsId} name={hoverNode.name} />
          </div>
        )}
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
            {onExploreNode && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onExploreNode({
                    entityType: menu.entityType,
                    discogsId: menu.discogsId,
                    name: menu.name,
                  });
                  setMenu(null);
                }}
              >
                Explore this node
              </button>
            )}
            {onToggleSeed && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleSeed({
                    entityType: menu.entityType,
                    discogsId: menu.discogsId,
                    name: menu.name,
                    seed: menu.seed,
                  });
                  setMenu(null);
                }}
              >
                {menu.seed ? "Remove seed" : "Add seed"}
              </button>
            )}
            {onReplaceSeed && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onReplaceSeed({
                    entityType: menu.entityType,
                    discogsId: menu.discogsId,
                    name: menu.name,
                  });
                  setMenu(null);
                }}
              >
                {seedCount > 1 ? "Replace seeds" : "Replace seed"}
              </button>
            )}
            {onStartPath && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onStartPath({
                    entityType: menu.entityType,
                    discogsId: menu.discogsId,
                    name: menu.name,
                  });
                  setMenu(null);
                }}
              >
                Start path from here
              </button>
            )}
          </>
        )}
      </Popover>
    </>
  );
}

function readExploreLayout(): ExploreLayout {
  try {
    const value = sessionStorage.getItem(LAYOUT_KEY);
    if (value === "rings" || value === "proximity" || value === "force") {
      return value === "force" ? "proximity" : value;
    }
  } catch {
    // Preference is optional.
  }
  return "proximity";
}

function projectGraph(payload: GraphPayload | null, visible: Record<EntityType, boolean>): PlainGraph {
  if (!payload) return { nodes: [], links: [] };
  const nodes = payload.nodes.filter((node) => visible[node.entityType]);
  const ids = new Set(nodes.map((node) => node.id));
  const links = payload.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  return { nodes, links };
}

function graphSignature(graph: PlainGraph): string {
  const nodes = graph.nodes.map((node) => `${node.id}\0${node.seed ? 1 : 0}\0${node.name}`).sort().join("\n");
  const links = graph.links.map((link) => `${link.kind}\0${link.source}\0${link.target}\0${link.score ?? ""}`).sort().join("\n");
  return `${nodes}\n~\n${links}`;
}

function orderedSignature(graph: PlainGraph): string {
  const nodes = graph.nodes.map((node) => `${node.id}\0${node.seed ? 1 : 0}\0${node.name}`).join("\n");
  const links = graph.links.map((link) => `${link.kind}\0${link.source}\0${link.target}\0${link.score ?? ""}`).join("\n");
  return `${nodes}\n~\n${links}`;
}

function adoptGraph(
  graph: PlainGraph,
  cache: Map<string, DrawNode>,
  layout: GraphLayout,
  layoutChanged: boolean,
  focus?: EntityType,
): SimGraph {
  const live = new Set(graph.nodes.map((node) => node.id));
  for (const id of cache.keys()) {
    if (!live.has(id)) cache.delete(id);
  }
  const previousSeeds = new Set<string>();
  const nodes = graph.nodes.map((node) => {
    const taken = takeNode(node, cache);
    if (taken.wasSeed) previousSeeds.add(node.id);
    return taken.node;
  });
  if (layout === "path") pinPath(nodes);
  else if (layoutChanged) arrange(nodes, graph.links, layout, focus);
  else {
    unpinRetiredSeeds(nodes, previousSeeds);
    if (layout === "proximity") pinNewSeeds(nodes, previousSeeds, "row");
    if (layout === "rings") pinNewSeeds(nodes, previousSeeds, "center");
    placeNewcomers(nodes, graph.links, layout, focus);
    dropUnplaced(nodes, graph.links, layout, focus);
  }
  return { nodes, links: graph.links.map((link) => ({ ...link })) };
}

function takeNode(node: GraphNode, cache: Map<string, DrawNode>): { node: DrawNode; wasSeed: boolean } {
  const existing = cache.get(node.id);
  if (!existing) {
    const created: DrawNode = { ...node };
    cache.set(node.id, created);
    return { node: created, wasSeed: false };
  }
  const wasSeed = existing.seed;
  existing.entityType = node.entityType;
  existing.discogsId = node.discogsId;
  existing.name = node.name;
  existing.seed = node.seed;
  existing.year = node.year ?? existing.year;
  existing.vx = 0;
  existing.vy = 0;
  return { node: existing, wasSeed };
}

function arrange(nodes: DrawNode[], links: GraphLink[], layout: ExploreLayout, focus?: EntityType) {
  for (const node of nodes) {
    delete node.fx;
    delete node.fy;
    node.vx = 0;
    node.vy = 0;
  }
  if (layout === "proximity") {
    pinNewSeeds(nodes, new Set(), "row");
    return;
  }
  pinNewSeeds(nodes, new Set(), "center");
  scatterRings(nodes, links, focus);
}

function pinNewSeeds(nodes: DrawNode[], previousSeeds: Set<string>, mode: "row" | "center") {
  const seeds = nodes.filter((node) => node.seed);
  seeds.forEach((node, index) => {
    if (previousSeeds.has(node.id) && node.fx != null) return;
    if (mode === "row") {
      node.fx = (index - (seeds.length - 1) / 2) * 80;
      node.fy = 0;
      return;
    }
    const spread = seeds.length === 1 ? 0 : 22;
    const angle = (index / seeds.length) * Math.PI * 2;
    node.fx = Math.cos(angle) * spread;
    node.fy = Math.sin(angle) * spread;
    node.x = node.fx;
    node.y = node.fy;
    node.vx = 0;
    node.vy = 0;
  });
}

function unpinRetiredSeeds(nodes: DrawNode[], previousSeeds: Set<string>) {
  for (const node of nodes) {
    if (!node.seed && previousSeeds.has(node.id)) {
      delete node.fx;
      delete node.fy;
    }
  }
}

function pinPath(nodes: DrawNode[]) {
  const mid = (nodes.length - 1) / 2;
  nodes.forEach((node, index) => {
    // Hashed from the id so a refreshed path keeps the same wobble.
    const jitter = pathJitter(node.id);
    const x = (index - mid) * PATH_STEP + jitter.x;
    const y = (index % 2) * PATH_STAGGER + jitter.y;
    node.fx = x;
    node.fy = y;
    node.x = x;
    node.y = y;
    node.vx = 0;
    node.vy = 0;
  });
}

function pathJitter(id: string): { x: number; y: number } {
  return {
    x: (unitHash(`${id}:x`) * 2 - 1) * PATH_JITTER_X,
    y: (unitHash(`${id}:y`) * 2 - 1) * PATH_JITTER_Y,
  };
}

function unitHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function scatterRings(nodes: DrawNode[], links: GraphLink[], focus?: EntityType) {
  const radii = ringRadii(nodes, focus);
  const order = ringOrder(focus).filter((type) => radii.has(type));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  order.forEach((type, index) => {
    const radius = radii.get(type);
    if (radius == null) return;
    const ring = nodes.filter((node) => !node.seed && node.entityType === type);
    if (index === 0) {
      placeRing(ring, radius);
      return;
    }
    placeAroundParents(ring, radius, order[index - 1], links, byId);
  });
}

function placeRing(nodes: DrawNode[], radius: number) {
  nodes.forEach((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    setOnRing(node, angle, radius);
  });
}

function placeAroundParents(
  nodes: DrawNode[],
  radius: number,
  parentType: EntityType,
  links: GraphLink[],
  byId: Map<string, DrawNode>,
) {
  const groups = new Map<string, DrawNode[]>();
  const orphans: DrawNode[] = [];
  for (const node of nodes) {
    const parent = ringParent(node.id, links, byId, parentType);
    if (!parent || !onRing(parent)) {
      orphans.push(node);
      continue;
    }
    const list = groups.get(parent.id) ?? [];
    list.push(node);
    groups.set(parent.id, list);
  }

  const parents = [...groups.keys()].map((id) => byId.get(id)!).sort((a, b) => nodeAngle(a) - nodeAngle(b));
  const ideal = RING_NODE_GAP / radius;
  const seated: DrawNode[] = [];
  parents.forEach((parent, index) => {
    const group = groups.get(parent.id) ?? [];
    const spacing = fanSpacing(group.length, parentRoom(parents, index), ideal);
    const span = (group.length - 1) * spacing;
    const start = nodeAngle(parent) - span / 2;
    group.forEach((node, slot) => setOnRing(node, start + slot * spacing, radius));
    seated.push(...group);
  });
  for (const node of orphans) {
    setOnRing(node, gapCenter(seated.map(nodeAngle)), radius);
    seated.push(node);
  }
}

function ringOrder(focus?: EntityType): EntityType[] {
  // Releases sit between artists and labels, since that is the link between them.
  if (focus === "artist") return ["artist", "release", "label"];
  const start = focus ? RING_ORDER.indexOf(focus) : 0;
  if (start <= 0) return RING_ORDER;
  return [...RING_ORDER.slice(start), ...RING_ORDER.slice(0, start)];
}

function ringRadii(nodes: DrawNode[], focus?: EntityType): Map<EntityType, number> {
  const present = ringOrder(focus).filter((type) => nodes.some((node) => !node.seed && node.entityType === type));
  const radii = new Map<EntityType, number>();
  present.forEach((type, index) => {
    radii.set(type, (index + 1) * RING_GAP);
  });
  return radii;
}

function ringRadius(node: DrawNode, radii: Map<EntityType, number>): number {
  if (node.seed) return 0;
  return radii.get(node.entityType) ?? RING_GAP;
}

function seatRingNode(
  node: DrawNode,
  nodes: DrawNode[],
  links: GraphLink[],
  radii: Map<EntityType, number>,
  focus?: EntityType,
): boolean {
  const order = ringOrder(focus).filter((type) => radii.has(type));
  const index = order.indexOf(node.entityType);
  if (index < 0) return false;
  const radius = ringRadius(node, radii);
  const parentType = index > 0 ? order[index - 1] : undefined;
  const byId = new Map(nodes.map((item) => [item.id, item]));
  if (parentType) {
    const parent = ringParent(node.id, links, byId, parentType);
    if (parent && !onRing(parent)) return false;
    if (parent) {
      const taken = nodes.filter((item) => item !== node && item.entityType === node.entityType && onRing(item)).map(nodeAngle);
      setOnRing(node, nextFanAngle(nodeAngle(parent), taken, radius), radius);
      return true;
    }
  }
  const taken = nodes.filter((item) => item !== node && item.entityType === node.entityType && onRing(item)).map(nodeAngle);
  setOnRing(node, gapCenter(taken), radius);
  return true;
}

function ringParent(id: string, links: GraphLink[], byId: Map<string, DrawNode>, type: EntityType): DrawNode | undefined {
  for (const link of links) {
    const otherId = link.source === id ? link.target : link.target === id ? link.source : "";
    const other = otherId ? byId.get(otherId) : undefined;
    if (other && other.entityType === type && !other.seed) return other;
  }
  return undefined;
}

function fanSpacing(count: number, room: number, ideal: number): number {
  if (count <= 1) return 0;
  return Math.min(ideal, room / count);
}

function parentRoom(parents: DrawNode[], index: number): number {
  if (parents.length <= 1) return Math.PI * 2;
  const angle = nodeAngle(parents[index]);
  const prev = nodeAngle(parents[(index - 1 + parents.length) % parents.length]);
  const next = nodeAngle(parents[(index + 1) % parents.length]);
  return Math.min(forwardAngle(prev, angle), forwardAngle(angle, next));
}

function nextFanAngle(origin: number, taken: number[], radius: number): number {
  const step = RING_NODE_GAP / Math.max(radius, 1);
  const clear = (angle: number) => taken.every((held) => angleDistance(angle, held) >= step * 0.9);
  const limit = taken.length + 1;
  for (let i = 0; i <= limit; i++) {
    const candidates = i === 0 ? [origin] : [origin + i * step, origin - i * step];
    for (const angle of candidates) {
      if (clear(angle)) return angle;
    }
  }
  return origin + limit * step;
}

function gapCenter(angles: number[]): number {
  if (angles.length === 0) return -Math.PI / 2;
  const sorted = [...angles].sort((a, b) => a - b);
  let best = -1;
  let at = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    const gap = next - current;
    if (gap > best) {
      best = gap;
      at = current + gap / 2;
    }
  }
  return at;
}

function setOnRing(node: DrawNode, angle: number, radius: number) {
  node.x = Math.cos(angle) * radius;
  node.y = Math.sin(angle) * radius;
  node.vx = 0;
  node.vy = 0;
}

function onRing(node: DrawNode): boolean {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return false;
  return Math.hypot(node.x ?? 0, node.y ?? 0) >= 40;
}

function nodeAngle(node: DrawNode): number {
  const angle = Math.atan2(node.y ?? 0, node.x ?? 0);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function forwardAngle(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2);
  return turn < 0 ? turn + Math.PI * 2 : turn;
}

function angleDistance(a: number, b: number): number {
  const gap = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(gap, Math.PI * 2 - gap);
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

function placeNewcomers(nodes: DrawNode[], links: GraphLink[], layout: ExploreLayout, focus?: EntityType) {
  const placed = (node: DrawNode) => Number.isFinite(node.x) && Number.isFinite(node.y);
  if (!nodes.some(placed)) return;
  const radii = layout === "rings" ? ringRadii(nodes, focus) : null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let pending = nodes.filter((node) => node.fx == null && !placed(node));
  for (let pass = 0; pass < nodes.length && pending.length > 0; pass++) {
    const next: DrawNode[] = [];
    for (const node of pending) {
      if (radii) {
        if (!seatRingNode(node, nodes, links, radii, focus)) next.push(node);
        continue;
      }
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

function dropUnplaced(nodes: DrawNode[], links: GraphLink[], layout: ExploreLayout, focus?: EntityType) {
  const loose = nodes.filter((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y));
  if (loose.length === 0 || layout === "proximity") return;
  const radii = ringRadii(nodes, focus);
  let pending = loose;
  for (let pass = 0; pass < nodes.length && pending.length > 0; pass++) {
    const next: DrawNode[] = [];
    for (const node of pending) {
      if (!seatRingNode(node, nodes, links, radii, focus)) next.push(node);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  pending.forEach((node, index) => {
    const radius = ringRadius(node, radii);
    const angle = (index / Math.max(pending.length, 1)) * Math.PI * 2;
    setOnRing(node, angle, radius);
  });
}

function anchoredNeighbor(id: string, links: GraphLink[], byId: Map<string, DrawNode>): DrawNode | undefined {
  for (const link of links) {
    const otherId = link.source === id ? link.target : link.target === id ? link.source : "";
    const other = otherId ? byId.get(otherId) : undefined;
    if (other && Number.isFinite(other.x) && Number.isFinite(other.y)) return other;
  }
  return undefined;
}

function neighborIds(links: SimLink[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === id) ids.add(target);
    else if (target === id) ids.add(source);
  }
  return ids;
}

function endpointId(end: string | DrawNode): string {
  return typeof end === "string" ? end : end.id;
}

function endpointType(end: string | DrawNode): EntityType | null {
  if (typeof end !== "string") return end.entityType;
  const type = end.slice(0, end.indexOf(":"));
  if (type === "artist" || type === "label" || type === "release") return type;
  return null;
}

function crossRelease(link: SimLink): boolean {
  const source = endpointType(link.source);
  const target = endpointType(link.target);
  return (source === "release") !== (target === "release");
}

function nodePhrase(node: DrawNode): string {
  const year = node.entityType === "release" && node.year ? ` (${node.year})` : "";
  return `${node.name}${year} · ${node.entityType}`;
}

function linkPhrase(link: SimLink): string {
  // Artist and label lists sort related releases by year, and that year is stored on the
  // similarity edge. It is not a score, so the edge stays "similar".
  if (link.kind === "SIMILAR") return link.score && !crossRelease(link) ? `similar ${link.score}` : "similar";
  if (link.kind === "PRIMARY_ON") return "credited on";
  if (link.kind === "APPEARS_ON") return "appears on";
  if (link.kind === "REMIXED") return "remixed";
  if (link.kind === "ISSUED") return "issued by";
  if (link.kind === "ALIAS_OF") return "alias of";
  if (link.kind === "MEMBER_OF") return "member of";
  return "sublabel of";
}

function linkKey(link: SimLink): string {
  return `${link.kind}|${endpointId(link.source)}|${endpointId(link.target)}`;
}

function linkPresence(link: SimLink, alphas: Map<string, number>): number {
  return alphas.get(linkKey(link)) ?? 1;
}

function linkPaint(link: SimLink, presence: number, ink: readonly [number, number, number]): string {
  const full = link.kind === "SIMILAR" ? 0.85 : 0.35;
  const opacity = 0.05 + (full - 0.05) * presence;
  const [r, g, b] = ink;
  return `rgba(${r},${g},${b},${opacity})`;
}

function linkWidth(link: SimLink, presence: number): number {
  const full = link.kind === "SIMILAR" ? 1.5 : 0.7;
  return 0.4 + (full - 0.4) * presence;
}

function easeHover(
  nodes: DrawNode[],
  links: SimLink[],
  hoverId: string | null,
  selectedId: string | null,
  nodeAlpha: Map<string, number>,
  linkAlpha: Map<string, number>,
  clock: { current: number },
): boolean {
  const now = performance.now();
  const dt = clock.current === 0 ? 16 : Math.min(48, now - clock.current);
  clock.current = now;
  const step = 1 - Math.exp(-dt / FADE_TAU);
  const neighbors = hoverId ? neighborIds(links, hoverId) : null;
  let moving = false;
  const seenNodes = new Set<string>();
  for (const node of nodes) {
    seenNodes.add(node.id);
    const near = !hoverId || node.id === hoverId || neighbors!.has(node.id);
    const target = near ? 1 : node.id === selectedId ? SELECTED_DIM_ALPHA : DIM_ALPHA;
    moving = easeToward(nodeAlpha, node.id, target, step) || moving;
  }
  for (const id of nodeAlpha.keys()) if (!seenNodes.has(id)) nodeAlpha.delete(id);
  const seenLinks = new Set<string>();
  for (const link of links) {
    const key = linkKey(link);
    seenLinks.add(key);
    const lit = !neighbors || (neighbors.has(endpointId(link.source)) && neighbors.has(endpointId(link.target)));
    moving = easeToward(linkAlpha, key, lit ? 1 : 0, step) || moving;
  }
  for (const key of linkAlpha.keys()) if (!seenLinks.has(key)) linkAlpha.delete(key);
  return moving;
}

function easeToward(values: Map<string, number>, key: string, target: number, step: number): boolean {
  const current = values.get(key) ?? 1;
  const next = current + (target - current) * step;
  if (Math.abs(next - target) <= FADE_SNAP) {
    values.set(key, target);
    return false;
  }
  values.set(key, next);
  return true;
}

type LiveForce = {
  distance?: (fn: (link: SimLink) => number) => void;
  strength?: (value?: Strength) => Strength;
};

function asForce(force: unknown): LiveForce | undefined {
  return force as LiveForce | undefined;
}

function putForce(graph: ForceGraphMethods, name: string, force: object | null) {
  graph.d3Force(name, force as never);
}

function linkDistance(link: SimLink, layout: GraphLayout): number {
  if (layout === "proximity") return proximityDistance(link);
  if (link.kind === "SIMILAR" && link.score) return Math.max(40, 150 / link.score);
  return 46;
}

function proximityDistance(link: SimLink): number {
  if (link.kind === "SIMILAR" && link.score) return 36 + 200 * Math.exp(-link.score / 5);
  if (link.kind === "ISSUED" || link.kind === "SUBLABEL_OF") return 42;
  if (link.kind === "ALIAS_OF" || link.kind === "MEMBER_OF") return 36;
  return 120;
}

function proximityStrength(link: SimLink): number {
  if (link.kind === "SIMILAR") return 1;
  if (link.kind === "ISSUED" || link.kind === "SUBLABEL_OF") return 0.5;
  if (link.kind === "ALIAS_OF" || link.kind === "MEMBER_OF") return 0.55;
  return 0.05;
}

function writeStrength(force: LiveForce | undefined, value: Strength | null) {
  if (value == null) return;
  force?.strength?.(value);
}

function chooseLabels(
  nodes: DrawNode[],
  hoverId: string | null,
  selectedId: string | null,
  scale: number,
  context: CanvasRenderingContext2D,
): Set<string> {
  const fontSize = LABEL_FONT / Math.max(scale, 0.01);
  context.font = `${fontSize}px sans-serif`;
  const pad = 3 / Math.max(scale, 0.01);
  const shown = new Set<string>();
  const boxes: Box[] = [];
  const ranked = [...nodes].sort((a, b) => labelRank(b, hoverId, selectedId) - labelRank(a, hoverId, selectedId));
  for (const node of ranked) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const pinned = node.id === hoverId || node.id === selectedId;
    const must = pinned || (node.seed && !hoverId);
    const width = Math.max(context.measureText(node.name).width, node.name.length * fontSize * 0.5);
    const height = fontSize * 1.15;
    const radius = node.seed ? 8 : 5;
    const box = { x: (node.x ?? 0) + radius + LABEL_GAP, y: (node.y ?? 0) - height / 2, w: width, h: height };
    if (must || !boxes.some((other) => overlaps(box, other, pad))) {
      shown.add(node.id);
      boxes.push(box);
    }
  }
  return shown;
}

function labelRank(node: DrawNode, hoverId: string | null, selectedId: string | null): number {
  if (node.id === hoverId) return 3;
  if (node.id === selectedId) return 2;
  if (node.seed) return 1;
  return 0;
}

function overlaps(a: Box, b: Box, pad: number): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

function menuHeight(seedAction: boolean, replaceAction: boolean, exploreAction: boolean, startPathAction: boolean): number {
  const items = 1 + (exploreAction ? 1 : 0) + (seedAction ? 1 : 0) + (replaceAction ? 1 : 0) + (startPathAction ? 1 : 0);
  return items * 32;
}

function menuPosition(x: number, y: number, height = 64) {
  const width = 196;
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

const EMPTY_IDS = new Set<string>();

function playingNodeIds(
  session: { releaseId: number | null; artists: { id: number | null }[] },
  links: SimLink[],
): Set<string> {
  const ids = new Set<string>();
  // Track artists, not every artist on the release, so a compilation only lights the current track.
  for (const artist of session.artists) if (artist.id != null) ids.add(`artist:${artist.id}`);
  if (session.releaseId == null) return ids;
  const release = `release:${session.releaseId}`;
  ids.add(release);
  for (const link of links) {
    if (link.kind !== "ISSUED") continue;
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === release && target.startsWith("label:")) ids.add(target);
    else if (target === release && source.startsWith("label:")) ids.add(source);
  }
  return ids;
}

function linkCarries(link: SimLink, play: { release: string; artists: Set<string> }): boolean {
  const source = endpointId(link.source);
  const target = endpointId(link.target);
  const other = source === play.release ? target : target === play.release ? source : null;
  if (!other || (play.artists.size > 0 && !play.artists.has(other))) return false;
  return link.kind === "PRIMARY_ON" || link.kind === "APPEARS_ON" || link.kind === "REMIXED";
}

type Aura = {
  presence: number;
  breath: number;
  drift: number;
  travel: number;
  edge: number;
  running: boolean;
  active: boolean;
  breathOrigin: number;
  driftOrigin: number;
  travelOrigin: number;
  last: number;
};

function alignPhase(value: number, now: number, period: number): number {
  const sine = Math.min(1, Math.max(-1, value * 2 - 1));
  const theta = Math.asin(sine);
  return now - ((theta + Math.PI / 2) / (Math.PI * 2)) * period;
}

function setAuraIntent(aura: Aura, active: boolean, running: boolean, now: number) {
  if (running && !aura.running) {
    aura.breathOrigin = alignPhase(aura.breath, now, BREATH_MS);
    aura.driftOrigin = alignPhase(aura.drift, now, BREATH_MS * 1.7);
    aura.travelOrigin = now - aura.travel * PULSE_MS;
  }
  aura.active = active;
  aura.running = running;
}

function easeAura(current: number, target: number, dt: number, tau: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - target) < 0.004 ? target : next;
}

function stepAura(aura: Aura, now: number) {
  const dt = aura.last === 0 ? 16 : Math.min(48, Math.max(0, now - aura.last));
  aura.last = now;
  aura.presence = easeAura(aura.presence, aura.active ? 1 : 0, dt, AURA_FADE_TAU);
  if (aura.running) {
    aura.breath = 0.5 + 0.5 * Math.sin(((now - aura.breathOrigin) / BREATH_MS) * Math.PI * 2 - Math.PI / 2);
    aura.drift = 0.5 + 0.5 * Math.sin(((now - aura.driftOrigin) / (BREATH_MS * 1.7)) * Math.PI * 2 - Math.PI / 2);
    aura.travel = ((now - aura.travelOrigin) % PULSE_MS) / PULSE_MS;
    aura.edge = easeAura(aura.edge, 1, dt, AURA_FADE_TAU);
    return;
  }
  aura.breath = easeAura(aura.breath, 0, dt, AURA_SETTLE_TAU);
  aura.drift = easeAura(aura.drift, 0, dt, AURA_SETTLE_TAU);
  aura.edge = easeAura(aura.edge, 0, dt, AURA_FADE_TAU);
  if (aura.edge < 0.08) aura.travel = easeAura(aura.travel, 0, dt, AURA_SETTLE_TAU);
}

function auraBusy(aura: Aura): boolean {
  if (aura.running) return true;
  if (Math.abs(aura.presence - (aura.active ? 1 : 0)) > 0.015) return true;
  return aura.breath > 0.015 || aura.drift > 0.015 || aura.travel > 0.015 || aura.edge > 0.015;
}

function paintEdgePulse(link: SimLink, context: CanvasRenderingContext2D, scale: number, aura: Aura, palette: ThemePalette) {
  const source = typeof link.source === "string" ? null : link.source;
  const target = typeof link.target === "string" ? null : link.target;
  if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) return;
  if (source.x === target.x && source.y === target.y) return;
  const peak = -0.08 + aura.travel * 1.16;
  const life = Math.sin(aura.travel * Math.PI) * aura.edge * aura.presence;
  if (life < 0.02) return;
  const from = nodeColor(palette, source.entityType);
  const to = nodeColor(palette, target.entityType);
  const safe = Math.max(scale, 0.01);
  const steps = 36;
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const delta = u - peak;
    const spread = delta < 0 ? 0.32 : 0.14;
    const amount = Math.exp(-0.5 * (delta / spread) ** 2) * life;
    if (amount < 0.06) continue;
    const x = source.x + (target.x - source.x) * u;
    const y = source.y + (target.y - source.y) * u;
    const reach = (12 + amount * 16) / safe;
    fillAura(context, x, y, reach * 0.15, reach, mixHex(from, to, u), amount * 0.045);
  }
}

function paintNodeAura(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number, aura: Aura) {
  const veil = aura.presence;
  if (veil < 0.012) return;
  const breath = aura.breath;
  const drift = aura.drift;
  const now = performance.now();
  context.save();
  context.globalAlpha = alpha;
  // The filled disc is covered by the node. What remains is the blur spilling past its edge.
  context.shadowColor = rgba(color, 0.95);
  context.shadowBlur = veil * (16 + breath * 38);
  context.fillStyle = rgba(color, veil * (0.28 + breath * 0.2));
  context.beginPath();
  context.arc(x, y, radius * 0.78, 0, Math.PI * 2);
  context.fill();
  context.restore();
  const ox = Math.sin((now - aura.breathOrigin) / 4200) * 0.7 * breath;
  const oy = Math.sin((now - aura.breathOrigin) / 3500) * 0.6 * breath;
  fillAura(context, x + ox, y + oy, radius * 0.5, radius + veil * (4 + breath * 9), color, alpha * veil * (0.18 + breath * 0.1));
  fillAura(context, x - ox, y - oy, radius * 0.85, radius + veil * (11 + drift * 16), color, alpha * veil * (0.07 + drift * 0.05));
}

function fillAura(context: CanvasRenderingContext2D, x: number, y: number, inner: number, outer: number, color: string, amount: number) {
  if (outer <= inner + 0.2) return;
  const gradient = context.createRadialGradient(x, y, Math.max(0, inner), x, y, outer);
  gradient.addColorStop(0, rgba(color, amount));
  gradient.addColorStop(0.32, rgba(color, amount * 0.5));
  gradient.addColorStop(0.68, rgba(color, amount * 0.14));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, outer, 0, Math.PI * 2);
  context.fill();
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function mixHex(from: string, to: string, t: number): string {
  const [ar, ag, ab] = rgb(from);
  const [br, bg, bb] = rgb(to);
  const u = Math.min(1, Math.max(0, t));
  const hex = (channel: number) => Math.round(channel).toString(16).padStart(2, "0");
  return `#${hex(ar + (br - ar) * u)}${hex(ag + (bg - ag) * u)}${hex(ab + (bb - ab) * u)}`;
}

function nodeColor(palette: ThemePalette, type: string): string {
  if (type === "artist" || type === "label" || type === "release") return palette.nodes[type];
  return palette.nodes.fallback;
}

function drawNode(node: DrawNode, context: CanvasRenderingContext2D, scale: number, selected: boolean, alpha: number, playing: boolean, aura: Aura, palette: ThemePalette) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const radius = node.seed ? 8 : 5;
  const color = nodeColor(palette, node.entityType);
  context.save();
  if (playing) paintNodeAura(context, x, y, radius, color, alpha, aura);
  context.globalAlpha = alpha;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  if (selected) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = 2 / scale;
    context.strokeStyle = palette.fg;
    context.stroke();
  }
  context.restore();
}

function drawLabel(node: DrawNode, context: CanvasRenderingContext2D, scale: number, alpha: number, fg: string) {
  const x = node.x;
  const y = node.y;
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const radius = node.seed ? 8 : 5;
  context.save();
  context.globalAlpha = alpha;
  const fontSize = LABEL_FONT / scale;
  context.font = `${fontSize}px sans-serif`;
  context.fillStyle = fg;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(node.name, x + radius + LABEL_GAP, y);
  context.restore();
}
