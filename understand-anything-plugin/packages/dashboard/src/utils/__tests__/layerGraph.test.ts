import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph, Layer } from "@understand-anything/core/types";
import {
  DEPENDENCY_EDGE_TYPES,
  aggregateLayerLinks,
  collectDependencies,
  crossLayerEdgeTypes,
  defaultMinStrength,
  defaultOverviewEdgeTypes,
  deriveFallbackLayers,
  findFoundationLayers,
  isDerivedLayer,
  withContainedNodes,
} from "../layerGraph";
import type { LayerLink } from "../layerGraph";

const node = (id: string, type: GraphNode["type"] = "file", filePath?: string): GraphNode => ({
  id,
  type,
  name: id,
  filePath,
  summary: "",
  tags: [],
  complexity: "simple",
});

const edge = (source: string, target: string, type: GraphEdge["type"] = "imports"): GraphEdge => ({
  source,
  target,
  type,
  direction: "forward",
  weight: 1,
});

const layer = (id: string, nodeIds: string[]): Layer => ({ id, name: id, description: "", nodeIds });

function graphOf(nodes: GraphNode[], edges: GraphEdge[], layers: Layer[]): KnowledgeGraph {
  return {
    version: "1",
    project: { name: "t", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes,
    edges,
    layers,
    tour: [],
  };
}

/** api/handler.ts → core/service.ts, with function-level calls inside. */
function sampleGraph(): KnowledgeGraph {
  return graphOf(
    [
      node("api"),
      node("api.fn", "function"),
      node("core"),
      node("core.fn", "function"),
      node("core.cls", "class"),
      node("core.cls.m", "function"),
      node("doc", "document"),
      node("test"),
    ],
    [
      edge("api", "api.fn", "contains"),
      edge("core", "core.fn", "contains"),
      edge("core", "core.cls", "contains"),
      edge("core.cls", "core.cls.m", "contains"),
      edge("api", "core", "imports"),
      edge("api.fn", "core.fn", "calls"),
      edge("api.fn", "core.cls.m", "calls"),
      edge("doc", "core", "documents"),
      edge("core", "test", "tested_by"),
    ],
    [layer("L-api", ["api"]), layer("L-core", ["core"]), layer("L-docs", ["doc"]), layer("L-test", ["test"])],
  );
}

const link = (source: string, target: string, count: number): LayerLink => ({
  source,
  target,
  count,
  byType: { imports: count },
});

describe("aggregateLayerLinks", () => {
  it("lifts function-level edges to the layer of their file", () => {
    const links = aggregateLayerLinks(sampleGraph(), DEPENDENCY_EDGE_TYPES);
    expect(links).toEqual([{ source: "L-api", target: "L-core", count: 3, byType: { imports: 1, calls: 2 } }]);
  });

  it("only counts the requested edge types", () => {
    const links = aggregateLayerLinks(sampleGraph(), new Set(["documents"]));
    expect(links).toEqual([{ source: "L-docs", target: "L-core", count: 1, byType: { documents: 1 } }]);
  });

  it("points tested_by from the test to the code it tests", () => {
    const links = aggregateLayerLinks(sampleGraph(), new Set(["tested_by"]));
    expect(links.map((l) => [l.source, l.target])).toEqual([["L-test", "L-core"]]);
  });

  it("keeps the two directions of a pair apart", () => {
    const g = graphOf(
      [node("a"), node("b")],
      [edge("a", "b"), edge("a", "b"), edge("b", "a")],
      [layer("A", ["a"]), layer("B", ["b"])],
    );
    const links = aggregateLayerLinks(g, DEPENDENCY_EDGE_TYPES);
    expect(links.map((l) => [l.source, l.target, l.count])).toEqual([
      ["A", "B", 2],
      ["B", "A", 1],
    ]);
  });
});

describe("edge type defaults", () => {
  it("lists crossing types with dependency types first", () => {
    const types = crossLayerEdgeTypes(sampleGraph());
    expect(types.map((t) => t.type)).toEqual(["calls", "imports", "documents", "tested_by"]);
    expect(types.find((t) => t.type === "documents")?.isDependency).toBe(false);
  });

  it("starts with the dependency types only", () => {
    expect([...defaultOverviewEdgeTypes(crossLayerEdgeTypes(sampleGraph()))].sort()).toEqual(["calls", "imports"]);
  });

  it("falls back to every type when the graph has no dependency edges", () => {
    const g = graphOf([node("a"), node("b")], [edge("a", "b", "related")], [layer("A", ["a"]), layer("B", ["b"])]);
    expect([...defaultOverviewEdgeTypes(crossLayerEdgeTypes(g))]).toEqual(["related"]);
  });
});

describe("defaultMinStrength", () => {
  it("hides links below ~15% of the strongest, capped at 5", () => {
    expect(defaultMinStrength([link("a", "b", 35)])).toBe(5);
    expect(defaultMinStrength([link("a", "b", 200)])).toBe(5);
    expect(defaultMinStrength([link("a", "b", 20)])).toBe(3);
  });

  it("keeps every link of a small graph", () => {
    expect(defaultMinStrength([link("a", "b", 4), link("b", "c", 1)])).toBe(1);
    expect(defaultMinStrength([])).toBe(1);
  });
});

describe("findFoundationLayers", () => {
  const ids = ["app", "jobs", "scoring", "notify", "shared"];

  it("finds a hub most layers use and that uses little itself", () => {
    const links = [
      link("app", "jobs", 10),
      link("jobs", "scoring", 8),
      link("app", "shared", 9),
      link("jobs", "shared", 7),
      link("scoring", "shared", 12),
      link("notify", "shared", 6),
      link("shared", "jobs", 1),
    ];
    expect(findFoundationLayers(ids, links, 5)).toEqual(["shared"]);
  });

  it("ignores a central layer that also depends on a lot", () => {
    const links = [
      link("app", "jobs", 10),
      link("scoring", "jobs", 8),
      link("notify", "jobs", 9),
      link("jobs", "shared", 12),
      link("jobs", "notify", 10),
    ];
    expect(findFoundationLayers(ids, links, 5)).toEqual([]);
  });

  it("does not count links below the threshold as dependents", () => {
    const links = ["app", "jobs", "scoring", "notify"].map((id) => link(id, "shared", 2));
    expect(findFoundationLayers(ids, links, 5)).toEqual([]);
    expect(findFoundationLayers(ids, links, 2)).toEqual(["shared"]);
  });

  it("never applies to tiny graphs", () => {
    expect(findFoundationLayers(["a", "b", "c"], [link("a", "c", 9), link("b", "c", 9)], 1)).toEqual([]);
  });
});

describe("collectDependencies", () => {
  it("groups what a file uses and is used by per layer, at file level", () => {
    const g = sampleGraph();
    const deps = collectDependencies(g, withContainedNodes(g, ["core"]), new Set(["imports", "calls", "tested_by"]));
    expect(deps.uses).toEqual([]);
    expect(deps.usedBy).toEqual([
      { layerId: "L-api", count: 3, items: [{ nodeId: "api", count: 3 }] },
      { layerId: "L-test", count: 1, items: [{ nodeId: "test", count: 1 }] },
    ]);
  });

  it("puts nodes outside every layer into their own group", () => {
    const g = graphOf([node("a"), node("loose")], [edge("a", "loose")], [layer("A", ["a"])]);
    const deps = collectDependencies(g, new Set(["a"]), DEPENDENCY_EDGE_TYPES);
    expect(deps.uses).toEqual([{ layerId: null, count: 1, items: [{ nodeId: "loose", count: 1 }] }]);
  });
});

describe("deriveFallbackLayers", () => {
  it("groups top-level nodes by folder below the shared prefix", () => {
    const g = graphOf(
      [
        node("a", "file", "src/api/a.ts"),
        node("b", "file", "src/api/b.ts"),
        node("c", "file", "src/core/c.ts"),
        node("m", "file", "src/main.ts"),
        node("fn", "function", "src/api/a.ts"),
      ],
      [edge("a", "fn", "contains")],
      [],
    );
    const layers = deriveFallbackLayers(g);
    expect(layers.map((l) => [l.name, l.nodeIds])).toEqual([
      ["src/api/", ["a", "b"]],
      ["src/core/", ["c"]],
      ["src/", ["m"]],
    ]);
  });

  it("marks its layers as derived so exports can leave them out", () => {
    const g = graphOf([node("a", "file", "src/a.ts")], [], []);
    expect(deriveFallbackLayers(g).every(isDerivedLayer)).toBe(true);
    expect(isDerivedLayer(layer("layer:api", []))).toBe(false);
  });

  it("groups path-less nodes by type", () => {
    const g = graphOf([node("d1", "domain"), node("d2", "domain"), node("f1", "flow")], [], []);
    expect(deriveFallbackLayers(g).map((l) => [l.name, l.nodeIds.length])).toEqual([
      ["domain", 2],
      ["flow", 1],
    ]);
  });

  it("caps the number of groups", () => {
    const nodes = Array.from({ length: 30 }, (_, i) => node(`n${i}`, "file", `pkg${i}/x.ts`));
    const layers = deriveFallbackLayers(graphOf(nodes, [], []));
    expect(layers).toHaveLength(12);
    expect(layers.reduce((sum, l) => sum + l.nodeIds.length, 0)).toBe(30);
  });
});
