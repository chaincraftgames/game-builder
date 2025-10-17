import { FastifyInstance } from "fastify";
import {
  handleContinueDesignConversation,
  handleGenerateImage,
  handleGetFullSpecification,
  handleGetCachedSpecification,
  handleGetConversationHistory,
  handleGetConversationMetadata,
  handlePublishGame,
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
  GetConversationMetadataRequestSchema,
  GetConversationMetadataResponseSchema,
  PublishGameRequestSchema,
  PublishGameResponseSchema,
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

  // Generate image for game design (supports both legacy cartridge and raw image types)
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

  // Get cached specification (no recomputation)
  server.post("/conversation/specification/cached", {
    schema: {
      body: zodToJsonSchema(
        GetFullSpecificationRequestSchema,
        "getCachedSpecificationRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetFullSpecificationResponseSchema,
          "getCachedSpecificationResponse"
        ),
      },
    },
    handler: handleGetCachedSpecification,
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

  // Get conversation metadata (title, etc.) without creating checkpoints
  server.post("/conversation/metadata", {
    schema: {
      body: zodToJsonSchema(
        GetConversationMetadataRequestSchema,
        "getConversationMetadataRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetConversationMetadataResponseSchema,
          "getConversationMetadataResponse"
        ),
      },
    },
    handler: handleGetConversationMetadata,
  });

  // Publish game to IPFS
  server.post("/publish", {
    schema: {
      body: zodToJsonSchema(PublishGameRequestSchema, "publishGameRequest"),
      response: {
        200: zodToJsonSchema(PublishGameResponseSchema, "publishGameResponse"),
      },
    },
    handler: handlePublishGame,
  });
}
