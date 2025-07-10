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
} from "#chaincraft/api/design/schemas.js";
import {
  continueDesignConversation,
  generateImage,
  getFullDesignSpecification,
  getConversationHistory,
  isActiveConversation,
} from "#chaincraft/ai/design/design-workflow.js";

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
    const { conversationId, userMessage, gameDescription } = result.data;
    const response = await continueDesignConversation(
      conversationId,
      userMessage,
      gameDescription
    );

    return {
      designResponse: response.designResponse,
      updatedTitle: response.updatedTitle,
      systemPromptVersion: response.systemPromptVersion,
      specification: response.specification,
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
    const { conversationId } = result.data;
    const imageUrl = await generateImage(conversationId);

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
    };
  } catch (error) {
    console.error("Error in getFullSpecification:", error);
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
    const { conversationId } = result.data;
    const history = await getConversationHistory(conversationId);

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
