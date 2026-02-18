import { z } from "zod";

// Runtime player state schema
export const RuntimePlayerStateSchema = z.object({
  illegalActionCount: z.number().min(0),
  privateMessage: z.string().optional(),
  actionsAllowed: z.boolean(),
  actionRequired: z.boolean(),
  isGameWinner: z.boolean(),
});

// Player states schema (Map serialized as object)
export const PlayerStatesSchema = z.record(
  z.string(),
  RuntimePlayerStateSchema
);

// Simulation response schema
export const SimResponseSchema = z.object({
  publicMessage: z.string().optional(),
  playerStates: PlayerStatesSchema,
  gameEnded: z.boolean(),
  winningPlayers: z.array(z.string()).optional(), // Array of player IDs who won the game
  gameError: z
    .object({
      errorType: z.enum([
        "deadlock",
        "invalid_state",
        "rule_violation",
        "transition_failed",
      ]),
      errorMessage: z.string(),
      errorContext: z.any().optional(),
      timestamp: z.string(),
    })
    .optional(),
});

// Create simulation schemas
export const CreateSimulationRequestSchema = z.object({
  sessionId: z.string().min(1), // Session ID where artifacts are stored (e.g., "sim-xxx")
  gameSpecificationVersion: z.number().min(1).optional(), // Optional - if omitted, uses latest version from design workflow
  gameSpecification: z.string().min(1).optional(), // Optional override - if not provided, retrieves from design workflow
  gameId: z.string().min(1).optional(), // Optional - game ID (conversationId) to fetch spec from design workflow. If not provided, uses sessionId (backward compatibility)
  atomicArtifactRegen: z.boolean().optional(), // Optional - whether to require atomic artifact regen (default true)
});

export const CreateSimulationResponseSchema = z.object({
  gameRules: z.string(),
  /** Key is token type, value is token description. */
  producedTokens: z.record(z.string()).optional(), 
});

// Initialize simulation schemas
export const InitializeSimulationRequestSchema = z.object({
  gameId: z.string().min(1),
  players: z.array(z.string().min(1)).min(1),
});

export const InitializeSimulationResponseSchema = z.object({
  publicMessage: z.string().optional(),
  playerStates: PlayerStatesSchema,
});

// Process action schemas
export const ProcessActionRequestSchema = z.object({
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  action: z.string().min(1),
});

export const ProcessActionResponseSchema = SimResponseSchema;

// Get simulation state schemas
export const GetSimulationStateRequestSchema = z.object({
  gameId: z.string().min(1),
});

export const GetSimulationStateResponseSchema = SimResponseSchema;

// Type exports
export type RuntimePlayerState = z.infer<typeof RuntimePlayerStateSchema>;
export type PlayerStates = z.infer<typeof PlayerStatesSchema>;
export type SimResponse = z.infer<typeof SimResponseSchema>;
export type CreateSimulationRequest = z.infer<
  typeof CreateSimulationRequestSchema
>;
export type CreateSimulationResponse = z.infer<
  typeof CreateSimulationResponseSchema
>;
export type InitializeSimulationRequest = z.infer<
  typeof InitializeSimulationRequestSchema
>;
export type InitializeSimulationResponse = z.infer<
  typeof InitializeSimulationResponseSchema
>;
export type ProcessActionRequest = z.infer<typeof ProcessActionRequestSchema>;
export type ProcessActionResponse = z.infer<typeof ProcessActionResponseSchema>;
export type GetSimulationStateRequest = z.infer<
  typeof GetSimulationStateRequestSchema
>;
export type GetSimulationStateResponse = z.infer<
  typeof GetSimulationStateResponseSchema
>;

export const ProduceTokenRequestSchema = z.object({
  sessionId: z.string().min(1),
  tokenType: z.string().min(1),
  playerId: z.string().min(1), // Optional - if token is player-specific, provide playerId
});

export type ProduceTokenRequest = z.infer<typeof ProduceTokenRequestSchema>;

export const TokenMetadataSchema = z.object({
  tokenType: z.string(),
  gameId: z.string().min(1),
  gameVersion: z.number().min(1),
});

export const ProduceTokenResponseSchema = z.object({
  metadata: TokenMetadataSchema,
  data: z.record(z.string(), z.any()), // Arbitrary key-value pairs representing token data
});

export type ProduceTokenResponse = z.infer<typeof ProduceTokenResponseSchema>;

// Generate token image schemas
export const GenerateTokenImageRequestSchema = z.object({
  sessionId: z.string().min(1),
  token: ProduceTokenResponseSchema,
});

export type GenerateTokenImageRequest = z.infer<typeof GenerateTokenImageRequestSchema>;

export const GenerateTokenImageResponseSchema = z.object({
  imageUrl: z.string(),
  tokenType: z.string(),
  metadata: TokenMetadataSchema,
});

export type GenerateTokenImageResponse = z.infer<typeof GenerateTokenImageResponseSchema>;
