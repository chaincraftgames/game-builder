import "dotenv/config.js";

import { z } from "zod";

import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import { createSpecProcessingGraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/index.js";
import { createRuntimeGraph } from "#chaincraft/ai/simulate/graphs/runtime-graph/index.js";
import { RuntimeStateType } from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";
import { 
  getDesignSpecificationByVersion,
  getCachedDesignSpecification 
} from "#chaincraft/ai/design/design-workflow.js";

import { getConfig } from "#chaincraft/config.js";
import { getSaver } from "../memory/sqlite-memory.js";
import { queueAction } from "./action-queues.js";
import { deserializePlayerMapping } from "#chaincraft/ai/simulate/player-mapping.js";

/**
 * Replace player aliases (player1, player2, etc.) with real UUIDs in message text.
 * Case-insensitive but requires exact pattern match (e.g., "Player 1" won't match).
 * 
 * @param message - Message text containing player aliases
 * @param playerMapping - Mapping from aliases (player1, player2) to UUIDs
 * @returns Message with aliases replaced by UUIDs
 */
function replacePlayerAliasesWithUUIDs(message: string, playerMapping: Record<string, string>): string {
  // Match player1, player2, etc. (case-insensitive, word boundaries)
  return message.replace(/\bplayer(\d+)\b/gi, (match) => {
    // Normalize to lowercase to look up in mapping
    const alias = match.toLowerCase();
    const uuid = playerMapping[alias];
    
    if (uuid) {
      console.debug(`[simulate_workflow] Replaced ${match} with ${uuid} in message`);
      return uuid;
    }
    
    // If no mapping found, return original (shouldn't happen but safe fallback)
    console.warn(`[simulate_workflow] No UUID found for player alias: ${match}`);
    return match;
  });
}

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
  actionsAllowed?: boolean | null; // Optional, defaults to actionRequired
  actionRequired: boolean;
}

/**
 * Get effective actionsAllowed value for a player.
 * If actionsAllowed is explicitly set, use that value.
 * Otherwise, default to match actionRequired.
 * 
 * Also validates and warns if actionRequired is true but actionsAllowed is false.
 */
export function getActionsAllowed(playerState: RuntimePlayerState): boolean {
  // If explicitly set (not null/undefined), use that value
  if (playerState.actionsAllowed !== null && playerState.actionsAllowed !== undefined) {
    // Validate: if actionRequired is true, actionsAllowed cannot be false
    if (playerState.actionRequired === true && playerState.actionsAllowed === false) {
      console.warn(
        '[getActionsAllowed] Invalid state: actionRequired is true but actionsAllowed is false. ' +
        'Forcing actionsAllowed to true to match actionRequired.'
      );
      return true;
    }
    return playerState.actionsAllowed;
  }
  
  // Default to match actionRequired
  return playerState.actionRequired;
}

/** Messages to the players.  Key is player id, value is message. */
export type PlayerStates = Map<string, RuntimePlayerState>;

export interface SpecArtifacts {
  gameRules: string;
  stateSchema: string;
  stateTransitions: string;
  playerPhaseInstructions: Record<string, string>;
  transitionInstructions: Record<string, string>;
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
      channelValues.playerPhaseInstructions &&
      channelValues.transitionInstructions) {
    console.log("[simulate] Found cached spec artifacts");
    return {
      gameRules: channelValues.gameRules,
      stateSchema: channelValues.stateSchema,
      stateTransitions: channelValues.stateTransitions,
      playerPhaseInstructions: channelValues.playerPhaseInstructions,
      transitionInstructions: channelValues.transitionInstructions,
    };
  }

  console.log("[simulate] Incomplete artifacts in checkpoint");
  return undefined;
}

