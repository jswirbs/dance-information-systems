import type { EntityType, GraphLinkKind } from "../src/shared/types.js";

/**
 * Join shortest-path segments into one walk.
 * An interior stop matches on its id or any alias in its closure, so two
 * segments that reach the same artist through different aliases still connect.
 */

export type WalkNodeRef = { type: EntityType; id: number };

export type WalkLink<N extends WalkNodeRef> = {
  source: N;
  target: N;
  kind: GraphLinkKind;
  startId: number | null;
};

export type Walk<N extends WalkNodeRef = WalkNodeRef> = {
  nodes: N[];
  links: WalkLink<N>[];
};

export function alignInteriorStops<N extends WalkNodeRef>(
  segments: Array<Walk<N>>,
  stops: N[],
  closures: number[][],
): Array<Walk<N>> {
  const next = segments.map((segment) => ({
    nodes: segment.nodes.slice(),
    links: segment.links.map((link) => ({ ...link })),
  }));
  for (let joint = 1; joint < stops.length - 1; joint += 1) {
    const stop = stops[joint];
    const closure = closures[joint] ?? [];
    if (!stop) continue;
    const left = next[joint - 1];
    const right = next[joint];
    if (left) next[joint - 1] = retarget(left, "end", stop, closure);
    if (right) next[joint] = retarget(right, "start", stop, closure);
  }
  return next;
}

export function joinWalks<N extends WalkNodeRef>(segments: Array<Walk<N>>): Walk<N> | null {
  if (segments.length === 0) return null;
  const nodes = [...segments[0]!.nodes];
  const links = [...segments[0]!.links];
  for (const segment of segments.slice(1)) {
    const joint = nodes[nodes.length - 1];
    const head = segment.nodes[0];
    if (!joint || !head || keyOf(joint) !== keyOf(head)) return null;
    const seen = new Set(nodes.map(keyOf));
    for (const node of segment.nodes.slice(1)) {
      if (seen.has(keyOf(node))) return null;
      nodes.push(node);
    }
    links.push(...segment.links);
  }
  const seen = new Set<string>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return { nodes, links };
}

function retarget<N extends WalkNodeRef>(
  walk: Walk<N>,
  which: "start" | "end",
  stop: N,
  closure: number[],
): Walk<N> {
  const index = which === "start" ? 0 : walk.nodes.length - 1;
  const node = walk.nodes[index];
  if (!node || node.type !== stop.type || node.id === stop.id || !closure.includes(node.id)) return walk;
  const nodes = walk.nodes.slice();
  nodes[index] = stop;
  const links = walk.links.map((link) => ({
    ...link,
    source: link.source === node ? stop : link.source,
    target: link.target === node ? stop : link.target,
  }));
  return { nodes, links };
}

function keyOf(node: WalkNodeRef): string {
  return `${node.type}:${node.id}`;
}
