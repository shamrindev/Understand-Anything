import { useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { getLayerColor } from "./LayerLegend";
import type { DependencyGroup } from "../utils/layerGraph";

interface DependencyListProps {
  title: string;
  groups: DependencyGroup[];
  /** Start with every group open (for short lists, e.g. a single file). */
  defaultOpen?: boolean;
}

/**
 * "Uses" / "Used by" grouped by layer: one row per layer with the link count
 * and a strength bar, expanding to the files behind it; a file opens on click.
 */
export default function DependencyList({ title, groups, defaultOpen = false }: DependencyListProps) {
  const graph = useDashboardStore((s) => s.graph);
  const nodesById = useDashboardStore((s) => s.nodesById);
  const navigateToNode = useDashboardStore((s) => s.navigateToNode);
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(defaultOpen ? groups.map((g) => g.layerId ?? "") : []),
  );

  if (groups.length === 0 || !graph) return null;

  const layers = new Map(graph.layers.map((l, i) => [l.id, { name: l.name, index: i }]));
  const max = Math.max(...groups.map((g) => g.count));
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold text-accent uppercase tracking-wider mb-2 flex items-baseline gap-2">
        {title}
        <span className="font-mono text-text-muted normal-case tracking-normal">{total}</span>
      </h3>
      <div className="space-y-1">
        {groups.map((group) => {
          const key = group.layerId ?? "";
          const layer = group.layerId ? layers.get(group.layerId) : undefined;
          const color = layer ? getLayerColor(layer.index).label : "var(--color-text-muted)";
          const name = layer?.name ?? group.layerId ?? t.layerOverview.outsideLayers;
          const isOpen = open.has(key);
          return (
            <div key={key} className="rounded-lg bg-elevated border border-border-subtle overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className="w-full px-3 py-2 text-left hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-text-primary truncate flex-1">{name}</span>
                  <span className="font-mono text-text-secondary">{group.count}</span>
                  <span className={`text-text-muted text-[10px] transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                </div>
                <div className="mt-1.5 h-0.5 rounded-full bg-border-subtle">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(group.count / max) * 100}%`, backgroundColor: color, opacity: 0.7 }}
                  />
                </div>
              </button>
              {isOpen && (
                <ul className="pb-1.5">
                  {group.items.map((item) => {
                    const node = nodesById.get(item.nodeId);
                    return (
                      <li key={item.nodeId}>
                        <button
                          type="button"
                          onClick={() => navigateToNode(item.nodeId)}
                          className="w-full flex items-center gap-2 px-3 pl-7 py-1 text-left text-[11px] text-text-secondary hover:text-accent transition-colors"
                          title={node?.filePath ?? node?.name ?? item.nodeId}
                        >
                          <span className="truncate flex-1">{node?.name ?? item.nodeId}</span>
                          <span className="font-mono text-text-muted">{item.count}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
