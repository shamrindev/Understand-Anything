import type { EdgeType, GraphNode, KnowledgeGraph, Layer } from "@understand-anything/core/types";

/**
 * Edge types that say "A needs B" — the only ones the layer overview draws by
 * default. Covers every graph kind UA produces: code (imports/calls/…),
 * runtime wiring (events, data access), domain, knowledge and design graphs.
 * Everything else (contains, exports, documents, related, tested_by, …) is
 * structure or metadata and stays opt-in.
 */
export const DEPENDENCY_EDGE_TYPES: ReadonlySet<EdgeType> = new Set<EdgeType>([
  // code
  "imports", "calls", "depends_on", "inherits", "implements", "middleware",
  // runtime / data
  "subscribes", "publishes", "triggers", "reads_from", "writes_to",
  // domain
  "cross_domain",
  // knowledge
  "builds_on", "cites",
  // design
  "instance_of", "variant_of", "uses_token",
]);

/**
 * Edge types whose source is the side being *used*: "X tested_by T" means the
 * test T depends on X, "C configures X" means X depends on its config C.
 */
const USED_SIDE_IS_SOURCE: ReadonlySet<string> = new Set(["tested_by", "configures"]);

/** The edge as an [user, used] pair, whatever way its type points. */
export function usesPair(edge: { source: string; target: string; type: string }): [string, string] {
  return USED_SIDE_IS_SOURCE.has(edge.type)
    ? [edge.target, edge.source]
    : [edge.source, edge.target];
}

export interface OwnerIndex {
  /** Any node id → id of the layer it (or its containing file) belongs to. */
  layerOf: Map<string, string>;
  /** Any node id → id of the layer member that owns it (a function → its file). */
  unitOf: Map<string, string>;
}

const ownerIndexCache = new WeakMap<KnowledgeGraph, OwnerIndex>();

/**
 * Resolve every node to the layer member that owns it. Layers list file-level
 * nodes, while `calls` and friends connect functions and classes, so those are
 * lifted to their file through `contains` edges.
 */
export function buildOwnerIndex(graph: KnowledgeGraph): OwnerIndex {
  const cached = ownerIndexCache.get(graph);
  if (cached) return cached;

  const layerOf = new Map<string, string>();
  const unitOf = new Map<string, string>();
  for (const layer of graph.layers ?? []) {
    for (const id of layer.nodeIds) {
      if (layerOf.has(id)) continue;
      layerOf.set(id, layer.id);
      unitOf.set(id, id);
    }
  }

  const parentOf = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type === "contains" && !parentOf.has(edge.target)) {
      parentOf.set(edge.target, edge.source);
    }
  }

  for (const node of graph.nodes) {
    if (unitOf.has(node.id)) continue;
    let current = parentOf.get(node.id);
    // Bounded walk: contains-chains are shallow (file → class → method) and a
    // malformed cycle must not hang the dashboard.
    for (let depth = 0; current && depth < 8; depth++) {
      const unit = unitOf.get(current);
      if (unit) {
        unitOf.set(node.id, unit);
        layerOf.set(node.id, layerOf.get(unit)!);
        break;
      }
      current = parentOf.get(current);
    }
  }

  const index = { layerOf, unitOf };
  ownerIndexCache.set(graph, index);
  return index;
}

export interface LayerLink {
  /** Layer that uses… */
  source: string;
  /** …this layer. */
  target: string;
  /** Number of underlying graph edges. */
  count: number;
  byType: Record<string, number>;
}

/** Directed layer → layer dependencies built from the given edge types. */
export function aggregateLayerLinks(
  graph: KnowledgeGraph,
  edgeTypes: ReadonlySet<string>,
): LayerLink[] {
  const { layerOf } = buildOwnerIndex(graph);
  const links = new Map<string, LayerLink>();
  for (const edge of graph.edges) {
    if (!edgeTypes.has(edge.type)) continue;
    const [user, used] = usesPair(edge);
    const source = layerOf.get(user);
    const target = layerOf.get(used);
    if (!source || !target || source === target) continue;
    const key = `${source.length}:${source}${target}`;
    let link = links.get(key);
    if (!link) {
      link = { source, target, count: 0, byType: {} };
      links.set(key, link);
    }
    link.count++;
    link.byType[edge.type] = (link.byType[edge.type] ?? 0) + 1;
  }
  return [...links.values()].sort((a, b) => b.count - a.count);
}

