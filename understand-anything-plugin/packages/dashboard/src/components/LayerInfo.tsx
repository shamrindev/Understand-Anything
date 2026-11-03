import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { formatMessage } from "../locales";
import { getLayerColor } from "./LayerLegend";
import DependencyList from "./DependencyList";
import { useLayerOverview } from "../hooks/useLayerOverview";
import { buildOwnerIndex, collectDependencies, hasFileMembers, usesPair, withContainedNodes } from "../utils/layerGraph";

/** Sidebar for the layer selected on the overview: what it uses, who uses it, its files. */
export default function LayerInfo() {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const selectedLayerId = useDashboardStore((s) => s.selectedLayerId);
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const model = useLayerOverview();
  const { t } = useI18n();

  const layerIndex = graph?.layers.findIndex((l) => l.id === selectedLayerId) ?? -1;
  const layer = layerIndex >= 0 ? graph!.layers[layerIndex] : null;

  const details = useMemo(() => {
    if (!graph || !layer || !model) return null;
    const members = withContainedNodes(graph, layer.nodeIds);
    const deps = collectDependencies(graph, members, model.edgeTypes);
    // Files ranked by how much they are used, so the important ones come first.
    const { unitOf } = buildOwnerIndex(graph);
    const usage = new Map<string, number>();
    for (const edge of graph.edges) {
      if (!model.edgeTypes.has(edge.type)) continue;
      const [user, used] = usesPair(edge);
      const unit = unitOf.get(used);
      if (unit && members.has(unit) && unitOf.get(user) !== unit) {
        usage.set(unit, (usage.get(unit) ?? 0) + 1);
      }
    }
    const files = layer.nodeIds
      .map((id) => nodesById.get(id))
      .filter((n) => n !== undefined)
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    return { deps, files, usage };
  }, [graph, layer, model, nodesById]);

  if (!layer || !details || !model) return null;

  const color = getLayerColor(layerIndex);
  const fileBacked = hasFileMembers(layer.nodeIds, nodesById);
  const isFoundation = model.foundationIds.includes(layer.id);
  const dependents = new Set(model.links.filter((l) => l.target === layer.id).map((l) => l.source));

  return (
    <div className="h-full w-full overflow-auto p-5 animate-fade-slide-in">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color.label }} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {isFoundation ? t.layerOverview.foundation : t.layer.defaultName}
        </span>
      </div>
      <h2 className="text-lg font-heading text-text-primary mb-2">{layer.name}</h2>
      {layer.description && (
        <p className="text-sm text-text-secondary leading-relaxed mb-3">{layer.description}</p>
      )}
      <div className="flex items-center justify-between gap-3 mb-5">
        <span className="text-[11px] text-text-muted">
          {formatMessage(fileBacked ? t.layerOverview.files : t.layerOverview.nodes, { count: layer.nodeIds.length })}
          {dependents.size > 0 && (
            <>
              {" · "}
              {formatMessage(t.layerOverview.usedByLayers, {
                count: dependents.size,
                total: graph!.layers.length - 1,
              })}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => drillIntoLayer(layer.id)}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded border border-accent/30 text-accent hover:text-accent-bright hover:border-accent/60 transition-colors"
        >
          {t.layerOverview.openLayer} →
        </button>
      </div>

      <DependencyList key={`uses:${layer.id}`} title={t.layerOverview.uses} groups={details.deps.uses} />
      <DependencyList key={`usedBy:${layer.id}`} title={t.layerOverview.usedBy} groups={details.deps.usedBy} />
      {details.deps.uses.length === 0 && details.deps.usedBy.length === 0 && (
        <p className="text-xs text-text-muted mb-4">{t.layerOverview.noLinks}</p>
      )}

      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2">
        {fileBacked ? t.layerOverview.layerFiles : t.projectOverview.nodes}
      </h3>
      <ul className="space-y-1">
        {details.files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => navigateToNode(file.id)}
              className="w-full text-left text-xs bg-elevated rounded-lg px-3 py-2 border border-border-subtle hover:border-accent/40 hover:bg-accent/5 transition-colors"
              title={file.filePath ?? file.name}
            >
              <div className="flex items-center gap-2">
                <span className="text-text-primary truncate flex-1">{file.name}</span>
                {(details.usage.get(file.id) ?? 0) > 0 && (
                  <span
                    className="font-mono text-[10px] text-text-muted"
                    title={`${t.layerOverview.usedBy}: ${details.usage.get(file.id)}`}
                  >
                    {details.usage.get(file.id)}
                  </span>
                )}
              </div>
              {file.summary && (
                <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">{file.summary}</p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
