/**
 * State for Game Specification Processing Graph
 * 
 * Transforms raw game specification into runtime-ready artifacts:
 * - State schema (structure of game state)
 * - State transitions (phase transition rules)
 * - Phase instructions (natural language rules per phase)
 */

import { Annotation } from "@langchain/langgraph";

export type SpecProcessingStateType = typeof SpecProcessingState.State;

export const SpecProcessingState = Annotation.Root({
  // Input
  gameSpecification: Annotation<string>({
    reducer: (_, y) => y,
  }),

  // Optional: Narrative content referenced by markers in spec
  specNarratives: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // Outputs from nodes
  gameRules: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  stateSchema: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  stateTransitions: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  playerPhaseInstructions: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),
  
  transitionInstructions: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // Example state for schema generation
  exampleState: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  // Arrays to capture validation errors across retry attempts
  schemaValidationErrors: Annotation<string[] | null | undefined>({
    reducer: (x, y) => {
      if (y === null) return null;              // explicit clear
      if (y === undefined) return x;            // not mentioned, keep existing
      return [...(x || []), ...y];              // accumulate new errors
    },
    default: () => undefined,
  }),

  transitionsValidationErrors: Annotation<string[] | null | undefined>({
    reducer: (x, y) => {
      if (y === null) return null;              // explicit clear
      if (y === undefined) return x;            // not mentioned, keep existing
      return [...(x || []), ...y];              // accumulate new errors
    },
    default: () => undefined,
  }),

  instructionsValidationErrors: Annotation<string[] | null | undefined>({
    reducer: (x, y) => {
      if (y === null) return null;              // explicit clear
      if (y === undefined) return x;            // not mentioned, keep existing
      return [...(x || []), ...y];              // accumulate new errors
    },
    default: () => undefined,
  }),
});