export interface EdgeTypeCount {
  type: string;
  count: number;
  /** Whether the type is part of the default dependency set. */
  isDependency: boolean;
}

/** Edge types that actually cross layer boundaries, most frequent first. */
export function crossLayerEdgeTypes(graph: KnowledgeGraph): EdgeTypeCount[] {
  const { layerOf } = buildOwnerIndex(graph);
  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    const a = layerOf.get(edge.source);
    const b = layerOf.get(edge.target);
    if (!a || !b || a === b) continue;
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      isDependency: DEPENDENCY_EDGE_TYPES.has(type as EdgeType),
    }))
    .sort((a, b) => Number(b.isDependency) - Number(a.isDependency) || b.count - a.count);
}

/**
 * Edge types the overview starts with: the dependency types present in the
 * graph. A graph that has none of them (e.g. a docs-only graph linked by
 * `related`) falls back to every type, so the overview is never empty.
 */
export function defaultOverviewEdgeTypes(available: EdgeTypeCount[]): Set<string> {
  const deps = available.filter((t) => t.isDependency).map((t) => t.type);
  return new Set(deps.length > 0 ? deps : available.map((t) => t.type));
}

/**
 * Default minimum link strength: hide links weaker than ~15% of the strongest
 * one, capped at 5 so big graphs drop only noise and small graphs keep all.
 */
export function defaultMinStrength(links: LayerLink[]): number {
  const max = links.reduce((m, l) => Math.max(m, l.count), 0);
  return Math.min(5, Math.max(1, Math.round(max * 0.15)));
}

/**
 * Layers that most other layers depend on while barely depending on anything
 * themselves (a logger, shared types, utils). Drawing an arrow from every layer
 * into such a hub only adds noise, so the overview shows them as a foundation
 * band underneath instead.
 */
export function findFoundationLayers(
  layerIds: string[],
  links: LayerLink[],
  minStrength: number,
): string[] {
  const n = layerIds.length;
  if (n < 4) return [];
  const stats = new Map(layerIds.map((id) => [id, { dependents: 0, inWeight: 0, outWeight: 0 }]));
  for (const link of links) {
    const into = stats.get(link.target);
    const from = stats.get(link.source);
    if (!into || !from) continue;
    into.inWeight += link.count;
    from.outWeight += link.count;
    if (link.count >= minStrength) into.dependents++;
  }
  const foundation = layerIds
    .filter((id) => {
      const s = stats.get(id)!;
      return s.dependents > (n - 1) / 2 && s.outWeight <= s.inWeight * 0.25;
    })
    .sort((a, b) => stats.get(b)!.dependents - stats.get(a)!.dependents);
  // Keep at least two layers in the tiers, otherwise there is nothing to read.
  return foundation.slice(0, Math.max(0, n - 2));
}

export interface DependencyItem {
  nodeId: string;
  count: number;
}

export interface DependencyGroup {
  /** Layer of the other side; `null` for nodes outside every layer. */
  layerId: string | null;
  count: number;
  items: DependencyItem[];
}

export interface Dependencies {
  uses: DependencyGroup[];
  usedBy: DependencyGroup[];
}

/**
 * What a set of nodes (a file with its functions, or a whole layer) uses and
 * is used by, grouped by the other side's layer and lifted to layer members.
 */
