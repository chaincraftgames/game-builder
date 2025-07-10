import { FastifyInstance } from "fastify";
import {
  handleContinueDesignConversation,
  handleGenerateImage,
  handleGetFullSpecification,
  handleGetConversationHistory,
} from "./handler.js";
import {
  ContinueDesignConversationRequestSchema,
  ContinueDesignConversationResponseSchema,
  GenerateImageRequestSchema,
  GenerateImageResponseSchema,
  GetFullSpecificationRequestSchema,
  GetFullSpecificationResponseSchema,
  GetConversationHistoryRequestSchema,
  GetConversationHistoryResponseSchema,
} from "#chaincraft/api/design/schemas.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export async function registerDesignRoutes(server: FastifyInstance) {
  // Continue design conversation
  server.post("/conversation/continue", {
    schema: {
      body: zodToJsonSchema(
        ContinueDesignConversationRequestSchema,
        "continueDesignConversationRequest"
      ),
      response: {
        200: zodToJsonSchema(
          ContinueDesignConversationResponseSchema,
          "continueDesignConversationResponse"
        ),
      },
    },
    handler: handleContinueDesignConversation,
  });

  // Generate image for game design
  server.post("/conversation/generate-image", {
    schema: {
      body: zodToJsonSchema(GenerateImageRequestSchema, "generateImageRequest"),
      response: {
        200: zodToJsonSchema(
          GenerateImageResponseSchema,
          "generateImageResponse"
        ),
      },
    },
    handler: handleGenerateImage,
  });

  // Get full specification
  server.post("/conversation/specification", {
    schema: {
      body: zodToJsonSchema(
        GetFullSpecificationRequestSchema,
        "getFullSpecificationRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetFullSpecificationResponseSchema,
          "getFullSpecificationResponse"
        ),
      },
    },
    handler: handleGetFullSpecification,
  });

  // Get conversation history
  server.post("/conversation/history", {
    schema: {
      body: zodToJsonSchema(
        GetConversationHistoryRequestSchema,
        "getConversationHistoryRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetConversationHistoryResponseSchema,
          "getConversationHistoryResponse"
        ),
      },
    },
    handler: handleGetConversationHistory,
  });
}
