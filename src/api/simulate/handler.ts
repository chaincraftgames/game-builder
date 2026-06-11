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
  ProduceTokenRequest,
  ProduceTokenResponse,
  ProduceTokenRequestSchema,
  GenerateTokenImageRequest,
  GenerateTokenImageResponse,
  GenerateTokenImageRequestSchema,
} from "#chaincraft/api/simulate/schemas.js";
import {
  createSimulation,
  initializeSimulation,
  processAction,
  getSimulationState,
  produceToken,
  generateTokenImage,
} from "#chaincraft/ai/simulate/simulate-workflow.js";

export async function handleCreateSimulation(
  request: FastifyRequest<{ Body: CreateSimulationRequest }>,
  reply: FastifyReply,
): Promise<void> {
  const result = CreateSimulationRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return;
  }

  const {
    sessionId,
    gameSpecificationVersion,
    gameSpecification,
    gameId,
    atomicArtifactRegen,
  } = result.data;

  // Fire-and-forget: run artifact processing in the background.
  // Progress and terminal events (generation:completed / generation:error) are
  // broadcast on the SSE bus at GET /api/create/:sessionId/status.
  // The orchestrator subscribes to that stream and waits for the terminal event
  // before proceeding with initializeSimulation.
  createSimulation(sessionId, gameId, gameSpecificationVersion, {
    overrideSpecification: gameSpecification,
    atomicArtifactRegen,
  }).catch((error) => {
    // Errors are already emitted to the SSE bus inside createSimulation;
    // this catch just prevents an unhandled-rejection warning.
    console.error(
      `[handleCreateSimulation] Background processing error for session ${sessionId}:`,
      error,
    );
  });

  // Return 202 immediately — the caller must subscribe to the SSE stream for completion.
  reply.code(202).send({ status: "processing", sessionId });
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
      winningPlayers: response.winningPlayers,
      producedTokens: response.producedTokens,
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
      winningPlayers: response.winningPlayers,
      producedTokens: response.producedTokens,
      gameError: response.gameError,
    };
  } catch (error) {
    console.error("Error in getSimulationState:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleProduceToken(
  request: FastifyRequest<{ Body: ProduceTokenRequest }>,
  reply: FastifyReply,
): Promise<ProduceTokenResponse> {
  const result = ProduceTokenRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { sessionId, playerId, tokenType } = result.data;
    const response = await produceToken(sessionId, tokenType, playerId);

    return response;
  } catch (error) {
    console.error("Error in produceToken:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGenerateTokenImage(
  request: FastifyRequest<{ Body: GenerateTokenImageRequest }>,
  reply: FastifyReply,
): Promise<GenerateTokenImageResponse> {
  const result = GenerateTokenImageRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { sessionId, token } = result.data;
    const response = await generateTokenImage(sessionId, token);

    return response;
  } catch (error) {
    console.error("Error in generateTokenImage:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}
