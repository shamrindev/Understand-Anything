import { describe, expect, it } from "vitest";
import { computeTierLayout, feedbackOrder } from "../tierLayout";
import type { TierEdge, TierNode } from "../tierLayout";

const node = (id: string): TierNode => ({ id, width: 200, height: 100 });
const edge = (source: string, target: string, weight = 1): TierEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  weight,
});

/** Segments of every route as [x1, y1, x2, y2], straight-line approximation. */
function segmentsOf(layout: ReturnType<typeof computeTierLayout>) {
  return [...layout.routes.entries()].flatMap(([id, r]) =>
    r.points.slice(1).map((p, i) => ({ id, a: r.points[i], b: p })),
  );
}

function boxesOverlap(layout: ReturnType<typeof computeTierLayout>, nodes: TierNode[]) {
  const boxes = nodes.map((n) => ({ ...layout.positions.get(n.id)!, w: n.width, h: n.height }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  }
  return false;
}

describe("feedbackOrder", () => {
  it("keeps the stronger direction of a two-node cycle", () => {
    const order = feedbackOrder(["a", "b"], [edge("a", "b", 18), edge("b", "a", 13)]);
    expect(order).toEqual(["a", "b"]);
  });

  it("breaks cycles by weight on graphs too large for the exact search", () => {
    // A 16-node ring closed by one weak link, plus a chord n12 → n2 whose
    // cycle runs through the same weak link: reversing it alone is optimal.
    const ids = Array.from({ length: 16 }, (_, i) => `n${i}`);
    const edges = ids.map((id, i) => edge(id, ids[(i + 1) % ids.length], i === 9 ? 1 : 10));
    edges.push(edge("n12", "n2", 4));
    const order = feedbackOrder([...ids].reverse(), edges);
    const pos = new Map(order.map((id, i) => [id, i]));
    const reversed = edges.filter((e) => pos.get(e.source)! > pos.get(e.target)!);
    expect(reversed.map((e) => e.id)).toEqual(["n9->n10"]);
  });

  it("reverses the weakest edge of a longer cycle", () => {
    const edges = [edge("orch", "scoring", 10), edge("scoring", "ingest", 10), edge("ingest", "orch", 5)];
    const order = feedbackOrder(["ingest", "scoring", "orch"], edges);
    expect(order).toEqual(["orch", "scoring", "ingest"]);
  });
});

describe("computeTierLayout", () => {
  it("places users above the layers they use", () => {
    const nodes = ["app", "service", "db"].map(node);
    const layout = computeTierLayout(nodes, [edge("app", "service"), edge("service", "db")]);
    expect(layout.ranks.get("app")).toBe(0);
    expect(layout.ranks.get("service")).toBe(1);
    expect(layout.ranks.get("db")).toBe(2);
    expect(layout.positions.get("app")!.y).toBeLessThan(layout.positions.get("service")!.y);
  });

  it("marks cycle-closing edges as reversed and routes them upward", () => {
    const nodes = ["core", "ops"].map(node);
    const layout = computeTierLayout(nodes, [edge("core", "ops", 18), edge("ops", "core", 13)]);
    const forward = layout.routes.get("core->ops")!;
    const back = layout.routes.get("ops->core")!;
    expect(forward.reversed).toBe(false);
    expect(back.reversed).toBe(true);
    // Back edge starts at the lower node and ends at the upper one.
    expect(back.points[0].y).toBeGreaterThan(back.points[back.points.length - 1].y);
    // The two directions use different ports, so they never overlap.
    expect(back.points[0].x).not.toBe(forward.points[forward.points.length - 1].x);
  });

  it("settles a mutual pair by strength even when another choice breaks more cycles", () => {
    // Reversing orch→scoring alone (10) would break both cycles, but reads as
    // "orchestration sits under scoring". The weaker side of each pair goes instead.
    const nodes = ["orch", "scoring", "ingest"].map(node);
    const layout = computeTierLayout(nodes, [
      edge("orch", "scoring", 10),
      edge("scoring", "orch", 6),
      edge("scoring", "ingest", 10),
      edge("ingest", "orch", 5),
    ]);
    expect(layout.ranks.get("orch")).toBeLessThan(layout.ranks.get("scoring")!);
    expect(layout.routes.get("scoring->orch")!.reversed).toBe(true);
    expect(layout.routes.get("ingest->orch")!.reversed).toBe(true);
    expect(layout.routes.get("orch->scoring")!.reversed).toBe(false);
  });

  it("pulls a pure source down to sit right above what it uses", () => {
    const nodes = ["entry", "mid", "core", "plugin"].map(node);
    const layout = computeTierLayout(nodes, [
      edge("entry", "mid"),
      edge("mid", "core"),
      edge("plugin", "core", 35),
    ]);
    expect(layout.ranks.get("core")).toBe(2);
    expect(layout.ranks.get("plugin")).toBe(1);
  });

  it("routes long edges through lanes between tiers, not through nodes", () => {
    const nodes = ["a", "b", "c", "d"].map(node);
    const layout = computeTierLayout(nodes, [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("a", "d")]);
    const route = layout.routes.get("a->d")!;
    // a→d spans three tiers: start, two waypoints per crossed tier, end.
    expect(route.points).toHaveLength(2 + 2 * 2);
    for (const id of ["b", "c"]) {
      const p = layout.positions.get(id)!;
      for (const pt of route.points) {
        const inside = pt.x > p.x && pt.x < p.x + 200 && pt.y > p.y && pt.y < p.y + 100;
        expect(inside).toBe(false);
      }
    }
  });

  it("produces a crossing-free layout for a graph that has one", () => {
    // Two independent stacks given in an interleaved order.
    const nodes = ["a1", "b1", "a2", "b2", "a3", "b3"].map(node);
    const edges = [edge("a1", "a2"), edge("a2", "a3"), edge("b1", "b2"), edge("b2", "b3"), edge("a1", "b3")];
    const layout = computeTierLayout(nodes, edges);
    const segs = segmentsOf(layout);
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i];
        const t = segs[j];
        if (s.id === t.id) continue;
        // Only compare segments spanning the same vertical band.
        if (s.a.y !== t.a.y || s.b.y !== t.b.y || s.a.y === s.b.y) continue;
        if ((s.a.x - t.a.x) * (s.b.x - t.b.x) < 0) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });

  it("never overlaps nodes, including unconnected ones", () => {
    const nodes = ["a", "b", "c", "lonely1", "lonely2"].map(node);
    const layout = computeTierLayout(nodes, [edge("a", "b"), edge("a", "c")]);
    expect(boxesOverlap(layout, nodes)).toBe(false);
    // Unconnected nodes never sit above connected ones: beside the last tier or below it.
    expect(layout.positions.get("lonely1")!.y).toBeGreaterThanOrEqual(layout.positions.get("b")!.y);
    expect(layout.positions.get("lonely2")!.y).toBeGreaterThanOrEqual(layout.positions.get("b")!.y);
  });

  it("moves unconnected nodes to their own row instead of widening a flat layout", () => {
    // One tier of five used layers: already wide, so the loners go below.
    const nodes = ["top", "a", "b", "c", "d", "e", "lonely1", "lonely2"].map(node);
    const edges = ["a", "b", "c", "d", "e"].map((t) => edge("top", t));
    const layout = computeTierLayout(nodes, edges);
    const usedTier = layout.ranks.get("a")!;
    expect(layout.ranks.get("lonely1")).toBe(usedTier + 1);
    const rights = ["a", "b", "c", "d", "e"].map((id) => layout.positions.get(id)!.x + 200);
    expect(layout.width).toBeLessThanOrEqual(Math.max(...rights) + 1);
  });

  it("keeps unconnected nodes beside the last tier of a tall layout", () => {
    const chain = ["a", "b", "c", "d", "e"];
    const nodes = [...chain, "lonely"].map(node);
    const edges = chain.slice(1).map((id, i) => edge(chain[i], id));
    const layout = computeTierLayout(nodes, edges);
    expect(layout.ranks.get("lonely")).toBe(layout.ranks.get("e"));
  });

  it("lays out a graph without edges as a grid", () => {
    const nodes = ["a", "b", "c", "d", "e"].map(node);
    const layout = computeTierLayout(nodes, []);
    expect(layout.routes.size).toBe(0);
    expect(boxesOverlap(layout, nodes)).toBe(false);
    expect(new Set([...layout.ranks.values()]).size).toBeGreaterThan(1);
  });

  it("ignores self-loops and edges to unknown nodes", () => {
    const nodes = ["a", "b"].map(node);
    const layout = computeTierLayout(nodes, [edge("a", "a"), edge("a", "ghost"), edge("a", "b")]);
    expect([...layout.routes.keys()]).toEqual(["a->b"]);
  });

  it("is deterministic", () => {
    const nodes = ["a", "b", "c", "d", "e"].map(node);
    const edges = [edge("a", "b", 3), edge("b", "c"), edge("c", "a", 2), edge("d", "c"), edge("e", "b")];
    const one = computeTierLayout(nodes, edges);
    const two = computeTierLayout(nodes, edges);
    expect([...two.positions.entries()]).toEqual([...one.positions.entries()]);
  });
});
