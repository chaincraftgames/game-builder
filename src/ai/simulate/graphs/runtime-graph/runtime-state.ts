/**
 * State for Runtime Simulation Graph
 * 
 * Manages game execution with phase-aware processing:
 * - Phase routing (detect current phase)
 * - Action planning (reason about changes)
 * - State execution (format as JSON)
 */

import { Annotation } from "@langchain/langgraph";
import type { DataSourceConfig } from "#chaincraft/ai/design/game-design-state.js";

// ─── Repair History Types ─────────────────────────────────────────────────────

/** Record of a single repair attempt, persisted on the runtime checkpoint. */
export interface RepairRecord {
  /** Monotonically increasing attempt number (1-based). */
  attempt: number;
  /** Symptom descriptions passed by the sim assistant. */
  symptoms: string[];
  /** Summary of changes applied (from changesApplied). */
  changesSummary: string[];
  /** Whether the repair succeeded (editor graph returned editSucceeded). */
  succeeded: boolean;
  /** ISO timestamp. */
  timestamp: string;
}

import type { ArtifactSnapshot } from '#chaincraft/ai/simulate/artifacts.js';

export type RuntimeStateType = typeof RuntimeState.State;

export const RuntimeState = Annotation.Root({
  // Metadata about the game specification used
  gameId: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  gameSpecificationVersion: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),
  
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

  generatedMechanics: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),
  
  specNarratives: Annotation<Record<string, string>>({
    reducer: (_, y) => y,
    default: () => ({}),
  }),

  producedTokensConfiguration: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  dataSources: Annotation<DataSourceConfig[]>({
    reducer: (_, y) => y,
    default: () => [],
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

  imagePrompt: Annotation<string | undefined>({
    reducer: (_, y) => y,
    default: () => undefined,
  }),

  // ─── Repair tracking (persisted across restarts) ──────────────────────────

  /** History of repair attempts for coordinator cross-repair awareness. */
  repairHistory: Annotation<RepairRecord[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Pre-repair artifact snapshot for rollback. Cleared on successful restart. */
  artifactSnapshot: Annotation<ArtifactSnapshot | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),
});
