import { FastifyRequest, FastifyReply } from "fastify";
import {
  ContinueDesignConversationRequest,
  ContinueDesignConversationRequestSchema,
  ContinueDesignConversationResponse,
  GenerateSpecRequest,
  GenerateSpecRequestSchema,
  GenerateSpecResponse,
  GenerateImageRequest,
  GenerateImageRequestSchema,
  GenerateImageResponse,
  GetFullSpecificationRequest,
  GetFullSpecificationRequestSchema,
  GetFullSpecificationResponse,
  GetConversationHistoryRequest,
  GetConversationHistoryRequestSchema,
  GetConversationHistoryResponse,
  PublishGameRequest,
  PublishGameRequestSchema,
  PublishGameResponse,
} from "#chaincraft/api/design/schemas.js";
import {
  continueDesignConversation,
  generateImage,
  getFullDesignSpecification,
  getCachedDesignSpecification,
  getConversationHistory,
  isActiveConversation,
} from "#chaincraft/ai/design/design-workflow.js";
import { expandSpecification } from "#chaincraft/ai/design/expand-narratives.js";
import { uploadToIpfs } from "#chaincraft/integrations/storage/pinata.js";

/**
 * Helper to expand narratives in a specification for API responses.
 * Uses narratives returned from workflow functions.
 */
function expandSpecForAPI(
  spec: any,
  narratives: Record<string, string> | undefined
): any {
  if (!spec || !narratives || Object.keys(narratives).length === 0) {
    return spec;
  }
  
  return expandSpecification(spec, narratives);
}

export async function handleContinueDesignConversation(
  request: FastifyRequest<{ Body: ContinueDesignConversationRequest }>,
  reply: FastifyReply
): Promise<ContinueDesignConversationResponse> {
  const result = ContinueDesignConversationRequestSchema.safeParse(
    request.body
  );

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const {
      conversationId,
      userMessage,
      gameDescription,
      forceSpecGeneration,
    } = result.data;
    const response = await continueDesignConversation(
      conversationId,
      userMessage,
      gameDescription,
      forceSpecGeneration
    );

    // Expand narratives for API response
    const expandedSpec = expandSpecForAPI(response.specification, response.specNarratives);

    return {
      designResponse: response.designResponse,
      updatedTitle: response.updatedTitle,
      systemPromptVersion: response.systemPromptVersion,
      specification: expandedSpec,
      specDiff: response.specDiff,
      pendingSpecChanges: response.pendingSpecChanges,
      consolidationThreshold: response.consolidationThreshold,
      consolidationCharLimit: response.consolidationCharLimit,
    };
  } catch (error) {
    console.error("Error in continueDesignConversation:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGenerateImage(
  request: FastifyRequest<{ Body: GenerateImageRequest }>,
  reply: FastifyReply
): Promise<GenerateImageResponse> {
  const result = GenerateImageRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId, image_type } = result.data;
    const imageUrl = await generateImage(conversationId, image_type);

    return {
      imageUrl,
    };
  } catch (error) {
    console.error("Error in generateImage:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGetFullSpecification(
  request: FastifyRequest<{ Body: GetFullSpecificationRequest }>,
  reply: FastifyReply
): Promise<GetFullSpecificationResponse> {
  const result = GetFullSpecificationRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId } = result.data;
    const specification = await getFullDesignSpecification(conversationId);

    if (!specification) {
      reply.code(404).send({ error: "Specification not found" });
      return Promise.reject();
    }

    return {
      title: specification.title,
      summary: specification.summary,
      playerCount: specification.playerCount,
      designSpecification: specification.designSpecification,
      version: specification.version,
      pendingSpecChanges: specification.pendingSpecChanges,
      consolidationThreshold: specification.consolidationThreshold,
      consolidationCharLimit: specification.consolidationCharLimit,
    };
  } catch (error) {
    console.error("Error in getFullSpecification:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGetCachedSpecification(
  request: FastifyRequest<{ Body: GetFullSpecificationRequest }>,
  reply: FastifyReply
): Promise<GetFullSpecificationResponse> {
  const result = GetFullSpecificationRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId } = result.data;
    const specification = await getCachedDesignSpecification(conversationId);

    if (!specification?.specification) {
      reply.code(404).send({ error: "Specification not found" });
      return Promise.reject();
    }

    // Expand narratives for API response
    const expandedSpec = expandSpecForAPI(specification.specification, specification.specNarratives);

    return {
      title: expandedSpec.title,
      summary: expandedSpec.summary,
      playerCount: expandedSpec.playerCount,
      designSpecification: expandedSpec.designSpecification,
      version: expandedSpec.version,
      pendingSpecChanges: expandedSpec.pendingSpecChanges,
      consolidationThreshold: expandedSpec.consolidationThreshold,
      consolidationCharLimit: expandedSpec.consolidationCharLimit,
    };
  } catch (error) {
    console.error("Error in getCachedSpecification:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

export async function handleGetConversationHistory(
  request: FastifyRequest<{ Body: GetConversationHistoryRequest }>,
  reply: FastifyReply
): Promise<GetConversationHistoryResponse> {
  const result = GetConversationHistoryRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId, page, limit } = result.data;
    const history = await getConversationHistory(conversationId, page, limit);

    return history;
  } catch (error) {
    console.error("Error in getConversationHistory:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      reply.code(404).send({ error: "Conversation not found" });
    } else {
      reply.code(500).send({ error: "Internal server error" });
    }
    return Promise.reject();
  }
}

