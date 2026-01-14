import { FastifyInstance } from "fastify";
import {
  handleContinueDesignConversation,
  handleGenerateImage,
  handleGenerateSpec,
  handleGetFullSpecification,
  handleGetCachedSpecification,
  handleGetConversationHistory,
  handlePublishGame,
} from "./handler.js";
import {
  ContinueDesignConversationRequestSchema,
  ContinueDesignConversationResponseSchema,
  GenerateSpecRequestSchema,
  GenerateSpecResponseSchema,
  GenerateImageRequestSchema,
  GenerateImageResponseSchema,
  GetFullSpecificationRequestSchema,
  GetFullSpecificationResponseSchema,
  GetConversationHistoryRequestSchema,
  GetConversationHistoryResponseSchema,
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

  // Force spec generation (bypasses conversation)
  server.post("/conversation/generate-spec", {
    schema: {
      body: zodToJsonSchema(GenerateSpecRequestSchema, "generateSpecRequest"),
      response: {
        200: zodToJsonSchema(
          GenerateSpecResponseSchema,
          "generateSpecResponse"
        ),
      },
    },
    handler: handleGenerateSpec,
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
