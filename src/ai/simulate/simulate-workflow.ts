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

const simGraphCache = new GraphCache(
  createSimulationGraph,
  parseInt(process.env.CHAINCRAFT_SIMULATION_GRAPH_CACHE_SIZE ?? "100")
);

const chaincraftSimTracer = new LangChainTracer(
  { projectName: process.env.CHAINCRAFT_SIMULATION_TRACER_PROJECT_NAME },
)

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
    playerStates: PlayerStates
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
  try {
    console.log("[simulate] Processing action for game %s", gameId);
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
      simResponse = getSimResponse(state);
    }

    return simResponse;
  } catch (error) {
    handleError("Failed to process action", error);
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
      gameRules: response.gameRules
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

    const response = await chain.invoke({
      gameStateSchema: schema,
      players: state.players,
    },
    {
      callbacks: [
        chaincraftSimTracer,
      ]
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
        callbacks: [
          chaincraftSimTracer,
        ]
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
    }
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
    .addNode("process_action", actionProcessor);

  // Add edges with conditions
  graph
    .addConditionalEdges(START, (state) => {
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
      return END;
    })
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
    .addEdge("process_action" as any, END);

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
  console.debug("[simulate] Getting player messages");
  const gameState = getGameState(state);

  // Extract player states
  const playerStates: PlayerStates = new Map<string, RuntimePlayerState>();
  for (const [playerId, playerData] of Object.entries(
    gameState.players as Record<string, RuntimePlayerState>
  )) {
    const playerState: RuntimePlayerState = {} as RuntimePlayerState;
    playerState.illegalActionCount = playerData.illegalActionCount;
    playerState.actionsAllowed = playerData.actionsAllowed;
    playerState.actionRequired = playerData.actionRequired;
    const playerMessage = playerData?.privateMessage;
    if (playerMessage && playerMessage.length > 0) {
      playerState.privateMessage = playerMessage;
    }
    playerStates.set(playerId, playerState);
  }

  return {
    publicMessage: gameState.game.publicMessage,  
    playerStates,
    gameEnded: gameState.game.gameEnded
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
