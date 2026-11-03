/**
 * Deterministic tiered ("Sugiyama") layout for small dependency graphs such as
 * the layer overview. A node that uses another sits above it; edges that would
 * point upward (cycles) are flagged `reversed` so callers can draw them apart.
 *
 * Pipeline: cycle breaking (exact feedback-arc order for small graphs, greedy
 * + local sifting beyond that) →
 * longest-path ranks → dummy vertices for long edges → barycenter ordering
 * with adjacent swaps → isotonic x placement → port spreading and routes.
 * Pure and synchronous: overview graphs have tens of nodes, not thousands.
 */

export interface TierNode {
  id: string;
  width: number;
  height: number;
}

export interface TierEdge {
  id: string;
  /** The user (drawn above)… */
  source: string;
  /** …of this node (drawn below). */
  target: string;
  /** Strength; heavier edges win cycle breaking and pull harder on placement. */
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface TierEdgeRoute {
  /** From source to target, passing through the lanes between tiers. */
  points: Point[];
  /** True for edges going against the tier direction (they close a cycle). */
  reversed: boolean;
}

export interface TierLayout {
  /** Top-left corner of every node. */
  positions: Map<string, Point>;
  /** Tier index per node; nodes without edges get the rows after the last tier. */
  ranks: Map<string, number>;
  routes: Map<string, TierEdgeRoute>;
  width: number;
  height: number;
}

export interface TierLayoutOptions {
  rankGap?: number;
  nodeGap?: number;
  laneGap?: number;
}

const DUMMY_WIDTH = 12;
/** Widest width : height ratio unconnected nodes may stretch a layout to. */
const MAX_ASPECT = 1.6;
const MAX_SIFT_NODES = 60;

type Weighted = Map<string, Map<string, number>>;

function adjacency(ids: string[], edges: TierEdge[]): { out: Weighted; inc: Weighted } {
  const out: Weighted = new Map(ids.map((id) => [id, new Map()]));
  const inc: Weighted = new Map(ids.map((id) => [id, new Map()]));
  for (const e of edges) {
    out.get(e.source)!.set(e.target, (out.get(e.source)!.get(e.target) ?? 0) + e.weight);
    inc.get(e.target)!.set(e.source, (inc.get(e.target)!.get(e.source) ?? 0) + e.weight);
  }
  return { out, inc };
}

function backWeight(order: string[], edges: TierEdge[]): number {
  const pos = new Map(order.map((id, i) => [id, i]));
  let w = 0;
  for (const e of edges) if (pos.get(e.source)! > pos.get(e.target)!) w += e.weight;
  return w;
}

/** Weighted Eades–Lin–Smyth ordering: sinks to the end, sources to the front. */
function greedyOrder(ids: string[], edges: TierEdge[]): string[] {
  const { out, inc } = adjacency(ids, edges);
  const remaining = new Set(ids);
  const head: string[] = [];
  const tail: string[] = [];
  const weightWithin = (m: Map<string, number>) => {
    let w = 0;
    for (const [other, v] of m) if (remaining.has(other)) w += v;
    return w;
  };
  while (remaining.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of ids) {
        if (remaining.has(id) && weightWithin(out.get(id)!) === 0) {
          tail.unshift(id);
          remaining.delete(id);
          changed = true;
        }
      }
      for (const id of ids) {
        if (remaining.has(id) && weightWithin(inc.get(id)!) === 0) {
          head.push(id);
          remaining.delete(id);
          changed = true;
        }
      }
    }
    if (remaining.size === 0) break;
    let best = "";
    let bestDelta = -Infinity;
    for (const id of ids) {
      if (!remaining.has(id)) continue;
      const delta = weightWithin(out.get(id)!) - weightWithin(inc.get(id)!);
      if (delta > bestDelta) {
        best = id;
        bestDelta = delta;
      }
    }
    head.push(best);
    remaining.delete(best);
  }
  return [...head, ...tail];
}

