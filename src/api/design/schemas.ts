import { z } from 'zod';

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
});

// Type exports
export type PlayerCount = z.infer<typeof PlayerCountSchema>;
export type GameSpecification = z.infer<typeof GameSpecificationSchema>;
export type ContinueDesignConversationRequest = z.infer<typeof ContinueDesignConversationRequestSchema>;
export type ContinueDesignConversationResponse = z.infer<typeof ContinueDesignConversationResponseSchema>;
export type GenerateImageRequest = z.infer<typeof GenerateImageRequestSchema>;
export type GenerateImageResponse = z.infer<typeof GenerateImageResponseSchema>;
export type GetFullSpecificationRequest = z.infer<typeof GetFullSpecificationRequestSchema>;
export type GetFullSpecificationResponse = z.infer<typeof GetFullSpecificationResponseSchema>;

