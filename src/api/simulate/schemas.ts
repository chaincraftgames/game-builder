import { z } from "zod";

// Runtime player state schema
export const RuntimePlayerStateSchema = z.object({
  illegalActionCount: z.number().min(0),
  privateMessage: z.string().optional(),
  actionsAllowed: z.boolean(),
  actionRequired: z.boolean(),
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
  winner: z.union([z.string(), z.array(z.string()), z.null()]).optional(), // Player ID(s) who won, null for tie/no winner, undefined if game hasn't ended
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
});

export const CreateSimulationResponseSchema = z.object({
  gameRules: z.string(),
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

// Update simulation schemas
export const UpdateSimulationRequestSchema = z.object({
  gameId: z.string().min(1),
  gameSpecification: z.string().min(1),
});

export const UpdateSimulationResponseSchema = z.object({
  success: z.boolean(),
});

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
export type UpdateSimulationRequest = z.infer<
  typeof UpdateSimulationRequestSchema
>;
export type UpdateSimulationResponse = z.infer<
  typeof UpdateSimulationResponseSchema
>;