export async function handlePublishGame(
  request: FastifyRequest<{ Body: PublishGameRequest }>,
  reply: FastifyReply
): Promise<PublishGameResponse> {
  const result = PublishGameRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId, gameTitle, version, imageUrl, userId } =
      result.data;

    // Get the full game specification
    const specification = await getFullDesignSpecification(conversationId);

    if (!specification) {
      reply.code(404).send({ error: "Game specification not found" });
      return Promise.reject();
    }

    // Create PAIT token (same format as Discord version)
    const token = {
      game_title: gameTitle,
      game_specification: specification,
      spec_version: version,
      image_url: imageUrl,
    };

    // Upload to IPFS (reuse existing function)
    const ipfsHash = await uploadToIpfs(
      token,
      `PAIT_${userId}_${gameTitle.replace(/\s/g, "_")}`
    );

    return {
      ipfsHash,
      gameTitle,
      version,
    };
  } catch (error) {
    console.error("Error in publishGame:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}

/**
 * Trigger specification generation for a conversation
 * This bypasses the conversation node and forces spec generation
 */
export async function handleGenerateSpec(
  request: FastifyRequest<{ Body: GenerateSpecRequest }>,
  reply: FastifyReply
): Promise<GenerateSpecResponse> {
  const result = GenerateSpecRequestSchema.safeParse(request.body);

  if (!result.success) {
    reply.code(400).send({ error: "Invalid request", details: result.error });
    return Promise.reject();
  }

  try {
    const { conversationId } = result.data;

    // Check if conversation exists and has pending changes
    const isActive = await isActiveConversation(conversationId);
    if (!isActive) {
      reply.code(404).send({ error: "Conversation not found" });
      return Promise.reject();
    }

    // Trigger spec generation by calling continueDesignConversation
    // with forceSpecGeneration flag and empty message
    // Fire-and-forget - runs in background, app can poll for completion
    continueDesignConversation(
      conversationId,
      "", // Empty message - we're just forcing spec gen
      undefined, // No game description needed
      true // forceSpecGeneration
    ).catch((err) => {
      console.error(`[force-spec] Background generation error for conversation ${conversationId}:`, err);
    });

    return {
      message: "Specification generation started",
      specUpdateInProgress: true,
    };
  } catch (error) {
    console.error("Error in generateSpec:", error);
    reply.code(500).send({ error: "Internal server error" });
    return Promise.reject();
  }
}
