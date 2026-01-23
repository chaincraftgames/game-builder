import "dotenv/config.js";

import { z } from "zod";

import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import { createSpecProcessingGraph } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/index.js";
import { SpecProcessingStateType } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/spec-processing-state.js";
import { createRuntimeGraph } from "#chaincraft/ai/simulate/graphs/runtime-graph/index.js";
import { RuntimeStateType } from "#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js";
import { 
  getDesignSpecificationByVersion,
  getCachedDesignSpecification 
} from "#chaincraft/ai/design/design-workflow.js";

import { getConfig } from "#chaincraft/config.js";
import { getSaver } from "#chaincraft/ai/memory/checkpoint-memory.js";
import { queueAction } from "#chaincraft/ai/simulate/action-queues.js";
import { deserializePlayerMapping } from "#chaincraft/ai/simulate/player-mapping.js";
import { InMemoryStore } from "@langchain/langgraph";

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
 * Extract winner from game state if explicitly set
 * Handles both game.winner and game.winners fields
 */
function extractWinnerFromGameState(
  game: any,
  playerMapping: Record<string, string>
): string | string[] | null | undefined {
  // Helper to convert player alias to UUID if needed
  const resolvePlayerId = (playerIdOrAlias: string | null): string | null => {
    if (playerIdOrAlias === null) return null;
    // Check if it's an alias (player1, player2, etc.)
    const alias = playerIdOrAlias.toLowerCase();
    const uuid = playerMapping[alias];
    return uuid || playerIdOrAlias; // Return UUID if found, otherwise return as-is
  };
  
  // First, check for game.winner (singular)
  if (game?.winner !== undefined) {
    // Winner can be a string (single winner), array (multiple winners), or null (tie)
    if (game.winner === null) {
      return null;
    } else if (Array.isArray(game.winner)) {
      // Map winner IDs through player mapping if needed
      const mapped = game.winner.map((w: string) => resolvePlayerId(String(w))).filter((w: string | null): w is string => w !== null);
      if (mapped.length === 0) return null;
      if (mapped.length === 1) return mapped[0];
      return mapped;
    } else if (typeof game.winner === 'string') {
      // Single winner - map through player mapping if needed
      return resolvePlayerId(game.winner);
    }
  }
  
  // Check for game.winners (plural) if game.winner is not set
  if (game?.winners !== undefined) {
    if (Array.isArray(game.winners)) {
      const mapped = game.winners.map((w: any) => w === null ? null : resolvePlayerId(String(w))).filter((w: any) => w !== null) as string[];
      if (mapped.length === 0) return null;
      if (mapped.length === 1) return mapped[0];
      return mapped;
    } else {
      return resolvePlayerId(String(game.winners));
    }
  }
  
  return undefined;
}

/**
 * Extract winner from player states by checking winner flags and scores
 */
function extractWinnerFromPlayerStates(
  players: Record<string, any>
): { winner: string | string[] | null; hasExplicitScores: boolean } {
  let winnerFromStates: string | string[] | null = null;
  let maxScore = -Infinity;
  const winners: string[] = [];
  let hasExplicitScores = false;
  
  // First, check player states for explicit winner flags or scores
  for (const playerId in players) {
    const player = players[playerId];
    // Check for explicit winner flag
    if (player.winner === true) {
      if (winnerFromStates === null) {
        winnerFromStates = playerId;
      } else if (typeof winnerFromStates === 'string') {
        winnerFromStates = [winnerFromStates, playerId];
      } else {
        winnerFromStates.push(playerId);
      }
    }
    // Check for highest score - only consider if the field actually exists (not undefined)
    const score = player.score ?? player.points ?? player.wins;
    if (typeof score === 'number') {
      hasExplicitScores = true;
      if (score > maxScore) {
        maxScore = score;
        winners.length = 0;
        winners.push(playerId);
      } else if (score === maxScore) {
        winners.push(playerId);
      }
    }
  }
  
  // Use winner flag if found
  if (winnerFromStates !== null) {
    return { winner: winnerFromStates, hasExplicitScores };
  }
  
  // Use scores from player states if available
  if (hasExplicitScores && winners.length > 0) {
    if (maxScore > 0) {
      // Only return winners if maxScore > 0 (at least one player has wins/points)
      // If multiple players have the same max score, it's a tie (return array)
      // If only one winner, return string
      return { winner: winners.length === 1 ? winners[0] : winners, hasExplicitScores };
    }
  }
  
  return { winner: null, hasExplicitScores };
}

