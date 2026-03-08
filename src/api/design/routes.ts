import { FastifyInstance } from "fastify";
import {
  handleContinueDesignConversation,
  handleGenerateImage,
  handleGenerateSpec,
  handleGetCachedSpecification,
  handleGetConversationHistory,
  handleListDataSources,
  handleConfigureDataSources,
  handleGetConfiguredDataSources,
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
  ListDataSourcesResponseSchema,
  ConfigureDataSourcesRequestSchema,
  ConfigureDataSourcesResponseSchema,
  GetConfiguredDataSourcesRequestSchema,
  GetConfiguredDataSourcesResponseSchema,
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

  // ─── Data Source Endpoints ───────────────────────────────────────────

  // List all available predefined data sources
  server.get("/data-sources", {
    schema: {
      response: {
        200: zodToJsonSchema(
          ListDataSourcesResponseSchema,
          "listDataSourcesResponse"
        ),
      },
    },
    handler: handleListDataSources,
  });

  // Configure data sources for a design conversation
  server.post("/data-sources/configure", {
    schema: {
      body: zodToJsonSchema(
        ConfigureDataSourcesRequestSchema,
        "configureDataSourcesRequest"
      ),
      response: {
        200: zodToJsonSchema(
          ConfigureDataSourcesResponseSchema,
          "configureDataSourcesResponse"
        ),
      },
    },
    handler: handleConfigureDataSources,
  });

  // Get configured data sources for a design conversation
  server.post("/data-sources/configured", {
    schema: {
      body: zodToJsonSchema(
        GetConfiguredDataSourcesRequestSchema,
        "getConfiguredDataSourcesRequest"
      ),
      response: {
        200: zodToJsonSchema(
          GetConfiguredDataSourcesResponseSchema,
          "getConfiguredDataSourcesResponse"
        ),
      },
    },
    handler: handleGetConfiguredDataSources,
  });
}