/** Move single nodes to the slot that minimises reversed weight until stable. */
function siftOrder(order: string[], edges: TierEdge[]): string[] {
  if (order.length > MAX_SIFT_NODES) return order;
  let current = order;
  let best = backWeight(current, edges);
  for (let pass = 0; pass < 10 && best > 0; pass++) {
    let improved = false;
    for (const id of [...current]) {
      const without = current.filter((x) => x !== id);
      for (let i = 0; i <= without.length; i++) {
        const candidate = [...without.slice(0, i), id, ...without.slice(i)];
        const w = backWeight(candidate, edges);
        if (w < best) {
          best = w;
          current = candidate;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return current;
}

/**
 * Exact minimum-weight feedback order by dynamic programming over subsets:
 * best[S] is the cheapest way to place set S first. Fine up to ~14 nodes,
 * which covers almost every layer overview.
 */
function exactOrder(ids: string[], edges: TierEdge[]): string[] {
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  // w[v][u]: weight of v → u, which becomes a back edge when v is placed after u.
  const w = ids.map(() => new Array<number>(n).fill(0));
  for (const e of edges) w[index.get(e.source)!][index.get(e.target)!] += e.weight;
  const size = 1 << n;
  const best = new Float64Array(size).fill(Infinity);
  const last = new Int8Array(size).fill(-1);
  best[0] = 0;
  for (let set = 0; set < size; set++) {
    if (best[set] === Infinity) continue;
    for (let v = 0; v < n; v++) {
      if (set & (1 << v)) continue;
      let cost = best[set];
      for (let u = 0; u < n; u++) if (set & (1 << u)) cost += w[v][u];
      const next = set | (1 << v);
      if (cost < best[next]) {
        best[next] = cost;
        last[next] = v;
      }
    }
  }
  const order: string[] = [];
  for (let set = size - 1; set > 0; set &= ~(1 << last[set])) order.unshift(ids[last[set]]);
  return order;
}

const MAX_EXACT_NODES = 14;

/** Order nodes so that the total weight of edges pointing backwards is minimal. */
export function feedbackOrder(ids: string[], edges: TierEdge[]): string[] {
  if (ids.length <= MAX_EXACT_NODES) return exactOrder(ids, edges);
  return siftOrder(greedyOrder(ids, edges), edges);
}

interface Segment {
  index: number;
  upper: string;
  lower: string;
  weight: number;
}

function countCrossings(upperRow: string[], lowerRow: string[], segments: Segment[]): number {
  const up = new Map(upperRow.map((id, i) => [id, i]));
  const low = new Map(lowerRow.map((id, i) => [id, i]));
  const pairs = segments
    .filter((s) => up.has(s.upper) && low.has(s.lower))
    .map((s) => [up.get(s.upper)!, low.get(s.lower)!] as const);
  let crossings = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, b1] = pairs[i];
      const [a2, b2] = pairs[j];
      if ((a1 - a2) * (b1 - b2) < 0) crossings++;
    }
  }
  return crossings;
}

/** Isotonic regression (pool adjacent violators) of `targets` with weights. */
function isotonic(targets: number[], weights: number[]): number[] {
  const blocks: { w: number; sum: number; n: number }[] = [];
  targets.forEach((t, i) => {
    blocks.push({ w: weights[i], sum: weights[i] * t, n: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      if (prev.sum / prev.w <= last.sum / last.w) break;
      blocks.pop();
      prev.w += last.w;
      prev.sum += last.sum;
      prev.n += last.n;
    }
  });
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.w));
}

