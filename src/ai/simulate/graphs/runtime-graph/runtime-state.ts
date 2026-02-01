/**
 * State for Runtime Simulation Graph
 * 
 * Manages game execution with phase-aware processing:
 * - Phase routing (detect current phase)
 * - Action planning (reason about changes)
 * - State execution (format as JSON)
 */

import { Annotation } from "@langchain/langgraph";

export type RuntimeStateType = typeof RuntimeState.State;

export const RuntimeState = Annotation.Root({
  // Inputs
  players: Annotation<string[]>({
    reducer: (x, y) => [...new Set([...x, ...y])],
    default: () => [],
  }),
  
  playerAction: Annotation<{
    playerId: string;
    playerAction: string;
  } | undefined>({
    reducer: (_, y) => y,
  }),

  // Artifacts from spec processing (cached)
  gameRules: Annotation<string>({
    reducer: (_, y) => y,
  }),
  
  stateSchema: Annotation<string>({
    reducer: (_, y) => y,
  }),
  
  stateTransitions: Annotation<string>({
    reducer: (_, y) => y,
  }),
  
  playerPhaseInstructions: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),
  
  transitionInstructions: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),
  
  specNarratives: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  // Runtime state
  gameState: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  playerMapping: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "{}",
  }),
  
  isInitialized: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),

  // Intermediate processing state
  currentPhase: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  selectedInstructions: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  
  requiresPlayerInput: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => true,
  }),
  
  transitionReady: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
  
  nextPhase: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  winningPlayers: Annotation<string[]>({
    reducer: (x, y) => [...new Set([...x, ...y])],
    default: () => [],
  }),
});
