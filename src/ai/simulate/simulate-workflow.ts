import "dotenv/config.js";

import { z } from "zod";

import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import { createSpecProcessingGraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/index.js";
import { createRuntimeGraph } from "#chaincraft/ai/simulate/graphs/runtime-graph/index.js";
import { RuntimeStateType } from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";
import {
  getGameState,
  RUNTIME_VERSION,
} from "#chaincraft/ai/simulate/schema.js";
import { getConfig } from "#chaincraft/config.js";
import { getSaver } from "../memory/sqlite-memory.js";
import { queueAction } from "./action-queues.js";

// Cache for runtime graphs to avoid recompilation
const runtimeGraphCache = new GraphCache(
  async (threadId: string) => {
    const saver = await getSaver(threadId, getConfig("simulation-graph-type"));
    return await createRuntimeGraph(saver);
  },
  parseInt(process.env.CHAINCRAFT_RUNTIME_GRAPH_CACHE_SIZE ?? "100")
);

// Cache for spec processing graphs to avoid reprocessing specs
const specGraphCache = new GraphCache(
  async (specKey: string) => {
    const saver = await getSaver(specKey, getConfig("simulation-graph-type"));
    return await createSpecProcessingGraph(saver);
  },
  parseInt(process.env.CHAINCRAFT_SPEC_GRAPH_CACHE_SIZE ?? "50")
);

export interface RuntimePlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
}

/** Messages to the players.  Key is player id, value is message. */
export type PlayerStates = Map<string, RuntimePlayerState>;

export interface SpecArtifacts {
  gameRules: string;
  stateSchema: string;
  stateTransitions: string;
  phaseInstructions: Record<string, string>;
}

/**
 * Get cached spec processing artifacts from checkpoint.
 * Similar to getCachedDesignSpecification in design-workflow.
 */
async function getCachedSpecArtifacts(
  specKey: string
): Promise<SpecArtifacts | undefined> {
  const saver = await getSaver(specKey, getConfig("simulation-graph-type"));
  const config = { configurable: { thread_id: specKey } };

  console.log("[simulate] Checking for cached spec artifacts:", specKey);

  // Get latest checkpoint
  const checkpointIterator = saver.list(config, { limit: 1 });
  const firstCheckpoint = await checkpointIterator.next();

  if (firstCheckpoint.done) {
    console.log("[simulate] No cached artifacts found");
    return undefined;
  }

  const latestCheckpoint = firstCheckpoint.value;
  if (!latestCheckpoint.checkpoint.channel_values) {
    return undefined;
  }

  const channelValues = latestCheckpoint.checkpoint.channel_values as any;
  
  // Check if we have all required artifacts
  if (channelValues.gameRules && 
      channelValues.stateSchema && 
      channelValues.stateTransitions && 
      channelValues.phaseInstructions) {
    console.log("[simulate] Found cached spec artifacts");
    return {
      gameRules: channelValues.gameRules,
      stateSchema: channelValues.stateSchema,
      stateTransitions: channelValues.stateTransitions,
      phaseInstructions: channelValues.phaseInstructions,
    };
  }

  console.log("[simulate] Incomplete artifacts in checkpoint");
  return undefined;
}

export type SimResponse = {
  publicMessage?: string;
  playerStates: PlayerStates;
  gameEnded: boolean;
};

type PlayerCount = {
  minPlayers: number;
  maxPlayers: number;
};

// Custom error types for better error handling
export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class ValidationError extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Helper to extract SimResponse from RuntimeState
 */
function getRuntimeResponse(state: RuntimeStateType): SimResponse {
  // Handle undefined or empty gameState
  if (!state.gameState || state.gameState === "") {
    return {
      publicMessage: undefined,
      playerStates: new Map(),
      gameEnded: false,
    };
  }
  
  const gameState = JSON.parse(state.gameState);
  
  // Extract game and players from parsed state
  const { game, players } = gameState;
  
  const publicMessage = game?.publicMessage;
  const gameEnded = game?.gameEnded ?? false;
  const playerStates: PlayerStates = new Map();
  
  for (const playerId in players) {
    const privateMessage = players[playerId].privateMessage;
    playerStates.set(playerId, {
      privateMessage: privateMessage || undefined,
      actionsAllowed: players[playerId].actionsAllowed ?? true,
      actionRequired: players[playerId].actionRequired ?? false,
      illegalActionCount: players[playerId].illegalActionCount ?? 0,
    });
  }
  
  return {
    publicMessage,
    playerStates,
    gameEnded,
  };
}

