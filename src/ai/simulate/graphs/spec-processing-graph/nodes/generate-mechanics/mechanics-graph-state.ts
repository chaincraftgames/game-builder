/**
 * State for Mechanics Generation Subgraph
 *
 * Self-contained state for the mechanics generation/editing subgraph.
 * Callers (spec-processing, artifact-editor, sim-assistant) provide
 * targets + stateInterfaces, and receive generatedMechanics + errors.
 *
 * Internal fan-out fields (currentTarget) are subgraph-private — they
 * never leak to parent graph state.
 */

import { Annotation } from "@langchain/langgraph";
import type {
  MechanicTarget,
  MechanicError,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/schema.js";

export type MechanicsGraphStateType = typeof MechanicsGraphState.State;

export const MechanicsGraphState = Annotation.Root({
  // ─── Inputs (set by caller) ───

  /** Mechanic targets to generate/edit */
  targets: Annotation<MechanicTarget[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** TypeScript interfaces source (from generateStateInterfaces) */
  stateInterfaces: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /** Existing code for repair/edit (transitionId → TypeScript source) */
  existingCode: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // ─── Internal (set by fan-out Send, subgraph-private) ───

  /** Current target being processed by this Send invocation */
  currentTarget: Annotation<MechanicTarget | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  // ─── Outputs (read by caller after invocation) ───

  /** Generated mechanic code keyed by mechanic ID (spread-merge across workers) */
  generatedMechanics: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),

  /** tsc validation errors accumulated across all mechanic generations */
  mechanicsErrors: Annotation<MechanicError[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
