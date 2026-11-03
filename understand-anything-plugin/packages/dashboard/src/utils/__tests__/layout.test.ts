import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { carryOverMeasurements } from "../layout";

const node = (id: string, extra: Partial<Node> = {}): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
  ...extra,
});

describe("carryOverMeasurements", () => {
  it("keeps React Flow's measured size on rebuilt nodes", () => {
    // Without `measured`, React Flow drops the node's handle bounds and the
    // edges attached to it silently disappear until it is re-measured.
    const onScreen = [node("a", { measured: { width: 280, height: 104 } })];
    const rebuilt = [node("a", { data: { emphasis: "active" } })];
    const [next] = carryOverMeasurements(onScreen, rebuilt);
    expect(next.measured).toEqual({ width: 280, height: 104 });
    expect(next.data).toEqual({ emphasis: "active" });
  });

  it("leaves new nodes and nodes that bring their own measurement alone", () => {
    const onScreen = [node("a", { measured: { width: 1, height: 1 } })];
    const own = node("a", { measured: { width: 300, height: 120 } });
    const fresh = node("b");
    const next = carryOverMeasurements(onScreen, [own, fresh]);
    expect(next[0]).toBe(own);
    expect(next[1]).toBe(fresh);
  });

  it("returns the rebuilt list when nothing was on screen yet", () => {
    const rebuilt = [node("a"), node("b")];
    expect(carryOverMeasurements([], rebuilt)).toEqual(rebuilt);
  });
});
