import { FastifyRequest, FastifyReply } from "fastify";
import {
  ContinueDesignConversationRequest,
  ContinueDesignConversationRequestSchema,
  ContinueDesignConversationResponse,
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
import { uploadToIpfs } from "#chaincraft/integrations/storage/pinata.js";

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

    return {
      designResponse: response.designResponse,
      updatedTitle: response.updatedTitle,
      systemPromptVersion: response.systemPromptVersion,
      specification: response.specification,
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