export function collectDependencies(
  graph: KnowledgeGraph,
  memberIds: ReadonlySet<string>,
  edgeTypes: ReadonlySet<string>,
): Dependencies {
  const { layerOf, unitOf } = buildOwnerIndex(graph);
  const uses = new Map<string, Map<string, number>>();
  const usedBy = new Map<string, Map<string, number>>();
  const bump = (bucket: Map<string, Map<string, number>>, otherId: string) => {
    const unit = unitOf.get(otherId) ?? otherId;
    if (memberIds.has(unit)) return;
    const layerKey = layerOf.get(otherId) ?? "";
    let items = bucket.get(layerKey);
    if (!items) {
      items = new Map();
      bucket.set(layerKey, items);
    }
    items.set(unit, (items.get(unit) ?? 0) + 1);
  };

  for (const edge of graph.edges) {
    if (!edgeTypes.has(edge.type)) continue;
    const [user, used] = usesPair(edge);
    const userInside = memberIds.has(unitOf.get(user) ?? user);
    const usedInside = memberIds.has(unitOf.get(used) ?? used);
    if (userInside && !usedInside) bump(uses, used);
    else if (usedInside && !userInside) bump(usedBy, user);
  }

  const toGroups = (bucket: Map<string, Map<string, number>>): DependencyGroup[] =>
    [...bucket.entries()]
      .map(([layerKey, items]) => {
        const list = [...items.entries()]
          .map(([nodeId, count]) => ({ nodeId, count }))
          .sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId));
        return {
          layerId: layerKey || null,
          count: list.reduce((sum, i) => sum + i.count, 0),
          items: list,
        };
      })
      .sort((a, b) => b.count - a.count);

  return { uses: toGroups(uses), usedBy: toGroups(usedBy) };
}

/** Whether a layer is made of files (code, docs) rather than domain or knowledge nodes. */
export function hasFileMembers(nodeIds: string[], nodesById: Map<string, GraphNode>): boolean {
  return nodeIds.length > 0 && nodeIds.every((id) => !!nodesById.get(id)?.filePath);
}

/** A node plus everything it contains (a file and its functions/classes). */
export function withContainedNodes(graph: KnowledgeGraph, rootIds: Iterable<string>): Set<string> {
  const result = new Set(rootIds);
  const { unitOf } = buildOwnerIndex(graph);
  for (const [nodeId, unit] of unitOf) {
    if (result.has(unit)) result.add(nodeId);
  }
  return result;
}

const MAX_FALLBACK_LAYERS = 12;
const DERIVED_LAYER_PREFIX = "layer:auto:";

/** Layers the dashboard made up for a layer-less graph; not part of the data. */
export function isDerivedLayer(layer: Layer): boolean {
  return layer.id.startsWith(DERIVED_LAYER_PREFIX);
}

/**
 * Graphs analysed without the architecture step carry no layers, which leaves
 * the overview blank. Group top-level nodes by folder instead (or by node type
 * when they have no file path) so the overview still has something to show.
 */
export function deriveFallbackLayers(graph: KnowledgeGraph): Layer[] {
  const contained = new Set(
    graph.edges.filter((e) => e.type === "contains").map((e) => e.target),
  );
  const roots = graph.nodes.filter((n) => !contained.has(n.id));
  if (roots.length === 0) return [];

  const paths = roots
    .map((n) => n.filePath?.split("/").filter(Boolean))
    .filter((p): p is string[] => !!p && p.length > 0);

  // Skip folders every file shares (e.g. a lone `src/`), so groups are meaningful.
  let depth = 0;
  while (
    paths.length > 0 &&
    paths.every((p) => p.length > depth + 1 && p[depth] === paths[0][depth])
  ) {
    depth++;
  }

  const groupKey = (node: GraphNode): string => {
    const parts = node.filePath?.split("/").filter(Boolean);
    if (!parts || parts.length === 0) return node.type;
    const dirs = parts.slice(0, -1);
    if (dirs.length > depth) return `${dirs.slice(0, depth + 1).join("/")}/`;
    return dirs.length > 0 ? `${dirs.join("/")}/` : "./";
  };

  const groups = new Map<string, GraphNode[]>();
  for (const node of roots) {
    const key = groupKey(node);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(node);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const kept = sorted.slice(0, MAX_FALLBACK_LAYERS - 1);
  const rest = sorted.slice(MAX_FALLBACK_LAYERS - 1).flatMap(([, nodes]) => nodes);
  if (sorted.length === MAX_FALLBACK_LAYERS) kept.push(sorted[MAX_FALLBACK_LAYERS - 1]);
  else if (rest.length > 0) kept.push(["…", rest]);

  return kept.map(([key, nodes]) => ({
    id: `${DERIVED_LAYER_PREFIX}${key}`,
    name: key,
    description: "",
    nodeIds: nodes.map((n) => n.id),
  }));
}
