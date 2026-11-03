import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import { useDashboardStore } from "../store";
import type { LayerClusterFlowNode, LayerEmphasis } from "../components/LayerClusterNode";
import type { LayerFoundationFlowNode } from "../components/LayerFoundationNode";
import type { LayerLinkFlowEdge } from "../components/LayerLinkEdge";
import { computeTierLayout } from "../utils/tierLayout";
import { hasFileMembers } from "../utils/layerGraph";
import { useLayerOverview } from "./useLayerOverview";

const OVERVIEW_CARD_WIDTH = 280;
const OVERVIEW_CARD_HEIGHT = 104;
const FOUNDATION_HEIGHT = 56;
const FOUNDATION_GAP = 64;

const linkId = (source: string, target: string) => `ll:${source.length}:${source}${target}`;

/**
 * Layers placed in tiers by dependency direction (a layer that uses another
 * sits above it), cycles drawn as dashed reverse links, and hub layers most
 * others depend on moved into a foundation band without arrows. Hovering or
 * selecting a layer lights up its links and dims the rest.
 */
export function useOverviewGraph(hoveredLayerId: string | null) {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const nodeIdToLayerId = useDashboardStore((s) => s.nodeIdToLayerId);
  const searchResults = useDashboardStore((s) => s.searchResults);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const selectedLayerId = useDashboardStore((s) => s.selectedLayerId);
  const model = useLayerOverview();

  const layout = useMemo(() => {
    if (!graph || !model) return null;
    const foundation = new Set(model.foundationIds);
    return computeTierLayout(
      graph.layers
        .filter((l) => !foundation.has(l.id))
        .map((l) => ({ id: l.id, width: OVERVIEW_CARD_WIDTH, height: OVERVIEW_CARD_HEIGHT })),
      model.visibleLinks.map((l) => ({
        id: linkId(l.source, l.target),
        source: l.source,
        target: l.target,
        weight: l.count,
      })),
    );
  }, [graph, model]);

  // Search hits per layer via the store's precomputed node → layer index.
  const searchMatchByLayer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of searchResults) {
      const lid = nodeIdToLayerId.get(result.nodeId);
      if (lid) counts.set(lid, (counts.get(lid) ?? 0) + 1);
    }
    return counts;
  }, [searchResults, nodeIdToLayerId]);

  return useMemo(() => {
    if (!graph || !model || !layout) {
      return { nodes: [] as Node[], edges: [] as Edge[], layoutStatus: "ready" as const, layoutKey: "" };
    }
    const layerIndex = new Map(graph.layers.map((l, i) => [l.id, i]));
    const focus = [hoveredLayerId, selectedLayerId].find((id) => id && layerIndex.has(id)) ?? null;
    const foundation = new Set(model.foundationIds);

    // Links that count for highlighting: drawn ones plus links into the foundation.
    const relevant = model.links.filter(
      (l) => l.count >= model.minStrength || foundation.has(l.source) || foundation.has(l.target),
    );
    const neighbours = new Set<string>();
    if (focus) {
      for (const l of relevant) {
        if (l.source === focus) neighbours.add(l.target);
        if (l.target === focus) neighbours.add(l.source);
      }
    }
    const emphasisOf = (id: string): LayerEmphasis =>
      !focus ? "normal" : id === focus ? "active" : neighbours.has(id) ? "related" : "dimmed";

    const nodes: Node[] = [];
    for (const layer of graph.layers) {
      if (foundation.has(layer.id)) continue;
      const position = layout.positions.get(layer.id) ?? { x: 0, y: 0 };
      const clusterNode: LayerClusterFlowNode = {
        id: layer.id,
        type: "layer-cluster",
        position,
        width: OVERVIEW_CARD_WIDTH,
        height: OVERVIEW_CARD_HEIGHT,
        data: {
          layerId: layer.id,
          layerName: layer.name,
          layerDescription: layer.description,
          fileCount: layer.nodeIds.length,
          membersAreFiles: hasFileMembers(layer.nodeIds, nodesById),
          layerColorIndex: layerIndex.get(layer.id)!,
          searchMatchCount: searchMatchByLayer.get(layer.id),
          emphasis: emphasisOf(layer.id),
          onDrillIn: drillIntoLayer,
        },
      };
      nodes.push(clusterNode);
    }

    // Foundation band(s): full width under the tiers, split if there are several.
    const foundationLayers = graph.layers.filter((l) => foundation.has(l.id));
    if (foundationLayers.length > 0) {
      const gap = 24;
      const bandWidth = Math.max(layout.width, OVERVIEW_CARD_WIDTH * foundationLayers.length);
      const each = (bandWidth - gap * (foundationLayers.length - 1)) / foundationLayers.length;
      const startX = (layout.width - bandWidth) / 2;
      const y = layout.height + (layout.height > 0 ? FOUNDATION_GAP : 0);
      foundationLayers.forEach((layer, i) => {
        const dependents = new Set(model.links.filter((l) => l.target === layer.id).map((l) => l.source));
        const fromFocus = focus ? model.links.find((l) => l.source === focus && l.target === layer.id) : undefined;
        const bandNode: LayerFoundationFlowNode = {
          id: layer.id,
          type: "layer-foundation",
          position: { x: startX + i * (each + gap), y },
          width: each,
          height: FOUNDATION_HEIGHT,
          data: {
            layerId: layer.id,
            layerName: layer.name,
            layerDescription: layer.description,
            fileCount: layer.nodeIds.length,
            membersAreFiles: hasFileMembers(layer.nodeIds, nodesById),
            layerColorIndex: layerIndex.get(layer.id)!,
            dependentCount: dependents.size,
            otherLayerCount: graph.layers.length - 1,
            highlightedCount: fromFocus?.count,
            emphasis: emphasisOf(layer.id),
          },
        };
        nodes.push(bandNode);
      });
    }

    const edges: LayerLinkFlowEdge[] = model.visibleLinks.map((link) => {
      const id = linkId(link.source, link.target);
      const route = layout.routes.get(id);
      const isFocusLink = !!focus && (link.source === focus || link.target === focus);
      return {
        id,
        source: link.source,
        target: link.target,
        type: "layer-link",
        data: {
          points: route?.points ?? [],
          count: link.count,
          width: 1 + 4 * Math.sqrt(link.count / Math.max(1, model.maxStrength)),
          reversed: route?.reversed ?? false,
          state: !focus ? "normal" : isFocusLink ? "active" : "dimmed",
        },
      };
    });
    // Later edges paint on top: keep the highlighted ones above the rest.
    edges.sort((a, b) => Number(a.data?.state === "active") - Number(b.data?.state === "active"));

    return {
      nodes,
      edges: edges as Edge[],
      layoutStatus: "ready" as const,
      layoutKey: `${model.foundationIds.join(",")}|${Math.round(layout.width)}x${Math.round(layout.height)}`,
    };
  }, [graph, nodesById, model, layout, hoveredLayerId, selectedLayerId, searchMatchByLayer, drillIntoLayer]);
}
