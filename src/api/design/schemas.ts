import { z } from "zod";

// Player count schema
export const PlayerCountSchema = z.object({
  min: z.number().min(1),
  max: z.number().min(1),
});

// Game specification schema
export const GameSpecificationSchema = z.object({
  summary: z.string(),
  playerCount: PlayerCountSchema,
  designSpecification: z.string(),
  version: z.number(),
});

// Design conversation schemas
export const ContinueDesignConversationRequestSchema = z.object({
  conversationId: z.string().min(1),
  userMessage: z.string().min(1).max(2000),
  gameDescription: z.string().optional(),

  /**
   * Spec updates are batched by default.  This forces the spec to be generated
   * immediately.
   */
  forceSpecGeneration: z.boolean().optional().default(false),
});

export const ContinueDesignConversationResponseSchema = z.object({
  designResponse: z.string(),
  updatedTitle: z.string().optional(),
  systemPromptVersion: z.string().optional(),
  specification: GameSpecificationSchema.optional(),
  specDiff: z.string().optional(),
  pendingSpecChanges: z
    .array(z.string())
    .optional()
    .describe(
      "Queued descriptions for spec changes not yet applied. Present when changes are batched."
    ),
  consolidationThreshold: z
    .number()
    .optional()
    .describe("Number of changes before auto-consolidation"),
  consolidationCharLimit: z
    .number()
    .optional()
    .describe("Character count threshold for auto-consolidation"),
});

// Generate spec schemas
export const GenerateSpecRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export const GenerateSpecResponseSchema = z.object({
  message: z.string(),
  specUpdateInProgress: z.boolean(),
});

// Generate image schemas
export const GenerateImageRequestSchema = z.object({
  conversationId: z.string().min(1),
  image_type: z.enum(["legacy", "raw"]).optional().default("legacy"),
});

export const GenerateImageResponseSchema = z.object({
  imageUrl: z.string(),
});

// Get full specification schemas
export const GetFullSpecificationRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export const GetFullSpecificationResponseSchema = z.object({
  title: z.string(),
  summary: z.string(),
  playerCount: PlayerCountSchema.optional(), // Optional when spec hasn't been generated yet
  designSpecification: z.string(),
  version: z.number(),
  pendingSpecChanges: z.array(z.string()).optional(),
  consolidationThreshold: z.number().optional(),
  consolidationCharLimit: z.number().optional(),
});

// Get conversation history schemas
export const GetConversationHistoryRequestSchema = z.object({
  conversationId: z.string().min(1),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(50),
});

export const MessageSchema = z.object({
  type: z.enum(["human", "ai", "system"]),
  content: z.string(),
  timestamp: z.string().optional(),
});

export const GetConversationHistoryResponseSchema = z.object({
  conversationId: z.string(),
  messages: z.array(MessageSchema),
  totalMessages: z.number(),
  page: z.number(),
  limit: z.number(),
  hasMore: z.boolean(),
});

// ─── Data Source configuration schemas ───────────────────────────────────────

/** Summary of a predefined data source (for listing). */
export const DataSourceSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  sourceType: z.enum(["blockchain", "http"]),
});

/** List available data sources (no request body needed). */
export const ListDataSourcesResponseSchema = z.object({
  dataSources: z.array(DataSourceSummarySchema),
});

/** Configure data sources for a design conversation. */
export const ConfigureDataSourcesRequestSchema = z.object({
  conversationId: z.string().min(1),
  dataSourceIds: z.array(z.string().min(1)).min(1)
    .describe("Array of predefined data source IDs to enable for this game"),
});

export const ConfigureDataSourcesResponseSchema = z.object({
  configured: z.array(DataSourceSummarySchema),
});

/** Get currently configured data sources for a design conversation. */
export const GetConfiguredDataSourcesRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export const GetConfiguredDataSourcesResponseSchema = z.object({
  dataSources: z.array(DataSourceSummarySchema),
});

// Type exports
export type PlayerCount = z.infer<typeof PlayerCountSchema>;
export type GameSpecification = z.infer<typeof GameSpecificationSchema>;
export type ContinueDesignConversationRequest = z.infer<
  typeof ContinueDesignConversationRequestSchema
>;
export type ContinueDesignConversationResponse = z.infer<
  typeof ContinueDesignConversationResponseSchema
>;
export type GenerateSpecRequest = z.infer<typeof GenerateSpecRequestSchema>;
export type GenerateSpecResponse = z.infer<typeof GenerateSpecResponseSchema>;
export type GenerateImageRequest = z.infer<typeof GenerateImageRequestSchema>;
export type GenerateImageResponse = z.infer<typeof GenerateImageResponseSchema>;
export type GetFullSpecificationRequest = z.infer<
  typeof GetFullSpecificationRequestSchema
>;
export type GetFullSpecificationResponse = z.infer<
  typeof GetFullSpecificationResponseSchema
>;
export type GetConversationHistoryRequest = z.infer<
  typeof GetConversationHistoryRequestSchema
>;
export type GetConversationHistoryResponse = z.infer<
  typeof GetConversationHistoryResponseSchema
>;
export type Message = z.infer<typeof MessageSchema>;
export type DataSourceSummary = z.infer<typeof DataSourceSummarySchema>;
export type ListDataSourcesResponse = z.infer<typeof ListDataSourcesResponseSchema>;
export type ConfigureDataSourcesRequest = z.infer<typeof ConfigureDataSourcesRequestSchema>;
export type ConfigureDataSourcesResponse = z.infer<typeof ConfigureDataSourcesResponseSchema>;
export type GetConfiguredDataSourcesRequest = z.infer<typeof GetConfiguredDataSourcesRequestSchema>;
export type GetConfiguredDataSourcesResponse = z.infer<typeof GetConfiguredDataSourcesResponseSchema>;