/** Creates a simulation.  Returns the player count. */
export async function createSimulation(
  gameId: string,
  gameSpecification: string,
  gameSpecificationVersion: number
): Promise<{
  gameRules: string;
}> {
  try {
    console.log("[simulate] Creating simulation for game %s", gameId);
    
    // Create spec key from game ID and version
    const specKey = `${gameId}-v${gameSpecificationVersion}`;
    
    // Step 1: Check for cached spec artifacts or generate new ones
    let artifacts = await getCachedSpecArtifacts(specKey);
    
    if (!artifacts) {
      console.log("[simulate] Processing game specification (not cached)");
      
      // Get or create spec processing graph for this spec
      const specGraph = await specGraphCache.getGraph(specKey);
      const config = { configurable: { thread_id: specKey } };
      
      // Invoke spec graph - results saved to checkpoint automatically
      const specResult = await specGraph.invoke({
        gameSpecification,
      }, config);
      
      artifacts = {
        gameRules: specResult.gameRules,
        stateSchema: specResult.stateSchema,
        stateTransitions: specResult.stateTransitions,
        phaseInstructions: specResult.phaseInstructions,
      };
      
      console.log("[simulate] Spec processing complete, artifacts cached");
    } else {
      console.log("[simulate] Using cached spec artifacts");
    }
    
    // Step 2: Store artifacts in runtime graph checkpoint
    // Get cached runtime graph for this game
    const runtimeGraph = await runtimeGraphCache.getGraph(gameId);
    const config = { configurable: { thread_id: gameId } };
    
    console.log("[simulate] Invoking runtime graph to store artifacts (should route to END)");
    
    // Store artifacts by invoking runtime graph
    // Don't pass isInitialized or players - this routes to END and saves artifacts
    const storeResult = await runtimeGraph.invoke({
      ...artifacts,
    }, config);
    
    console.log("[simulate] Artifact storage invoke completed, result:", {
      hasGameRules: !!storeResult.gameRules,
      hasStateSchema: !!storeResult.stateSchema,
    });
    
    console.log("[simulate] Runtime graph initialized with artifacts for game %s", gameId);
    
    return {
      gameRules: artifacts.gameRules,
    };
  } catch (error) {
    handleError("Failed to create simulation", error);
    return Promise.reject(error);
  }
}

export async function initializeSimulation(
  gameId: string,
  players: string[]
): Promise<{
  publicMessage?: string;
  playerStates: PlayerStates;
}> {
  try {
    console.log("[simulate] Initializing simulation for game %s", gameId);
    
    // Get cached runtime graph with checkpointer
    const runtimeGraph = await runtimeGraphCache.getGraph(gameId);
    const config = { configurable: { thread_id: gameId } };
    
    // Log checkpoint state to verify artifacts are present
    const saver = await getSaver(gameId, getConfig("simulation-graph-type"));
    const checkpoint = await saver.getTuple(config);
    if (checkpoint?.checkpoint?.channel_values) {
      const state = checkpoint.checkpoint.channel_values as any;
      console.log("[simulate] Checkpoint artifacts present:", {
        hasGameRules: !!state.gameRules,
        hasStateSchema: !!state.stateSchema,
        hasStateTransitions: !!state.stateTransitions,
        hasPhaseInstructions: !!state.phaseInstructions,
        gameRulesPreview: state.gameRules?.substring(0, 100) + "...",
        stateSchemaPreview: state.stateSchema?.substring(0, 100) + "...",
      });
    } else {
      console.log("[simulate] No checkpoint found before initialization");
    }
    
    // Invoke runtime graph with players - artifacts loaded automatically from checkpoint
    const result = await runtimeGraph.invoke({
      players,
      isInitialized: false,
    }, config);
    
    // Extract response from return value
    const simResponse = getRuntimeResponse(result as RuntimeStateType);
    
    return { 
      publicMessage: simResponse.publicMessage, 
      playerStates: simResponse.playerStates 
    };
  } catch (error) {
    handleError("Failed to initialize simulation", error);
    return Promise.reject(error);
  }
}

