/**
 * Generate Mechanics — Self-contained subgraph
 *
 * Reusable subgraph for generating/editing mechanic code with Fan-out:
 *
 * Callers provide:
 *   - targets: MechanicTarget[] (what to generate)
 *   - stateInterfaces: string (TypeScript interfaces for tsc validation)
 *   - existingCode?: Record<string, string> (for repair/edit paths)
 *
 * Internal flow:
 *   START → conditional edge (fanOut) → generate_and_validate_mechanic (×N) → END
 *
 * Outputs:
 *   - generatedMechanics: Record<string, string> (merged across workers)
 *   - mechanicsErrors: MechanicError[] (accumulated across workers)
 *
 * Three callers, one graph:
 *   1. Spec-processing pipeline — first-time generation from instructions
 *   2. Artifact editor — repair broken mechanics from tsc/runtime errors
 *   3. Sim assistant (future) — fix mechanics from runtime failures
 *
 * See: GENERATED_MECHANICS_DESIGN.md §6, §7
 */

import { StateGraph, START, END, Send } from "@langchain/langgraph";
import { setupSpecInstructionsModel } from "#chaincraft/ai/model-config.js";
import type { ModelWithOptions } from "#chaincraft/ai/model-config.js";
import {
  MechanicsGraphState,
  type MechanicsGraphStateType,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/mechanics-graph-state.js";
import { generateAndValidateMechanic } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/mechanic-generator.js";
import type { MechanicTarget, MechanicError } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/schema.js";

// ---------------------------------------------------------------------------
// Re-export for callers that need to build targets
// ---------------------------------------------------------------------------

export { buildMechanicTargets } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/target-builder.js";
export { MechanicsGraphState, type MechanicsGraphStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/mechanics-graph-state.js";

// ---------------------------------------------------------------------------
// Fan-out routing (subgraph-internal)
// ---------------------------------------------------------------------------

/**
 * Internal routing function — emits Send per target for parallel generation.
 * Returns END if no targets (shouldn't happen — caller should check first).
 */
function fanOutTargets(state: MechanicsGraphStateType): Send[] | typeof END {
  const { targets, stateInterfaces } = state;

  if (!targets || targets.length === 0) {
    console.warn("[mechanics_graph] No targets provided, ending");
    return END;
  }

  console.debug(
    `[mechanics_graph] Fan-out: ${targets.length} target(s): ${targets.map((t) => t.id).join(", ")}`,
  );

  return targets.map(
    (target) =>
      new Send("generate_and_validate_mechanic", {
        ...state,
        currentTarget: target,
        // Reset per-invocation merge fields so reducers start clean
        generatedMechanics: {},
        mechanicsErrors: [],
      }),
  );
}

// ---------------------------------------------------------------------------
// Worker node
// ---------------------------------------------------------------------------

// Lazy-init model (Sonnet — needs strong coding ability)
let _model: ModelWithOptions | null = null;

async function getModel(): Promise<ModelWithOptions> {
  if (!_model) {
    _model = await setupSpecInstructionsModel();
  }
  return _model;
}

/**
 * Worker node — generates and validates a single mechanic.
 *
 * Reads currentTarget and stateInterfaces from state (set by Send).
 * Returns generatedMechanics (one key) + mechanicsErrors (if any).
 */
async function generateWorker(
  state: MechanicsGraphStateType,
): Promise<Partial<MechanicsGraphStateType>> {
  const target = state.currentTarget;
  if (!target) {
    console.error("[generate_and_validate_mechanic] No currentTarget in state");
    return {};
  }

  const stateInterfaces = state.stateInterfaces;
  if (!stateInterfaces) {
    console.error("[generate_and_validate_mechanic] No stateInterfaces in state");
    return {};
  }

  const model = await getModel();

  console.debug(`[generate_and_validate_mechanic] Generating: ${target.id}`);

  const result = await generateAndValidateMechanic(model, target, stateInterfaces);

  console.debug(
    `[generate_and_validate_mechanic] ${target.id}: valid=${result.valid}, ${result.code.length} chars`,
  );

  // Build state updates
  const mechanicsErrors: MechanicError[] = [];
  if (!result.valid && result.errors) {
    mechanicsErrors.push({
      mechanicId: result.mechanicId,
      errors: result.errors,
    });
  }

  return {
    generatedMechanics: { [result.mechanicId]: result.code },
    mechanicsErrors,
  };
}

// ---------------------------------------------------------------------------
// Subgraph factory
// ---------------------------------------------------------------------------

/**
 * Creates and compiles the mechanics generation subgraph.
 *
 * Usage:
 * ```ts
 * const graph = await createMechanicsGraph();
 * const result = await graph.invoke({
 *   targets,
 *   stateInterfaces,
 *   existingCode: {},  // or existing code for repair
 * });
 * // result.generatedMechanics, result.mechanicsErrors
 * ```
 */
export async function createMechanicsGraph() {
  const workflow = new StateGraph(MechanicsGraphState);

  workflow.addNode("generate_and_validate_mechanic", generateWorker);

  // START → fan-out conditional edge → workers → END
  workflow.addConditionalEdges(START, fanOutTargets);
  workflow.addEdge("generate_and_validate_mechanic" as any, END);

  console.log("[MechanicsGraph] Graph compiled successfully");
  return workflow.compile();
}

// ---------------------------------------------------------------------------
// Target extraction helpers (parsing instructions → MechanicTarget[])
// ---------------------------------------------------------------------------
// Moved to target-builder.ts for reuse across callers
