import "dotenv/config.js";

import {
  CompiledStateGraph,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { Runnable } from "@langchain/core/runnables";
import { StructuredOutputParser } from "langchain/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { z, ZodSchema } from "zod";

import { GraphCache } from "#chaincraft/ai/graph-cache.js";
import {
  SimulationState,
  SimulationStateType,
} from "#chaincraft/ai/simulate/simulate-state.js";
import { processGameSpecification } from "#chaincraft/ai/simulate/gameSpecificationProcessor.js";
import {
  runtimeInitializeTemplate,
  runtimeProcessActionTemplate,
} from "#chaincraft/ai/simulate/simulate-prompts.js";
import { getModel } from "#chaincraft/ai/model.js";
import {
  deserializeSchema,
  getGameState,
  RUNTIME_VERSION,
  serializeSchema,
} from "#chaincraft/ai/simulate/schema.js";
import { getConfig } from "#chaincraft/config.js";
import { getSaver } from "../memory/sqlite-memory.js";
import { queueAction } from "./action-queues.js";

const simGraphCache = new GraphCache(
  createSimulationGraph,
  parseInt(process.env.CHAINCRAFT_SIMULATION_GRAPH_CACHE_SIZE ?? "100")
);

const chaincraftSimTracer = new LangChainTracer({
  projectName: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT_NAME,
});

export interface RuntimePlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
}

/** Messages to the players.  Key is player id, value is message. */
export type PlayerStates = Map<string, RuntimePlayerState>;

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

