// ---------------------------------------------------------------------------
// flowNodePaths — compiled flow node id → spec path.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import { load } from "js-yaml";
import { validate } from "@chaincraft/gamedef/validator";
import type { ModularGameSpec } from "@chaincraft/gamedef";
import type { FlowNode } from "@chaincraft/runtime";
import { assembleFlow, findUnsupported, flowNodePaths } from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(__dirname, "../../../../gamedef/examples/");

function loadExample(filename: string): ModularGameSpec {
  const result = validate(load(readFileSync(join(EXAMPLES, filename), "utf-8")));
  if (!result.valid) throw new Error(`${filename} failed validation: ${JSON.stringify(result.errors, null, 2)}`);
  return result.spec;
}

function compiledNodeIds(node: FlowNode, out: string[] = []): string[] {
  out.push(node.id);
  const children = (node as { children?: FlowNode[] }).children;
  if (children) for (const child of children) compiledNodeIds(child, out);
  return out;
}

/** Follows a path like `flow.root.children[0].children[1]` through the spec. */
function resolvePath(spec: ModularGameSpec, path: string): unknown {
  let cur: unknown = spec;
  for (const part of path.split(".")) {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(part);
    if (!m) throw new Error(`bad path segment '${part}'`);
    cur = (cur as Record<string, unknown>)[m[1]];
    if (m[2] !== undefined) cur = (cur as unknown[])[Number(m[2])];
  }
  return cur;
}

const ASSEMBLABLE = readdirSync(EXAMPLES)
  .filter((f) => f.endsWith(".yaml"))
  .filter((f) => {
    const result = validate(load(readFileSync(join(EXAMPLES, f), "utf-8")));
    return result.valid && !!result.spec.flow && findUnsupported(result.spec).length === 0;
  });

describe("flowNodePaths", () => {
  it("covers the core examples", () => {
    expect(ASSEMBLABLE).toEqual(expect.arrayContaining(["high-card.yaml", "liars-dice.yaml"]));
  });

  it.each(ASSEMBLABLE)("%s: every compiled node id has a path that resolves in the spec", (file) => {
    const spec = loadExample(file);
    const specId = file.replace(/\.yaml$/, "");
    const ids = compiledNodeIds(assembleFlow(spec, specId, {}));
    const paths = flowNodePaths(spec, specId);

    expect(Object.keys(paths).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const node = resolvePath(spec, paths[id]) as { id?: string; kind: string } | undefined;
      expect(node).toBeDefined();
      if (paths[id] !== "flow.root") expect(node!.id === undefined || node!.id === id).toBe(true);
    }
  });

  it("maps the root to flow.root", () => {
    expect(flowNodePaths(loadExample("high-card.yaml"), "high-card")["high-card"]).toBe("flow.root");
  });

  it("matches synthesized ids for nodes without an explicit id", () => {
    const spec = loadExample("high-card.yaml");
    const loop = (spec.flow!.root as unknown as { children: { id?: string; children: { id?: string }[] }[] }).children[0];
    delete loop.id;
    delete loop.children[0].id;

    const ids = compiledNodeIds(assembleFlow(spec, "high-card", {}));
    const paths = flowNodePaths(spec, "high-card");

    expect(Object.keys(paths).sort()).toEqual([...ids].sort());
    expect(paths["loop-1"]).toBe("flow.root.children[0]");
    expect(paths["turn-1"]).toBe("flow.root.children[0].children[0]");
  });

  it("returns an empty map when the spec has no flow", () => {
    const spec = loadExample("high-card.yaml");
    delete (spec as { flow?: unknown }).flow;
    expect(flowNodePaths(spec, "high-card")).toEqual({});
  });
});
