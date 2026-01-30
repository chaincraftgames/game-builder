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
} from "#chaincraft/api/design/schemas.js";
import {
  continueDesignConversation,
  generateImage,
  getCachedDesign,
  getConversationHistory,
  isActiveConversation,
} from "#chaincraft/ai/design/design-workflow.js";
import { expandSpecification } from "#chaincraft/ai/design/expand-narratives.js";

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
    const specification = await getCachedDesign(conversationId);

    // If no specification data at all, return 404
    if (!specification) {
      reply.code(404).send({ error: "Specification not found" });
      return Promise.reject();
    }

    // If specification exists but spec is missing, still return pending changes
    if (!specification.specification || !specification.specification.designSpecification) {
      return {
        title: specification.title || "Untitled Game",
        summary: "", // No summary until spec is generated
        // Don't return playerCount until spec is generated (it won't be accurate)
        designSpecification: "", // Empty until spec is generated
        version: 0, // Version 0 indicates spec hasn't been generated yet
        pendingSpecChanges: specification.pendingSpecChanges || [],
        consolidationThreshold: specification.consolidationThreshold,
        consolidationCharLimit: specification.consolidationCharLimit,
      };
    }

    // Expand narratives for API response
    const expandedSpec = expandSpecForAPI(specification.specification, specification.specNarratives);

    return {
      title: specification.title || "Untitled Game", // Title comes from specification wrapper, not the spec itself
      summary: expandedSpec.summary,
      playerCount: expandedSpec.playerCount,
      designSpecification: expandedSpec.designSpecification,
      version: expandedSpec.version || 1, // Default to 1 if version is missing
      pendingSpecChanges: expandedSpec.pendingSpecChanges || specification.pendingSpecChanges || [],
      consolidationThreshold: expandedSpec.consolidationThreshold || specification.consolidationThreshold,
      consolidationCharLimit: expandedSpec.consolidationCharLimit || specification.consolidationCharLimit,
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
