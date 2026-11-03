import { useState } from "react";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { formatMessage } from "../locales";
import { useLayerOverview } from "../hooks/useLayerOverview";

function LineSample({ dashed }: { dashed?: boolean }) {
  return (
    <svg width="20" height="6" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        y1="3"
        x2="19"
        y2="3"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeOpacity={dashed ? 0.6 : 0.85}
        strokeDasharray={dashed ? "5 4" : undefined}
      />
    </svg>
  );
}

/**
 * Edge-type toggles, link-strength threshold and line legend for the layer
 * overview. Collapsed it is a one-line summary, so it stays out of the graph.
 */
export default function OverviewControls() {
  const model = useLayerOverview();
  const setOverviewEdgeTypes = useDashboardStore((s) => s.setOverviewEdgeTypes);
  const setOverviewMinStrength = useDashboardStore((s) => s.setOverviewMinStrength);
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();

  if (!model || model.availableTypes.length === 0) return null;

  const edgeLabels = t.edgeLabels as Partial<Record<string, { forward: string }>>;
  const labelOf = (type: string) => edgeLabels[type]?.forward ?? type.replace(/_/g, " ");
  const toggleType = (type: string) => {
    const next = new Set(model.edgeTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    if (next.size > 0) setOverviewEdgeTypes(next);
  };
  const activeLabels = model.availableTypes
    .filter(({ type }) => model.edgeTypes.has(type))
    .map(({ type }) => labelOf(type));

  return (
    <div className="absolute top-16 left-4 z-10 max-w-[calc(100%-2rem)] rounded-xl glass border border-border-subtle shadow-lg text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className="text-[10px] uppercase tracking-wider text-text-muted">{t.layerOverview.links}</span>
        <span className="truncate min-w-0 max-w-[260px]">{activeLabels.join(", ")}</span>
        <span className="text-text-muted whitespace-nowrap">· ≥ {model.minStrength}</span>
        {model.hiddenWeakCount > 0 && (
          <span className="text-text-muted whitespace-nowrap">
            · {formatMessage(t.layerOverview.hiddenWeak, { count: model.hiddenWeakCount })}
          </span>
        )}
        <span className="ml-2 hidden sm:flex items-center gap-1.5 text-text-muted whitespace-nowrap">
          <LineSample />
          {t.layerOverview.dependency}
          <LineSample dashed />
          {t.layerOverview.backLink}
        </span>
        <span className={`ml-1 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 space-y-2 border-t border-border-subtle pt-2 max-w-[560px]">
          <div className="flex flex-wrap items-center gap-1.5">
            {model.availableTypes.map(({ type, count }) => {
              const on = model.edgeTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={on}
                  className={`px-2 py-0.5 rounded-full border transition-colors ${
                    on
                      ? "border-accent/50 bg-accent/15 text-accent"
                      : "border-border-subtle text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {labelOf(type)}
                  <span className="ml-1 font-mono opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          {model.maxStrength > 1 && (
            <label className="flex items-center gap-2 text-text-secondary">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">{t.layerOverview.minStrength}</span>
              <input
                type="range"
                min={1}
                max={model.maxStrength}
                value={Math.min(model.minStrength, model.maxStrength)}
                onChange={(e) => setOverviewMinStrength(Number(e.target.value))}
                className="w-32 accent-[var(--color-accent)]"
              />
              <span className="font-mono text-text-primary">{model.minStrength}</span>
            </label>
          )}
          <div className="text-[10px] text-text-muted">{t.layerOverview.hint}</div>
        </div>
      )}
    </div>
  );
}