/**
 * Parse winner information from message text
 * Handles patterns like "Player 1: 2 wins", "Player 2 wins", etc.
 */
function extractWinnerFromMessage(
  message: string,
  playerMapping: Record<string, string>
): string | string[] | null | undefined {
  const lowerMessage = message.toLowerCase();
  
  // Pattern: "Player X: N wins" or "Player X N wins"
  const playerWinsPattern = /player\s*(\d+)[:\s]+(\d+)\s+wins?/gi;
  const matches = Array.from(lowerMessage.matchAll(playerWinsPattern));
  
  if (matches.length >= 2) {
    // Compare wins from message
    const playerWins: Array<{ playerNum: number; wins: number; playerId: string }> = [];
    for (const match of matches) {
      const playerNum = parseInt(match[1], 10);
      const wins = parseInt(match[2], 10);
      // Map player number to UUID using playerMapping
      const alias = `player${playerNum}`;
      const playerId = playerMapping[alias];
      if (playerId) {
        playerWins.push({
          playerNum,
          wins,
          playerId,
        });
      }
    }
    
    if (playerWins.length > 0) {
      // Find player(s) with highest wins
      const maxWins = Math.max(...playerWins.map(p => p.wins));
      const topPlayers = playerWins.filter(p => p.wins === maxWins);
      
      if (topPlayers.length === 1 && maxWins > 0) {
        // Single winner
        return topPlayers[0].playerId;
      } else if (topPlayers.length > 1 && maxWins > 0) {
        // Multiple winners (tie)
        return topPlayers.map(p => p.playerId);
      } else {
        // All players have 0 wins or tie at 0
        return null;
      }
    }
  }
  
  // Try simpler patterns: "Player X wins" or "Player X is the winner"
  const singleWinnerPattern = /player\s*(\d+)\s+(?:wins|is\s+the\s+winner)/i;
  const singleMatch = lowerMessage.match(singleWinnerPattern);
  if (singleMatch) {
    const playerNum = parseInt(singleMatch[1], 10);
    const alias = `player${playerNum}`;
    const playerId = playerMapping[alias];
    if (playerId) {
      return playerId;
    }
  }
  
  // No winner found in message
  return undefined;
}

/**
 * Extract winner from game state when game has ended
 */
