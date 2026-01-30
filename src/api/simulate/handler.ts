import { FastifyRequest, FastifyReply } from "fastify";
import {
  CreateSimulationRequest,
  CreateSimulationRequestSchema,
  CreateSimulationResponse,
  InitializeSimulationRequest,
  InitializeSimulationRequestSchema,
  InitializeSimulationResponse,
  ProcessActionRequest,
  ProcessActionRequestSchema,
  ProcessActionResponse,
  GetSimulationStateRequest,
  GetSimulationStateRequestSchema,
  GetSimulationStateResponse,
} from "#chaincraft/api/simulate/schemas.js";
import {
  createSimulation,
  initializeSimulation,
  processAction,
  getSimulationState,
} from "#chaincraft/ai/simulate/simulate-workflow.js";

export async function handleCreateSimulation(
  request: FastifyRequest<{ Body: CreateSimulationRequest }>,
  reply: FastifyReply,
): Promise<CreateSimulationResponse> {
  const result = CreateSimulationRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const {
      sessionId,
      gameSpecificationVersion,
      gameSpecification,
      gameId,
      atomicArtifactRegen,
    } = result.data;

    const response = await createSimulation(
      sessionId,
      gameId,
      gameSpecificationVersion,
      {
        overrideSpecification: gameSpecification,
        atomicArtifactRegen,
      },
    );

    return {
      gameRules: response.gameRules,
    };
  } catch (error) {
    console.error("Error in createSimulation:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleInitializeSimulation(
  request: FastifyRequest<{ Body: InitializeSimulationRequest }>,
  reply: FastifyReply,
): Promise<InitializeSimulationResponse> {
  const result = InitializeSimulationRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { gameId, players } = result.data;
    const response = await initializeSimulation(gameId, players);

    // Convert Map to plain object for JSON serialization
    const playerStates: Record<string, any> = {};
    response.playerStates.forEach((state, playerId) => {
      playerStates[playerId] = state;
    });

    return {
      publicMessage: response.publicMessage,
      playerStates,
    };
  } catch (error) {
    console.error("Error in initializeSimulation:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleProcessAction(
  request: FastifyRequest<{ Body: ProcessActionRequest }>,
  reply: FastifyReply,
): Promise<ProcessActionResponse> {
  const result = ProcessActionRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { gameId, playerId, action } = result.data;
    const response = await processAction(gameId, playerId, action);

    // Convert Map to plain object for JSON serialization
    const playerStates: Record<string, any> = {};
    response.playerStates.forEach((state, playerId) => {
      playerStates[playerId] = state;
    });

    return {
      publicMessage: response.publicMessage,
      playerStates,
      gameEnded: response.gameEnded,
      gameError: response.gameError,
    };
  } catch (error) {
    console.error("Error in processAction:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGetSimulationState(
  request: FastifyRequest<{ Body: GetSimulationStateRequest }>,
  reply: FastifyReply,
): Promise<GetSimulationStateResponse> {
  const result = GetSimulationStateRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { gameId } = result.data;
    const response = await getSimulationState(gameId);

    // Convert Map to plain object for JSON serialization
    const playerStates: Record<string, any> = {};
    response.playerStates.forEach((state, playerId) => {
      playerStates[playerId] = state;
    });

    return {
      publicMessage: response.publicMessage,
      playerStates,
      gameEnded: response.gameEnded,
      gameError: response.gameError,
    };
  } catch (error) {
    console.error("Error in getSimulationState:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}