/** Creates a simulation.  Returns the player count. */
export async function createSimulation(
  gameId: string,
  gameSpecification: string,
  gameSpecificationVersion: number
): Promise<{
  playerCount: PlayerCount;
  gameRules: string;
}> {
  try {
    console.log("[simulate] Creating simulation for game %s", gameId);
    let numPlayers = { minPlayers: 0, maxPlayers: 0 };
    let gameRulesResponse = "The model failed to provide rules for this game.";
    const graph = await simGraphCache.getGraph(gameId);
    const config = { configurable: { thread_id: gameId } };

    const inputs = {
      gameSpecification,
      updatedGameSpecVersion: gameSpecificationVersion,
    };
    for await (const {
      minPlayers,
      maxPlayers,
      gameRules,
    } of await graph.stream(inputs, {
      ...config,
      streamMode: "values",
    })) {
      console.debug(
        "[simulate] in createSimulation - min %d max %d:",
        minPlayers,
        maxPlayers
      );
      numPlayers = { minPlayers, maxPlayers };
      gameRulesResponse = gameRules;
    }

    return {
      playerCount: numPlayers,
      gameRules: gameRulesResponse,
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
    const graph = await simGraphCache.getGraph(gameId);
    const config = { configurable: { thread_id: gameId } };
    let publicMessage!: string | undefined;
    let playerStates!: PlayerStates;

    const inputs = {
      players,
      isInitialized: false,
    };
    for await (const state of await graph.stream(inputs, {
      ...config,
      streamMode: "values",
    })) {
      if (state.isInitialized) {
        const simResponse = getSimResponse(state);
        publicMessage = simResponse.publicMessage;
        playerStates = simResponse.playerStates;
      }
    }

    return { publicMessage, playerStates };
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
      console.log("[simulate] Processing action for game %s player %s: %s", gameId, playerId, action);
      const graph = await simGraphCache.getGraph(gameId);
      const config = { configurable: { thread_id: gameId } };
      let simResponse!: SimResponse;

      const inputs = {
        playerAction: {
          playerId,
          playerAction: action,
        },
      };
      
      for await (const state of await graph.stream(inputs, {
        ...config,
        streamMode: "values",
      })) {
        // Check if state is valid before processing
        if (!state) {
          throw new Error("Invalid state received from graph");
        }
        simResponse = getSimResponse(state);
      }

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

    // Add logging to check if we can get the graph
    const graph = await simGraphCache.getGraph(gameId);
    console.log("[simulate] Retrieved graph from cache for %s", gameId);

    const config = { configurable: { thread_id: gameId } };
    let simResponse!: SimResponse;
    let stateFound = false;

    // We deliberately pass an empty object to avoid triggering any processing nodes
    // The graph will load the state, go from START to END, and return the current state
    const inputs = {};

    console.log("[simulate] Starting graph stream for %s", gameId);
    const stream = await graph.stream(inputs, {
      ...config,
      streamMode: "values",
    });

    for await (const state of stream) {
      console.log(
        "[simulate] Stream yielded state for %s: %o",
        gameId,
        Object.keys(state)
      );
      stateFound = true;
      simResponse = getSimResponse(state);
      console.log("[simulate] Generated simResponse for %s", gameId);
    }

    console.log(
      "[simulate] Stream completed for %s, state found: %s",
      gameId,
      stateFound
    );

    // If we get here without a state, the graph might have failed to properly load
    if (!simResponse) {
      console.error(
        "[simulate] No state was processed in the stream for %s",
        gameId
      );

      throw new Error("Failed to retrieve game state");
    }

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
 * Updates a simulation with an updated game description.  This will attempt to update the
 * simulation state schema moving forward to reflect the new game description, while preserving
 * the current simulation state.  This should allow for the game design to be modified while
 * the game is in progress without losing the current game state.
 */
export const updateSimulation = async (
  gameId: string,
  gameSpecification: string
): Promise<void> => {};

function createSpecProcessorNode() {
  return async (state: SimulationStateType) => {
    console.debug("[simulate] In spec processor node");
    const response = await processGameSpecification(state.gameSpecification);

    return {
      ...state,
      schema: serializeSchema(response.schemaFields),
      currentGameSpecVersion: state.updatedGameSpecVersion,
      minPlayers: response.minPlayers,
      maxPlayers: response.maxPlayers,
      gameRules: response.gameRules,
    };
  };
}

function createRuntimeInitNode() {
  // Create a closure scoped variable to hold the chain that will be
  // lazily initialized
  let chain!: Runnable;
  let currentGameSpecVersion!: string;
  let schema!: ZodSchema;

  return async (state: SimulationStateType) => {
    console.debug("[simulate] In runtime init node");
    // Lazy initialization using schema from state
    if (
      !chain ||
      state.currentGameSpecVersion !== currentGameSpecVersion ||
      state.currentRuntimeVersion != RUNTIME_VERSION
    ) {
      const { chain: newChain, schema: newSchema } = await createRuntimeChain(
        state,
        runtimeInitializeTemplate
      );

      chain = newChain;
      schema = newSchema;
      currentGameSpecVersion = state.currentGameSpecVersion;
    }

    const response = await chain.invoke(
      {
        gameStateSchema: schema,
        players: state.players,
      },
      {
        callbacks: [chaincraftSimTracer],
      }
    );

    console.debug("[simulate] In runtime init node response: %o", response);

    return {
      ...state,
      gameState: JSON.stringify(response),
      isInitialized: true,
    };
  };
}

function createActionProcessingNode() {
  // Create a closure scoped variable to hold the chain that will be
  // lazily initialized
  let chain!: Runnable;
  let currentGameSpecVersion!: string;
  let schema!: ZodSchema;

  return async (state: SimulationStateType) => {
    console.debug("[simulate] In action processor node");
    // Lazy initialization using schema from state
    if (
      !chain ||
      state.currentGameSpecVersion !== currentGameSpecVersion ||
      state.currentRuntimeVersion != RUNTIME_VERSION
    ) {
      const { chain: newChain, schema: newSchema } = await createRuntimeChain(
        state,
        runtimeProcessActionTemplate
      );
      chain = newChain;
      schema = newSchema;
      currentGameSpecVersion = state.currentGameSpecVersion;
    }

    const response = await chain.invoke(
      {
        ...state.playerAction,
        gameState: state.gameState,
      },
      {
        callbacks: [chaincraftSimTracer],
      }
    );

    return {
      ...state,
      gameState: JSON.stringify(response),
      playerAction: undefined,
    };
  };
}

async function createRuntimeChain(
  state: SimulationStateType,
  promptTemplate: string
): Promise<{
  chain: Runnable;
  schema: ZodSchema;
}> {
  const schema = deserializeSchema(state.schema);
  const parser = StructuredOutputParser.fromZodSchema(schema);

  const prompt = ChatPromptTemplate.fromTemplate(promptTemplate);

  const model = await getModel(process.env.CHAINCRAFT_SIMULATION_MODEL_NAME);

  const partialChain = await prompt.partial({
    gameSpecification: state.gameSpecification,
    formattingInstructions: parser.getFormatInstructions(),
  });

  const chain = partialChain.pipe(model).pipe(parser);
  const chainWitRetry = chain.withRetry({
    stopAfterAttempt: 2,
    onFailedAttempt: (error) => {
      console.error(
        "[simulate] Chain failed to process. Error: %s",
        error.message
      );
    },
  });

  return {
    chain,
    schema,
  };
}

async function createSimulationGraph(
  threadId: string
): Promise<
  CompiledStateGraph<SimulationStateType, Partial<SimulationStateType>>
> {
  const saver = await getSaver(threadId, getConfig("simulation-graph-type"));

  const specProcessor = createSpecProcessorNode();
  const runtimeInit = createRuntimeInitNode();
  const actionProcessor = createActionProcessingNode();

  // Create graph with our simulation state
  const graph = new StateGraph(SimulationState);

  // Add nodes
  graph
    .addNode("process_spec", specProcessor)
    .addNode("init_runtime", runtimeInit)
    .addNode("process_action", actionProcessor)
    .addNode("get_current_state", async (state: SimulationStateType) => {
      console.debug("[simulate] In get_current_state node");
      return { ...state };
    });

  // Add edges with conditions
  graph
    .addConditionalEdges(START, (state) => {
      console.debug("[simulate] In start node");
      // Start with processing if spec version changed
      if (shouldExecuteProcessSpecNode(state)) {
        return "process_spec";
      }
      if (shouldExecuteInitRuntimeNode(state)) {
        return "init_runtime";
      }
      if (shouldExecuteProcessActionNode(state)) {
        return "process_action";
      }
      return "get_current_state";
    })
    //   return END;
    // })
    .addConditionalEdges("process_spec" as any, (state) => {
      if (shouldExecuteInitRuntimeNode(state)) {
        return "init_runtime";
      }
      if (shouldExecuteProcessActionNode(state)) {
        return "process_action";
      }
      return END;
    })
    .addConditionalEdges("init_runtime" as any, (state) => {
      if (shouldExecuteProcessActionNode(state)) {
        return "process_action";
      }
      console.debug(
        "[simulate] In init_runtime conditional edge returning END"
      );
      return END;
    })
    .addEdge("process_action" as any, END)
    .addEdge("get_current_state" as any, END);

  return graph.compile({ checkpointer: saver });
}

function shouldExecuteProcessSpecNode(state: SimulationStateType) {
  return state.updatedGameSpecVersion !== state.currentGameSpecVersion;
}

function shouldExecuteInitRuntimeNode(state: SimulationStateType) {
  return (
    state.players?.length &&
    state.players.length <= state.maxPlayers &&
    state.players.length >= state.minPlayers &&
    !state.isInitialized
  );
}

function shouldExecuteProcessActionNode(state: SimulationStateType) {
  return state.playerAction && state.isInitialized;
}

function getSimResponse(state: SimulationStateType): SimResponse {
  console.debug("[simulate] Getting sim response");
  
  // Check if state is undefined or null
  if (!state) {
    throw new Error("Cannot create response from undefined state");
  }
  
  const gameState = getGameState(state);
  
  // If gameState is undefined, return a default response
  if (!gameState) {
    return {
      publicMessage: "Error: Unable to get game state",
      playerStates: new Map(),
      gameEnded: false
    };
  }

  // Extract player states
  const playerStates: PlayerStates = new Map<string, RuntimePlayerState>();
  
  // Make sure players object exists
  if (gameState.players) {
    for (const [playerId, playerData] of Object.entries(
      gameState.players as Record<string, RuntimePlayerState>
    )) {
      const playerState: RuntimePlayerState = {
        illegalActionCount: playerData?.illegalActionCount || 0,
        actionsAllowed: playerData?.actionsAllowed !== false,
        actionRequired: playerData?.actionRequired === true
      };
      
      const playerMessage = playerData?.privateMessage;
      if (playerMessage && playerMessage.length > 0) {
        playerState.privateMessage = playerMessage;
      }
      playerStates.set(playerId, playerState);
    }
  }

  return {
    publicMessage: gameState.game?.publicMessage,
    playerStates,
    gameEnded: gameState.game?.gameEnded === true,
  };
}

const handleError = (message: string, error: unknown): never => {
  if (error instanceof z.ZodError) {
    throw new ValidationError(`[simulate] Invalid game state: ${error}`);
  }
  throw new RuntimeError(
    `${message}: ${error instanceof Error ? error.message : "Unknown error"}`
  );
};
