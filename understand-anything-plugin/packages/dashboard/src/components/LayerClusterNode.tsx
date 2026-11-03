import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { getLayerColor } from "./LayerLegend";
import { useI18n } from "../contexts/I18nContext";
import { formatMessage } from "../locales";

/** How a layer card reads against the current hover/selection. */
export type LayerEmphasis = "normal" | "active" | "related" | "dimmed";

export interface LayerClusterData extends Record<string, unknown> {
  layerId: string;
  layerName: string;
  layerDescription: string;
  fileCount: number;
  /** Whether every member is a file (code graphs) rather than domain/knowledge nodes. */
  membersAreFiles: boolean;
  layerColorIndex: number;
  searchMatchCount?: number;
  emphasis: LayerEmphasis;
  onDrillIn: (layerId: string) => void;
}

export type LayerClusterFlowNode = Node<LayerClusterData, "layer-cluster">;

const emphasisClasses: Record<LayerEmphasis, string> = {
  normal: "border-border-subtle",
  active: "border-accent shadow-[0_0_0_1px_var(--color-accent),0_8px_24px_rgba(0,0,0,0.45)]",
  related: "border-border-medium",
  dimmed: "border-border-subtle opacity-30",
};

// Handles exist only so React Flow accepts the edges; routes are precomputed.
const hiddenHandle = "!opacity-0 !w-1 !h-1 !min-w-0 !min-h-0 !border-0";

function LayerClusterNode({ data, width, height }: NodeProps<LayerClusterFlowNode>) {
  const { t } = useI18n();
  const color = getLayerColor(data.layerColorIndex);
  // Long names get a second line; the description gives one up in exchange.
  const longName = data.layerName.length > 30;

  return (
    <div
      className={`relative rounded-xl bg-elevated border overflow-hidden cursor-pointer transition-[opacity,border-color,box-shadow] duration-150 group ${emphasisClasses[data.emphasis]}`}
      style={{ width, height }}
      title={data.layerDescription || data.layerName}
    >
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: color.label }} />
      <Handle type="target" position={Position.Top} className={hiddenHandle} isConnectable={false} />

      <div className="h-full pl-4 pr-3 py-2.5 flex flex-col">
        <div className="flex items-start gap-2">
          <div className={`text-[14px] font-heading text-text-primary leading-snug flex-1 ${longName ? "line-clamp-2" : "line-clamp-1"}`}>
            {data.layerName}
          </div>
          {data.searchMatchCount != null && data.searchMatchCount > 0 && (
            <span className="shrink-0 text-[10px] font-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded">
              {data.searchMatchCount}
            </span>
          )}
        </div>
        {data.layerDescription && (
          <div className={`text-[11px] text-text-secondary leading-snug mt-1 ${longName ? "line-clamp-1" : "line-clamp-2"}`}>
            {data.layerDescription}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between">
          <span className="text-[11px] text-text-muted">
            {formatMessage(data.membersAreFiles ? t.layerOverview.files : t.layerOverview.nodes, {
              count: data.fileCount,
            })}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onDrillIn(data.layerId);
            }}
            className="nodrag text-[11px] text-text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            aria-label={t.layerOverview.openLayer}
            title={t.layerOverview.openLayer}
          >
            {t.layerOverview.openLayer} →
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className={hiddenHandle} isConnectable={false} />
    </div>
  );
}

export default memo(LayerClusterNode);