export type SimResponse = {
  publicMessage?: string;
  playerStates: PlayerStates;
  gameEnded: boolean;
  winner?: string | string[] | null; // Player ID(s) who won, null for tie/no winner, undefined if game hasn't ended
  gameError?: {
    errorType: 'deadlock' | 'invalid_state' | 'rule_violation' | 'transition_failed';
    errorMessage: string;
    errorContext?: any;
    timestamp: string;
  };
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
      gameError: undefined,
    };
  }
  
  const gameState = JSON.parse(state.gameState);
  
  // Extract game and players from parsed state
  const { game, players } = gameState;
  
  // Get player mapping for alias replacement in messages
  const playerMapping = deserializePlayerMapping(state.playerMapping || "{}");
  
  // Replace player aliases with UUIDs in public message
  const publicMessage = game?.publicMessage 
    ? replacePlayerAliasesWithUUIDs(game.publicMessage, playerMapping)
    : undefined;
  
  const gameEnded = game?.gameEnded ?? false;
  const gameError = game?.gameError || undefined;
  const playerStates: PlayerStates = new Map();
  
  for (const playerId in players) {
    const rawPrivateMessage = players[playerId].privateMessage;
    const actionRequired = players[playerId].actionRequired ?? false;
    const actionsAllowed = players[playerId].actionsAllowed;
    
    // Replace player aliases with UUIDs in private message
    const privateMessage = rawPrivateMessage
      ? replacePlayerAliasesWithUUIDs(rawPrivateMessage, playerMapping)
      : undefined;
    
    // Build player state with actionsAllowed defaulted to actionRequired
    const playerState: RuntimePlayerState = {
      privateMessage,
      actionRequired,
      illegalActionCount: players[playerId].illegalActionCount ?? 0,
      actionsAllowed: actionsAllowed !== undefined && actionsAllowed !== null 
        ? actionsAllowed 
        : actionRequired, // Default to actionRequired if not explicitly set
    };
    
    playerStates.set(playerId, playerState);
  }
  
  // Extract winner information from game state
  // Winner can be stored as:
  // - game.winner (single player ID or null)
  // - game.winners (array of player IDs)
  // - Determined from player scores (highest score wins)
  let winner: string | string[] | null | undefined = undefined;
  
  if (gameEnded) {
    // Helper to convert player alias to UUID if needed
    const resolvePlayerId = (playerIdOrAlias: string | null): string | null => {
      if (playerIdOrAlias === null) return null;
      // Check if it's an alias (player1, player2, etc.)
      const alias = playerIdOrAlias.toLowerCase();
      const uuid = playerMapping[alias];
      return uuid || playerIdOrAlias; // Return UUID if found, otherwise return as-is
    };
    
    // First, check for explicit winner fields
    if (game?.winner !== undefined) {
      // Handle null (tie/no winner) or string (single winner)
      if (game.winner === null) {
        winner = null;
      } else {
        winner = resolvePlayerId(String(game.winner));
      }
    } else if (game?.winners !== undefined) {
      // Handle array of winners
      if (Array.isArray(game.winners)) {
        winner = game.winners.map(w => w === null ? null : resolvePlayerId(String(w))).filter(w => w !== null) as string[];
        if (winner.length === 0) winner = null;
        else if (winner.length === 1) winner = winner[0];
      } else {
        winner = resolvePlayerId(String(game.winners));
      }
    } else if (players && Object.keys(players).length > 0) {
      // Fallback: determine winner from highest score
      // This is a common pattern in games where winner is determined by score
      const playerScores: Array<{ playerId: string; score: number }> = [];
      for (const playerId in players) {
        const score = players[playerId]?.score ?? 0;
        playerScores.push({ playerId, score });
      }
      
      if (playerScores.length > 0) {
        const maxScore = Math.max(...playerScores.map(p => p.score));
        const winners = playerScores.filter(p => p.score === maxScore).map(p => p.playerId);
        
        if (winners.length === 1) {
          winner = winners[0];
        } else if (winners.length > 1) {
          // Multiple players tied for highest score
          winner = winners;
        } else {
          // No scores found, no winner
          winner = null;
        }
      } else {
        winner = null;
      }
    } else {
      // Game ended but no winner information available
      winner = null;
    }
  }
  
  return {
    publicMessage,
    playerStates,
    gameEnded,
    winner,
    gameError,
  };
}

/**
 * Creates a simulation by processing game specification and storing artifacts.
 * 
 * @param sessionId - The ID of the game session.  The same id should be used for 
 * subsequent calls to initialize and process actions.  This id must be unique across
 * all simulation sessions.
 * @param gameId - Optional: The game ID (conversationId) to fetch spec from design 
 * workflow. If not provided, the specification must be provided directly.
 * @param gameSpecificationVersion - Optional: The version number of the specification 
 * to use. If omitted, uses latest version.
 * @param gameSpecification - Optional override: if provided, uses this spec directly 
 * instead of retrieving from design workflow
 * @returns The extracted game rules
 */