function extractWinner(
  game: any,
  players: Record<string, any> | undefined,
  publicMessage: string | undefined,
  playerMapping: Record<string, string>
): string | string[] | null | undefined {
  // Check if winner is explicitly set in game state (highest priority)
  const explicitWinner = extractWinnerFromGameState(game, playerMapping);
  if (explicitWinner !== undefined) {
    return explicitWinner;
  }
  
  // If no explicit winner and no players, return null
  if (!players || typeof players !== 'object') {
    return null;
  }
  
  const playerIds = Object.keys(players);
  
  // Handle edge case: single player game
  if (playerIds.length === 1) {
    // For single player games, if game ended, that player is the winner (unless explicitly null)
    return playerIds[0];
  }
  
  // Try to determine winner from player states (most reliable after explicit winner)
  const { winner: winnerFromStates, hasExplicitScores } = extractWinnerFromPlayerStates(players);
  
  if (winnerFromStates !== null) {
    return winnerFromStates;
  }
  
  // If we have scores but all are 0, or no scores, try parsing message as fallback
  if (hasExplicitScores && playerIds.length >= 2) {
    // All players have 0 or same score - try parsing message as fallback
    // This handles cases where message has more accurate info than player states
    if (publicMessage) {
      const messageWinner = extractWinnerFromMessage(publicMessage, playerMapping);
      if (messageWinner !== undefined) {
        return messageWinner;
      }
    }
    // All players have 0 score
    return null;
  }
  
  // Fallback to parsing publicMessage if player states don't have clear winner info
  if (publicMessage && playerIds.length >= 2) {
    const messageWinner = extractWinnerFromMessage(publicMessage, playerMapping);
    if (messageWinner !== undefined) {
      return messageWinner;
    }
  }
  
  // No clear winner found
  return null;
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
  
  // Extract winner from game state if game has ended
  const winner = gameEnded 
    ? extractWinner(game, players, publicMessage, playerMapping)
    : undefined;
  
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
 * @param preGeneratedArtifacts - Optional pre-generated artifacts (for testing)
 * @returns The extracted game rules
 */
export async function createSimulation(
  sessionId: string,
  gameId?: string,
  gameSpecificationVersion?: number,
  gameSpecification?: string,
  preGeneratedArtifacts?: SpecArtifacts,
): Promise<{
  gameRules: string;
}> {
  try {
    console.log("[simulate] Creating simulation for session %s", sessionId);
    
    // If pre-generated artifacts provided (testing mode), use them directly
    if (preGeneratedArtifacts) {
      console.log("[simulate] Using pre-generated artifacts (test mode)");
      
      // Store artifacts in runtime graph checkpoint using sessionId
      const runtimeGraph = await runtimeGraphCache.getGraph(sessionId);
      const runtimeConfig = { configurable: { thread_id: sessionId } };
      
      console.log("[simulate] Storing pre-generated artifacts in runtime graph with sessionId:", sessionId);
      
      await runtimeGraph.invoke({
        gameRules: preGeneratedArtifacts.gameRules,
        stateSchema: preGeneratedArtifacts.stateSchema,
        stateTransitions: preGeneratedArtifacts.stateTransitions,
        playerPhaseInstructions: preGeneratedArtifacts.playerPhaseInstructions,
        transitionInstructions: preGeneratedArtifacts.transitionInstructions,
      }, runtimeConfig);
      
      console.log("[simulate] Pre-generated artifacts stored successfully");
      
      return { gameRules: preGeneratedArtifacts.gameRules };
    }
    
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
        
        if (!latestSpec?.specification?.designSpecification) {
          throw new Error(
            `Design specification not found for game ${gameId} (latest version)`
          );
        }
        
        specToUse = latestSpec.specification?.designSpecification;
        versionToUse = latestSpec.specification?.version;
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
      const specConfig = { 
        configurable: { thread_id: specKey },
        store: new InMemoryStore()
      };
      
      // Invoke spec graph - results saved to checkpoint automatically (cached by specKey)
      const specResult = await specGraph.invoke({
        gameSpecification: specToUse,
      }, specConfig) as SpecProcessingStateType;
      
      // Check for validation errors before using artifacts
      const schemaErrors = Array.isArray(specResult.schemaValidationErrors) ? specResult.schemaValidationErrors : [];
      const transitionsErrors = Array.isArray(specResult.transitionsValidationErrors) ? specResult.transitionsValidationErrors : [];
      const instructionsErrors = Array.isArray(specResult.instructionsValidationErrors) ? specResult.instructionsValidationErrors : [];
      const validationErrors = [
        ...schemaErrors,
        ...transitionsErrors,
        ...instructionsErrors,
      ];
      
      if (validationErrors.length > 0) {
        const errorMessage = `Spec processing failed validation with ${validationErrors.length} error(s):\n${validationErrors.join('\n')}`;
        console.error("[simulate]", errorMessage);
        throw new Error(errorMessage);
      }
      
      artifacts = {
        gameRules: String(specResult.gameRules || ""),
        stateSchema: String(specResult.stateSchema || ""),
        stateTransitions: String(specResult.stateTransitions || ""),
        playerPhaseInstructions: (specResult.playerPhaseInstructions && typeof specResult.playerPhaseInstructions === 'object') 
          ? specResult.playerPhaseInstructions as Record<string, string>
          : {},
        transitionInstructions: (specResult.transitionInstructions && typeof specResult.transitionInstructions === 'object')
          ? specResult.transitionInstructions as Record<string, string>
          : {},
      };
      
      console.log("[simulate] Spec processing complete, artifacts cached");
    } else {
      console.log("[simulate] Using cached spec artifacts");
    }
    
    // Step 2: Store artifacts in runtime graph checkpoint using sessionId
    // Get cached runtime graph for this session
    const runtimeGraph = await runtimeGraphCache.getGraph(sessionId);
    const runtimeConfig = { configurable: { thread_id: sessionId } };
    
    console.log("[simulate] Storing artifacts in runtime graph with sessionId:", sessionId);
    
    // Ensure artifacts is defined before using it
    if (!artifacts) {
      throw new Error("[simulate] Artifacts not available - cannot store in runtime graph");
    }
    
    // Store artifacts by invoking runtime graph with the artifacts
    // Don't pass isInitialized or players - this routes to END and saves artifacts to checkpoint
    const storeResult = await runtimeGraph.invoke({
      gameRules: artifacts.gameRules,
      stateSchema: artifacts.stateSchema,
      stateTransitions: artifacts.stateTransitions,
      playerPhaseInstructions: artifacts.playerPhaseInstructions,
      transitionInstructions: artifacts.transitionInstructions,
    }, runtimeConfig);
    
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
