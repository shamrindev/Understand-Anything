import { useMemo } from "react";
import { useDashboardStore } from "../store";
import {
  aggregateLayerLinks,
  crossLayerEdgeTypes,
  defaultMinStrength,
  defaultOverviewEdgeTypes,
  findFoundationLayers,
} from "../utils/layerGraph";
import type { EdgeTypeCount, LayerLink } from "../utils/layerGraph";

export interface LayerOverviewModel {
  /** Edge types crossing layers in this graph, dependency types first. */
  availableTypes: EdgeTypeCount[];
  /** Edge types currently counted as links. */
  edgeTypes: ReadonlySet<string>;
  /** Every directed layer link built from `edgeTypes`, strongest first. */
  links: LayerLink[];
  minStrength: number;
  /** Strongest link, for scaling line widths and the threshold control. */
  maxStrength: number;
  /** Layers drawn as the foundation band instead of with arrows. */
  foundationIds: string[];
  /** Links that pass the threshold and don't touch the foundation. */
  visibleLinks: LayerLink[];
  /** Links below the threshold (not counting foundation links). */
  hiddenWeakCount: number;
}

/**
 * Single source of the layer overview's view model, shared by the canvas,
 * its controls and the layer panel so they always agree on what a link is.
 */
export function useLayerOverview(): LayerOverviewModel | null {
  const graph = useDashboardStore((s) => s.graph);
  const overviewEdgeTypes = useDashboardStore((s) => s.overviewEdgeTypes);
  const overviewMinStrength = useDashboardStore((s) => s.overviewMinStrength);

  const availableTypes = useMemo(() => (graph ? crossLayerEdgeTypes(graph) : []), [graph]);
  const edgeTypes = useMemo(
    () => overviewEdgeTypes ?? defaultOverviewEdgeTypes(availableTypes),
    [overviewEdgeTypes, availableTypes],
  );
  const links = useMemo(
    () => (graph ? aggregateLayerLinks(graph, edgeTypes) : []),
    [graph, edgeTypes],
  );

  return useMemo(() => {
    if (!graph || (graph.layers ?? []).length === 0) return null;
    const minStrength = overviewMinStrength ?? defaultMinStrength(links);
    const layerIds = graph.layers.map((l) => l.id);
    const foundationIds = findFoundationLayers(layerIds, links, minStrength);
    const foundation = new Set(foundationIds);
    const visibleLinks: LayerLink[] = [];
    let hiddenWeakCount = 0;
    for (const link of links) {
      if (foundation.has(link.source) || foundation.has(link.target)) continue;
      if (link.count >= minStrength) visibleLinks.push(link);
      else hiddenWeakCount++;
    }
    return {
      availableTypes,
      edgeTypes,
      links,
      minStrength,
      maxStrength: links.reduce((m, l) => Math.max(m, l.count), 0),
      foundationIds,
      visibleLinks,
      hiddenWeakCount,
    };
  }, [graph, availableTypes, edgeTypes, links, overviewMinStrength]);
}