export function computeTierLayout(
  nodes: TierNode[],
  edges: TierEdge[],
  options: TierLayoutOptions = {},
): TierLayout {
  const rankGap = options.rankGap ?? 72;
  const nodeGap = options.nodeGap ?? 48;
  const laneGap = options.laneGap ?? 18;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const validEdges = edges.filter(
    (e) => e.source !== e.target && nodeById.has(e.source) && nodeById.has(e.target),
  );
  const linked = new Set(validEdges.flatMap((e) => [e.source, e.target]));
  const connectedIds = nodes.map((n) => n.id).filter((id) => linked.has(id));
  const isolatedIds = nodes.map((n) => n.id).filter((id) => !linked.has(id));

  // 1. Cycle breaking. A mutual pair is settled locally (the weaker direction
  // is the back edge) — that reads naturally even when reversing one strong
  // edge would break more cycles at once. The rest goes to the global order.
  const byPair = new Map(validEdges.map((e) => [`${e.source}\u0000${e.target}`, e]));
  const weakerOfPair = (e: TierEdge) => {
    const opposite = byPair.get(`${e.target}\u0000${e.source}`);
    return !!opposite && (e.weight < opposite.weight || (e.weight === opposite.weight && e.id > opposite.id));
  };
  const order = feedbackOrder(connectedIds, validEdges.filter((e) => !weakerOfPair(e)));
  const orderPos = new Map(order.map((id, i) => [id, i]));
  const dagEdges = validEdges.map((e) => {
    const reversed = orderPos.get(e.source)! > orderPos.get(e.target)!;
    return {
      edge: e,
      reversed,
      top: reversed ? e.target : e.source,
      bottom: reversed ? e.source : e.target,
    };
  });

  // 2. Ranks: longest path from the top, then pull pure sources down so they
  // sit right above the highest node they use.
  const ranks = new Map<string, number>();
  const below = new Map<string, string[]>(order.map((id) => [id, []]));
  const above = new Map<string, string[]>(order.map((id) => [id, []]));
  for (const d of dagEdges) {
    below.get(d.top)!.push(d.bottom);
    above.get(d.bottom)!.push(d.top);
  }
  for (const id of order) {
    const parents = above.get(id)!;
    ranks.set(id, parents.length === 0 ? 0 : Math.max(...parents.map((p) => ranks.get(p)! + 1)));
  }
  for (const id of [...order].reverse()) {
    if (above.get(id)!.length > 0) continue;
    const children = below.get(id)!;
    if (children.length > 0) ranks.set(id, Math.min(...children.map((c) => ranks.get(c)!)) - 1);
  }
  const minRank = Math.min(0, ...ranks.values());
  for (const [id, r] of ranks) ranks.set(id, r - minRank);
  const tierCount = connectedIds.length > 0 ? Math.max(...ranks.values()) + 1 : 0;

  // 3. Dummy vertices so long edges get their own lane through every tier.
  const rows: string[][] = Array.from({ length: tierCount }, () => []);
  for (const id of order) rows[ranks.get(id)!].push(id);
  const dummyRank = new Map<string, number>();
  const chains = new Map<string, { vertices: string[]; segments: Segment[] }>();
  const segments: Segment[] = [];
  for (const d of dagEdges) {
    const chain = [d.top];
    for (let r = ranks.get(d.top)! + 1; r < ranks.get(d.bottom)!; r++) {
      const dummy = `${d.edge.id}\u0000${r}`;
      dummyRank.set(dummy, r);
      rows[r].push(dummy);
      chain.push(dummy);
    }
    chain.push(d.bottom);
    const weight = 1 + Math.log2(Math.max(1, d.edge.weight));
    const own: Segment[] = [];
    for (let i = 0; i < chain.length - 1; i++) {
      own.push({ index: segments.length + i, upper: chain[i], lower: chain[i + 1], weight });
    }
    segments.push(...own);
    chains.set(d.edge.id, { vertices: chain, segments: own });
  }
  const isDummy = (id: string) => dummyRank.has(id);
  const rankOf = (id: string) => dummyRank.get(id) ?? ranks.get(id)!;
  const ups = new Map<string, Segment[]>();
  const downs = new Map<string, Segment[]>();
  for (const s of segments) {
    if (!downs.has(s.upper)) downs.set(s.upper, []);
    if (!ups.has(s.lower)) ups.set(s.lower, []);
    downs.get(s.upper)!.push(s);
    ups.get(s.lower)!.push(s);
  }

  // 4. Ordering inside tiers: barycenter sweeps, keep the best, then swaps.
  const totalCrossings = (rs: string[][]) =>
    rs.slice(0, -1).reduce((sum, row, r) => sum + countCrossings(row, rs[r + 1], segments), 0);
  const reorder = (row: string[], ref: string[], neighbours: (id: string) => string[]) => {
    const refPos = new Map(ref.map((id, i) => [id, i]));
    const keyed = row.map((id, i) => {
      const ps = neighbours(id).map((n) => refPos.get(n)).filter((p): p is number => p !== undefined);
      const bary = ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : (i / Math.max(1, row.length - 1)) * (ref.length - 1);
      return { id, bary, i };
    });
    keyed.sort((a, b) => a.bary - b.bary || a.i - b.i);
    return keyed.map((k) => k.id);
  };
  let best = rows.map((r) => [...r]);
  let bestCrossings = totalCrossings(best);
  const current = rows.map((r) => [...r]);
  for (let iter = 0; iter < 24 && bestCrossings > 0; iter++) {
    if (iter % 2 === 0) {
      for (let r = 1; r < current.length; r++) {
        current[r] = reorder(current[r], current[r - 1], (id) => (ups.get(id) ?? []).map((s) => s.upper));
      }
    } else {
      for (let r = current.length - 2; r >= 0; r--) {
        current[r] = reorder(current[r], current[r + 1], (id) => (downs.get(id) ?? []).map((s) => s.lower));
      }
    }
    const c = totalCrossings(current);
    if (c < bestCrossings) {
      bestCrossings = c;
      best = current.map((r) => [...r]);
    }
  }
  let swapped = bestCrossings > 0;
  for (let guard = 0; swapped && guard < 20; guard++) {
    swapped = false;
    for (let r = 0; r < best.length; r++) {
      for (let i = 0; i < best[r].length - 1; i++) {
        const local = () =>
          (r > 0 ? countCrossings(best[r - 1], best[r], segments) : 0) +
          (r < best.length - 1 ? countCrossings(best[r], best[r + 1], segments) : 0);
        const before = local();
        [best[r][i], best[r][i + 1]] = [best[r][i + 1], best[r][i]];
        if (local() < before) swapped = true;
        else [best[r][i], best[r][i + 1]] = [best[r][i + 1], best[r][i]];
      }
    }
  }

  // 5. Horizontal placement: pull every vertex towards its neighbours while
  // keeping order and minimum gaps (an exact isotonic fit per tier).
  const widthOf = (id: string) => (isDummy(id) ? DUMMY_WIDTH : nodeById.get(id)!.width);
  const minGap = (a: string, b: string) =>
    widthOf(a) / 2 + widthOf(b) / 2 + (isDummy(a) || isDummy(b) ? laneGap : nodeGap);
  const x = new Map<string, number>();
  /** Pack a tier left to right at minimum gaps, centred on 0. */
  const packRow = (row: string[]) => {
    let cursor = 0;
    row.forEach((id, i) => {
      if (i > 0) cursor += minGap(row[i - 1], id);
      x.set(id, cursor);
    });
    for (const id of row) x.set(id, x.get(id)! - cursor / 2);
  };
  /**
   * Move a tier towards the weighted mean of each vertex's neighbours (the
   * other ends of `pull(id)`), lanes pulling twice as hard to stay straight.
   */
  const place = (row: string[], pull: (id: string) => Segment[]) => {
    if (row.length === 0) return;
    const desired: number[] = [];
    const weights: number[] = [];
    for (const id of row) {
      let sum = 0;
      let w = 0;
      for (const seg of pull(id)) {
        const other = seg.upper === id ? seg.lower : seg.upper;
        const sw = seg.weight * (isDummy(other) || isDummy(id) ? 2 : 1);
        sum += x.get(other)! * sw;
        w += sw;
      }
      desired.push(w > 0 ? sum / w : x.get(id)!);
      weights.push(w > 0 ? w : 0.1);
    }
    const offsets = [0];
    for (let i = 1; i < row.length; i++) offsets.push(offsets[i - 1] + minGap(row[i - 1], row[i]));
    const fitted = isotonic(desired.map((d, i) => d - offsets[i]), weights);
    row.forEach((id, i) => x.set(id, fitted[i] + offsets[i]));
  };
  best.forEach(packRow);
  const upper = (id: string) => ups.get(id) ?? [];
  const lower = (id: string) => downs.get(id) ?? [];
  for (let iter = 0; iter < 8; iter++) {
    for (let r = 1; r < best.length; r++) place(best[r], upper);
    for (let r = best.length - 2; r >= 0; r--) place(best[r], lower);
  }
  // Final balancing pass against both neighbouring tiers.
  for (const row of best) place(row, (id) => [...upper(id), ...lower(id)]);

  // 6. Unconnected nodes: beside the last tier while the layout stays within
  // a canvas-like aspect ratio (a wide, flat layout fits the screen at a tiny
  // zoom), then as a grid of extra rows centred under the tiers.
  const realCount = (row: string[]) => row.filter((id) => !isDummy(id)).length;
  const widestTier = best.reduce((m, row) => Math.max(m, realCount(row)), 0);
  const columns = Math.max(
    widestTier,
    connectedIds.length === 0 ? Math.ceil(Math.sqrt(isolatedIds.length * 1.5)) : 3,
    1,
  );
  let tiersLeft = Infinity;
  let tiersRight = -Infinity;
  for (const row of best) {
    for (const id of row) {
      tiersLeft = Math.min(tiersLeft, x.get(id)! - widthOf(id) / 2);
      tiersRight = Math.max(tiersRight, x.get(id)! + widthOf(id) / 2);
    }
  }
  const tiersHeight = best.reduce(
    (h, row) => h + rankGap + row.reduce((m, id) => (isDummy(id) ? m : Math.max(m, nodeById.get(id)!.height)), 0),
    0,
  );
  const maxRight = tiersLeft + Math.max(tiersRight - tiersLeft, tiersHeight * MAX_ASPECT);
  const lastTier = best[best.length - 1];
  let besideLast = 0;
  while (lastTier && besideLast < isolatedIds.length) {
    const id = isolatedIds[besideLast];
    const prev = lastTier[lastTier.length - 1];
    const cx = x.get(prev)! + minGap(prev, id);
    if (cx + widthOf(id) / 2 > maxRight || realCount(lastTier) >= columns) break;
    x.set(id, cx);
    lastTier.push(id);
    ranks.set(id, tierCount - 1);
    besideLast++;
  }
  const rest = isolatedIds.slice(besideLast);
  const isolatedRows: string[][] = [];
  for (let i = 0; i < rest.length; i += columns) isolatedRows.push(rest.slice(i, i + columns));
  const centre = Number.isFinite(tiersLeft) ? (tiersLeft + tiersRight) / 2 : 0;
  for (const row of isolatedRows) {
    packRow(row);
    for (const id of row) x.set(id, x.get(id)! + centre);
  }
  isolatedRows.forEach((row, i) => row.forEach((id) => ranks.set(id, tierCount + i)));
  const allRows = [...best, ...isolatedRows];

  // 7. Normalise to a (0, 0) origin and compute tier tops.
  let minX = Infinity;
  let maxX = -Infinity;
  for (const row of allRows) {
    for (const id of row) {
      minX = Math.min(minX, x.get(id)! - widthOf(id) / 2);
      maxX = Math.max(maxX, x.get(id)! + widthOf(id) / 2);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }
  const rowHeights = allRows.map((row) =>
    row.reduce((m, id) => (isDummy(id) ? m : Math.max(m, nodeById.get(id)!.height)), 0),
  );
  const rowTop: number[] = [];
  let y = 0;
  rowHeights.forEach((h) => {
    rowTop.push(y);
    y += h + rankGap;
  });
  const height = Math.max(0, y - rankGap);
  const cx = (id: string) => x.get(id)! - minX;

  const positions = new Map<string, Point>();
  for (const node of nodes) {
    positions.set(node.id, { x: cx(node.id) - node.width / 2, y: rowTop[ranks.get(node.id)!] });
  }

  // 8. Ports: spread the edges leaving/entering a node along its side, ordered
  // by where they head, so parallel links never share a pixel.
  const portX = new Map<string, number>();
  const spread = (id: string, segs: Segment[], next: (s: Segment) => string, side: "top" | "bottom") => {
    const sorted = [...segs].sort((a, b) => cx(next(a)) - cx(next(b)) || a.index - b.index);
    const width = nodeById.get(id)!.width;
    const step = sorted.length > 1 ? Math.min(22, (width * 0.6) / (sorted.length - 1)) : 0;
    sorted.forEach((s, i) => {
      portX.set(`${side}:${s.index}`, cx(id) + (i - (sorted.length - 1) / 2) * step);
    });
  };
  for (const id of connectedIds) {
    spread(id, downs.get(id) ?? [], (s) => s.lower, "bottom");
    spread(id, ups.get(id) ?? [], (s) => s.upper, "top");
  }
  const portFor = (side: "top" | "bottom", s: Segment) => portX.get(`${side}:${s.index}`)!;

  const routes = new Map<string, TierEdgeRoute>();
  for (const d of dagEdges) {
    const { vertices: chain, segments: chainSegments } = chains.get(d.edge.id)!;
    const points: Point[] = [];
    const top = chain[0];
    points.push({ x: portFor("bottom", chainSegments[0]), y: rowTop[rankOf(top)] + nodeById.get(top)!.height });
    for (const dummy of chain.slice(1, -1)) {
      const r = rankOf(dummy);
      points.push({ x: cx(dummy), y: rowTop[r] });
      points.push({ x: cx(dummy), y: rowTop[r] + rowHeights[r] });
    }
    const bottom = chain[chain.length - 1];
    points.push({ x: portFor("top", chainSegments[chainSegments.length - 1]), y: rowTop[rankOf(bottom)] });
    routes.set(d.edge.id, { points: d.reversed ? points.reverse() : points, reversed: d.reversed });
  }

  return { positions, ranks, routes, width: maxX - minX, height };
}
