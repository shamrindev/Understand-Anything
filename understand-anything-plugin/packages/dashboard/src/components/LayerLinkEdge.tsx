import { memo } from "react";
import type { Edge, EdgeProps } from "@xyflow/react";
import type { Point } from "../utils/tierLayout";

export type LayerLinkState = "normal" | "active" | "dimmed";

export interface LayerLinkData extends Record<string, unknown> {
  /** Precomputed route from source to target (see computeTierLayout). */
  points: Point[];
  count: number;
  /** Line width in px, already scaled by strength. */
  width: number;
  /** Closes a cycle: drawn dashed and fainter. */
  reversed: boolean;
  state: LayerLinkState;
}

export type LayerLinkFlowEdge = Edge<LayerLinkData, "layer-link">;

/** Smooth path through the route: straight in lanes, S-curves between tiers. */
export function routeToPath(points: Point[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x) {
      d += ` L ${b.x} ${b.y}`;
    } else {
      const midY = (a.y + b.y) / 2;
      d += ` C ${a.x} ${midY} ${b.x} ${midY} ${b.x} ${b.y}`;
    }
  }
  return d;
}

const OPACITY: Record<LayerLinkState, number> = { normal: 0.5, active: 0.95, dimmed: 0.06 };

function LayerLinkEdge({ data }: EdgeProps<LayerLinkFlowEdge>) {
  if (!data || data.points.length < 2) return null;
  const { points, width, reversed, state, count } = data;
  const end = points[points.length - 1];
  const beforeEnd = points[points.length - 2];
  const dir = end.y >= beforeEnd.y ? 1 : -1;
  const head = 4 + width;
  const opacity = OPACITY[state] * (reversed && state === "normal" ? 0.75 : 1);
  const color = "var(--color-accent)";
  // The label sits on the middle of the route — in a lane for long links.
  const mid = points[Math.floor((points.length - 1) / 2)];
  const midNext = points[Math.floor((points.length - 1) / 2) + 1];
  const labelX = (mid.x + midNext.x) / 2;
  const labelY = (mid.y + midNext.y) / 2;

  return (
    <g style={{ pointerEvents: "none" }}>
      <path
        d={routeToPath(points.slice(0, -1).concat({ x: end.x, y: end.y - dir * head * 0.8 }))}
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={width}
        strokeDasharray={reversed ? `${width + 4} ${width + 3}` : undefined}
        strokeLinecap="round"
      />
      <path
        d={`M ${end.x} ${end.y} L ${end.x - head * 0.6} ${end.y - dir * head} L ${end.x + head * 0.6} ${end.y - dir * head} Z`}
        fill={color}
        fillOpacity={opacity}
      />
      {state === "active" && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <rect x={-14} y={-9} width={28} height={18} rx={9} fill="var(--color-elevated)" stroke={color} strokeOpacity={0.6} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill="var(--color-text-primary)">
            {count}
          </text>
        </g>
      )}
    </g>
  );
}

export default memo(LayerLinkEdge);