export async function processAction(
  gameId: string,
  playerId: string,
  action: string
): Promise<SimResponse> {
  // Queue the action to ensure sequential processing
  return queueAction(gameId, async () => {
    try {
      console.log(
        "[simulate] Processing action for game %s player %s: %s",
        gameId,
        playerId,
        action
      );
      
      // Get cached runtime graph with checkpointer
      const runtimeGraph = await runtimeGraphCache.getGraph(gameId);
      const config = { configurable: { thread_id: gameId } };
      
      // Invoke runtime graph with player action - all state loaded automatically from checkpoint
      const result = await runtimeGraph.invoke({
        playerAction: {
          playerId,
          playerAction: action,
        },
      }, config);
      
      // Extract response from return value
      const simResponse = getRuntimeResponse(result as RuntimeStateType);
      
      // Validate that we got a response
      if (!simResponse) {
        throw new Error("No response generated from game state");
      }

      return simResponse;
    } catch (error) {
      handleError("Failed to process action", error);
      return Promise.reject(error);
    }
  });
}

/**
 * Retrieves the current state of the game, including player messages,
 * without modifying the game state.
 * @param gameId The ID of the game/conversation
 * @returns The current simulation state response with player messages
 */
export async function getSimulationState(gameId: string): Promise<SimResponse> {
  try {
    console.log("[simulate] Getting game state for %s", gameId);

    // Load state directly from checkpoint without invoking graph
    const saver = await getSaver(gameId, getConfig("simulation-graph-type"));
    const config = { configurable: { thread_id: gameId } };
    
    const checkpoint = await saver.getTuple(config);
    if (!checkpoint || !checkpoint.checkpoint) {
      throw new Error("No game state found for this game.");
    }

    const state = checkpoint.checkpoint.channel_values as RuntimeStateType;
    const simResponse = getRuntimeResponse(state);

    console.log("[simulate] Retrieved game state for %s", gameId);
    return simResponse;
  } catch (error) {
    console.error(
      "[simulate] Error in getSimulationState for %s: %o",
      gameId,
      error
    );
    handleError("Failed to get player messages", error);
    return Promise.reject(error);
  }
}

/**
 * Continues the simulation by processing a system-level action that asks the AI
 * to continue the game or inform players what actions they need to take.
 * This is equivalent to the Discord "Continue Game" button functionality.
 * @param gameId The ID of the game/conversation
 * @returns The simulation response with updated game state and messages
 */
export async function continueSimulation(gameId: string): Promise<SimResponse> {
  const continueQuestion = `
  The players of the game believe they have completed all actions and are 
  waiting for the game to continue.  If waiting for a player action, please 
  inform the player(s) you are waiting on via public message.  If not waiting 
  on player actions, then you please take the appropriate game level actions to 
  continue the game, e.g. judging, scoring, generating narrative, resolving 
  non-player or ai controlled player actions.
  `;

  return processAction(gameId, "all players", `QUESTION: ${continueQuestion}`);
}

/**
 * Updates a simulation with an updated game description.  This will attempt to update the
 * simulation state schema moving forward to reflect the new game description, while preserving
 * the current simulation state.  This should allow for the game design to be modified while
 * the game is in progress without losing the current game state.
 */
export const updateSimulation = async (
  gameId: string,
  gameSpecification: string
): Promise<void> => {};

const handleError = (message: string, error: unknown): never => {
  if (error instanceof z.ZodError) {
    throw new ValidationError(`[simulate] Invalid game state: ${error}`);
  }
  throw new RuntimeError(
    `${message}: ${error instanceof Error ? error.message : "Unknown error"}`
  );
};
