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
});

export const ContinueDesignConversationResponseSchema = z.object({
  designResponse: z.string(),
  updatedTitle: z.string().optional(),
  systemPromptVersion: z.string().optional(),
  specification: GameSpecificationSchema.optional(),
  specDiff: z.string().optional(),
});

// Generate image schemas
export const GenerateImageRequestSchema = z.object({
  conversationId: z.string().min(1),
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
  playerCount: PlayerCountSchema,
  designSpecification: z.string(),
  version: z.number(),
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

// Get conversation metadata schemas
export const GetConversationMetadataRequestSchema = z.object({
  conversationId: z.string().min(1),
});

export const GetConversationMetadataResponseSchema = z.object({
  title: z.string(),
});

export const PublishGameRequestSchema = z.object({
  conversationId: z.string().min(1),
  gameTitle: z.string().min(1),
  version: z.number().min(1).default(1),
  imageUrl: z.string().optional(),
  userId: z.string().min(1),
});

export const PublishGameResponseSchema = z.object({
  ipfsHash: z.string(),
  gameTitle: z.string(),
  version: z.number(),
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
export type GetConversationMetadataRequest = z.infer<
  typeof GetConversationMetadataRequestSchema
>;
export type GetConversationMetadataResponse = z.infer<
  typeof GetConversationMetadataResponseSchema
>;
export type Message = z.infer<typeof MessageSchema>;
export type PublishGameRequest = z.infer<typeof PublishGameRequestSchema>;
export type PublishGameResponse = z.infer<typeof PublishGameResponseSchema>;
