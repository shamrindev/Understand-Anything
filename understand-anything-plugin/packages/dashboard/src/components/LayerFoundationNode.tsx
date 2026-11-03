import { memo } from "react";
import type { NodeProps, Node } from "@xyflow/react";
import { getLayerColor } from "./LayerLegend";
import type { LayerEmphasis } from "./LayerClusterNode";
import { useI18n } from "../contexts/I18nContext";
import { formatMessage } from "../locales";

export interface LayerFoundationData extends Record<string, unknown> {
  layerId: string;
  layerName: string;
  layerDescription: string;
  fileCount: number;
  membersAreFiles: boolean;
  layerColorIndex: number;
  /** Layers that depend on this one. */
  dependentCount: number;
  /** Layers in the graph other than this one. */
  otherLayerCount: number;
  /** Links from the highlighted layer into this one, if any. */
  highlightedCount?: number;
  emphasis: LayerEmphasis;
}

export type LayerFoundationFlowNode = Node<LayerFoundationData, "layer-foundation">;

/**
 * A layer nearly everything depends on (logger, shared types…), drawn as a
 * band under the tiers instead of a node with an arrow from every layer.
 */
function LayerFoundationNode({ data, width, height }: NodeProps<LayerFoundationFlowNode>) {
  const { t } = useI18n();
  const color = getLayerColor(data.layerColorIndex);
  const dimmed = data.emphasis === "dimmed";

  return (
    <div
      className={`relative rounded-xl border border-dashed cursor-pointer transition-[opacity,border-color] duration-150 flex items-center gap-4 px-5 ${
        data.emphasis === "active" ? "border-accent" : "border-border-medium"
      } ${dimmed ? "opacity-30" : ""}`}
      style={{
        width,
        height,
        background: `repeating-linear-gradient(135deg, ${color.bg} 0 10px, transparent 10px 20px)`,
      }}
      title={data.layerDescription || data.layerName}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: color.label }}>
        {t.layerOverview.foundation}
      </span>
      <span className="text-[15px] font-heading text-text-primary truncate">{data.layerName}</span>
      <span className="text-[11px] text-text-secondary truncate">
        {formatMessage(t.layerOverview.usedByLayers, {
          count: data.dependentCount,
          total: data.otherLayerCount,
        })}
      </span>
      <span className="ml-auto flex items-center gap-3 shrink-0">
        {data.highlightedCount != null && (
          <span className="text-[11px] font-mono text-accent">↓ {data.highlightedCount}</span>
        )}
        <span className="text-[11px] text-text-muted">
          {formatMessage(data.membersAreFiles ? t.layerOverview.files : t.layerOverview.nodes, {
            count: data.fileCount,
          })}
        </span>
      </span>
    </div>
  );
}

export default memo(LayerFoundationNode);