export async function createSimulation(
  sessionId: string,
  gameId?: string,
  gameSpecificationVersion?: number,
  gameSpecification?: string,
): Promise<{
  gameRules: string;
}> {
  try {
    console.log("[simulate] Creating simulation for session %s", sessionId);
    
    // If gameSpecification not provided, retrieve it from design workflow
    let specToUse = gameSpecification;
    let versionToUse = gameSpecificationVersion;
    
    if (!specToUse) {
      // We need to fetch spec from design workflow - gameId is required
      if (!gameId) {
        throw new Error(
          `gameId is required when gameSpecification is not provided. sessionId (${sessionId}) cannot be used to fetch spec from design workflow.`
        );
      }
    } 
    
    if (!specToUse) {
      // If no version specified, get the latest
      if (!versionToUse) {
        console.log("[simulate] No version specified, retrieving latest spec from design workflow:", gameId);
        const latestSpec = await getCachedDesignSpecification(gameId!);
        
        if (!latestSpec) {
          throw new Error(
            `Design specification not found for game ${gameId} (latest version)`
          );
        }
        
        specToUse = latestSpec.designSpecification;
        versionToUse = latestSpec.version;
        console.log("[simulate] Retrieved latest spec from design workflow, version:", versionToUse, "title:", latestSpec.title);
      } else {
        // Specific version requested
        console.log("[simulate] Retrieving spec from design workflow:", gameId, "version:", versionToUse);
        const designSpec = await getDesignSpecificationByVersion(gameId!, versionToUse);
        
        if (!designSpec) {
          throw new Error(
            `Design specification not found for game ${gameId} version ${versionToUse}`
          );
        }
        
        specToUse = designSpec.designSpecification;
        console.log("[simulate] Retrieved spec from design workflow, title:", designSpec.title);
      }
    } else {
      console.log("[simulate] Using provided game specification (override mode)");
      // If version not provided with override, default to 1 for testing
      if (!versionToUse) {
        versionToUse = 1;
        console.log("[simulate] No version provided with override, defaulting to version 1");
      }
    }
    
    // Create spec key from conversation ID and version (for caching spec artifacts)
    const specKey = `${gameId}-v${versionToUse}`;
    
    // Step 1: Check for cached spec artifacts or generate new ones
    let artifacts = await getCachedSpecArtifacts(specKey);
    
    if (!artifacts) {
      console.log("[simulate] Processing game specification (not cached)");
      
      // Get or create spec processing graph for this spec
      const specGraph = await specGraphCache.getGraph(specKey);
      const config = { configurable: { thread_id: specKey } };
      
      // Invoke spec graph - results saved to checkpoint automatically
      const specResult = await specGraph.invoke({
        gameSpecification: specToUse,
      }, config);
      
      artifacts = {
        gameRules: specResult.gameRules,
        stateSchema: specResult.stateSchema,
        stateTransitions: specResult.stateTransitions,
        playerPhaseInstructions: specResult.playerPhaseInstructions,
        transitionInstructions: specResult.transitionInstructions,
      };
      
      console.log("[simulate] Spec processing complete, artifacts cached");
    } else {
      console.log("[simulate] Using cached spec artifacts");
    }
    
    // Step 2: Store artifacts in runtime graph checkpoint
    // Get cached runtime graph for this session
    const runtimeGraph = await runtimeGraphCache.getGraph(sessionId);
    const config = { configurable: { thread_id: sessionId } };
    
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
    
    console.log("[simulate] Runtime graph initialized with artifacts for session %s", sessionId);
    
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
    
    // Normalize player IDs to lowercase for consistent handling
    const normalizedPlayers = players.map(p => p.toLowerCase());
    
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
        hasPlayerPhaseInstructions: !!state.playerPhaseInstructions,
        hasTransitionInstructions: !!state.transitionInstructions,
        gameRulesPreview: state.gameRules?.substring(0, 100) + "...",
        stateSchemaPreview: state.stateSchema?.substring(0, 100) + "...",
      });
    } else {
      console.log("[simulate] No checkpoint found before initialization");
    }
    
    // Invoke runtime graph with players - artifacts loaded automatically from checkpoint
    const result = await runtimeGraph.invoke({
      players: normalizedPlayers,
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
      
      // Normalize player ID to lowercase for consistent handling
      const normalizedPlayerId = playerId.toLowerCase();
      
      // Get cached runtime graph with checkpointer
      const runtimeGraph = await runtimeGraphCache.getGraph(gameId);
      const config = { configurable: { thread_id: gameId } };
      
      // Invoke runtime graph with player action - all state loaded automatically from checkpoint
      const result = await runtimeGraph.invoke({
        playerAction: {
          playerId: normalizedPlayerId,
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
 * Retrieves the full canonical game state for testing and debugging.
 * Returns the parsed game state object with game and player fields.
 * @param gameId The ID of the game/conversation
 * @returns The parsed game state object { game: {...}, players: {...} }
 */
export async function getGameState(gameId: string): Promise<{ game: any; players: any }> {
  try {
    console.log("[simulate] Getting full game state for %s", gameId);

    // Load state directly from checkpoint without invoking graph
    const saver = await getSaver(gameId, getConfig("simulation-graph-type"));
    const config = { configurable: { thread_id: gameId } };
    
    const checkpoint = await saver.getTuple(config);
    if (!checkpoint?.checkpoint?.channel_values) {
      throw new Error("No checkpoint found for game");
    }

    const state = checkpoint.checkpoint.channel_values as RuntimeStateType;
    if (!state.gameState) {
      throw new Error("No gameState in checkpoint");
    }

    const parsedState = JSON.parse(state.gameState);
    console.log("[simulate] Retrieved full game state for %s", gameId);
    return parsedState;
  } catch (error) {
    console.error(
      "[simulate] Error in getGameState for %s: %o",
      gameId,
      error
    );
    handleError("Failed to get game state", error);
    return Promise.reject(error);
  }
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
