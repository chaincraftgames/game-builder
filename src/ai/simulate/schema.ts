import { z } from "zod";

import {
  SchemaField,
  buildStateSchema,
  JSONSchemaObject,
} from "#chaincraft/ai/simulate/schemaBuilder.js";
import { SimulationStateType } from "#chaincraft/ai/simulate/simulate-state.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StateDeltaOpSchema } from "#chaincraft/ai/simulate/logic/statedelta.js";
import { validateJsonLogicOperations } from "#chaincraft/ai/simulate/logic/jsonlogic.js";

// Runtime version - bump when extensions change
export const RUNTIME_VERSION = "1.0";

const runtimePlayerStateSchema = z.object({
  illegalActionCount: z
    .number()
    .default(0)
    .describe("Number of illegal actions taken by the player"),
  privateMessage: z.string().optional().describe(`
Private message to the player. Should only be used to communicate information that  
a) ABSOLUTELY CANNOT be included in the public message
b) contains EXCLUSIVELY player-specific information that others should never see
c) would break the game or violate fairness without this specific private message
    `),
  actionsAllowed: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Whether the player is currently allowed to take actions. If omitted, defaults to match actionRequired. Only set explicitly for games with optional actions."
    ),
  actionRequired: z
    .boolean()
    .default(false)
    .describe(
      "If true, the game cannot proceed to the next turn or phase until this player takes an action."
    ),
});

export const baseGameStateSchema = z.object({
  game: z
    .object({
      currentPhase: z
        .string()
        .describe(
          "Current phase (round, turn, etc.) of the game (must match a phase from transitions artifact)"
        ),
      gameEnded: z
        .boolean()
        .default(false)
        .describe("Whether the game has ended"),
      gameError: z
        .object({
          errorType: z.enum([
            "deadlock",
            "invalid_state",
            "rule_violation",
            "transition_failed",
          ]),
          errorMessage: z.string().describe("Human-readable error description"),
          errorContext: z
            .any()
            .optional()
            .describe("Additional context for debugging"),
          timestamp: z.string().describe("ISO timestamp when error occurred"),
        })
        .nullish()
        .describe("Error state if game encountered a fatal error (omit or set null when no error)"),
      publicMessage: z
        .string()
        .optional()
        .describe("Public game state, instructions, etc... to all players"),
    })
    .describe(`Game-level state containing all shared game progress fields`),
  players: z
    .record(runtimePlayerStateSchema)
    .describe(`Map of player IDs to player state objects`),
});

export const baseGameStateSchemaJson = JSON.stringify(
  zodToJsonSchema(baseGameStateSchema, "gameState")
);

export type RuntimePlayerState = z.infer<typeof runtimePlayerStateSchema>;
export type BaseRuntimeState = z.infer<typeof baseGameStateSchema>;

/**
 * JsonLogic validator that checks for supported operations
 */
const JsonLogicValidator = z
  .any()
  .nullable()
  .superRefine((val, ctx) => {
    if (val === null) return; // null is allowed for non-deterministic

    const unsupportedOps = validateJsonLogicOperations(val);
    if (unsupportedOps.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported JsonLogic operations: ${unsupportedOps.join(
          ", "
        )}. Only standard json-logic-js operations are allowed: ==, !=, >, <, >=, <=, and, or, !, if, +, -, *, /, %, max, min, map, filter, all, none, some, merge, in, cat, substr, var, missing, missing_some, log`,
      });
    }
  });

export const TransitionPreconditionSchema = z.object({
  id: z
    .string()
    .describe("Stable id for the precondition, e.g. 'allSubmitted'"),
  logic: JsonLogicValidator.describe(
    "JsonLogic predicate object or null for non-deterministic/custom checks"
  ),
  deterministic: z
    .boolean()
    .describe(
      "Whether this predicate can be evaluated deterministically by the router"
    ),
  explain: z
    .string()
    .max(500)
    .describe(
      "One-line explanation of the predicate purpose for auditing/debugging. Aim for under 200 chars but may use up to 500 for complex mechanics."
    ),
});

export const TransitionSchema = z.object({
  id: z
    .string()
    .describe("Stable id for the transition, e.g. 'end-round-on-submissions'"),
  fromPhase: z.string().describe("Phase name this transition originates from"),
  toPhase: z.string().describe("Target phase name after transition"),
  // Human-readable short condition (for debugging); router should rely on `preconditions`.
  condition: z
    .string()
    .optional()
    .describe("Short human-readable description of the condition"),
  // Exact fields to check (dot-paths). Support simple wildcard like players[*].submittedMove
  checkedFields: z
    .array(z.string())
    .describe(
      "Exact dot-path fields the router should inspect; allow simple '[*]' wildcard"
    ),
  // Preconditions expressed as JsonLogic objects and metadata
  preconditions: z
    .array(TransitionPreconditionSchema)
    .describe(
      "Array of preconditions. Prefer deterministic JsonLogic predicates when possible."
    ),
  humanSummary: z
    .string()
    .optional()
    .describe("One-line human-friendly summary of this transition"),
});

export const PhaseMetadataSchema = z.object({
  phase: z.string().describe("Phase name/identifier"),
  requiresPlayerInput: z
    .boolean()
    .describe("Whether this phase requires player input/actions to proceed"),
});

export const TransitionsArtifactSchema = z.object({
  phases: z.array(
    z
      .string()
      .describe(
        'An identifier for a game state such as "bidding, playing, day/night phase, scoring".  Phases may be visited multiple times during gameplay'
      )
  ),
  phaseMetadata: z
    .array(PhaseMetadataSchema)
    .describe(
      "Metadata for each phase indicating whether it requires player input"
    ),
  transitions: z
    .array(TransitionSchema)
    .describe("List of transitions for the game"),
});

export type TransitionPrecondition = z.infer<
  typeof TransitionPreconditionSchema
>;
export type Transition = z.infer<typeof TransitionSchema>;
export type PhaseMetadata = z.infer<typeof PhaseMetadataSchema>;
export type TransitionsArtifact = z.infer<typeof TransitionsArtifactSchema>;
export const TransitionsArtifactSchemaJson = zodToJsonSchema(
  TransitionsArtifactSchema,
  "TransitionsArtifact"
);

// ============================================================================
// INSTRUCTIONS ARTIFACT SCHEMAS
// ============================================================================

/**
 * Message template with potential template variables
 */
export const MessageTemplateSchema = z.object({
  to: z
    .string()
    .optional()
    .describe("Target player ID or {{template}} variable for private messages"),
  template: z
    .string()
    .describe("Message template with {{variables}} to be resolved at runtime"),
});

/**
 * Mechanics guidance for LLM to apply game rules
 */
export const MechanicsGuidanceSchema = z.object({
  rules: z
    .array(z.string())
    .describe(
      "Ordered list of game rules/mechanics to apply (e.g., ['Rock beats scissors', 'Scissors beats paper', 'Paper beats rock'])"
    ),
  computation: z
    .string()
    .optional()
    .describe(
      "Description of what needs to be computed/decided using these rules"
    ),
});

/**
 * RNG configuration for instructions involving randomness
 */
export const RngConfigSchema = z.object({
  operations: z
    .array(z.string())
    .describe(
      "List of random operations needed (e.g., ['event_type', 'severity_roll', 'affected_player'])"
    ),
  guidance: z
    .string()
    .optional()
    .describe("Additional guidance on how randomness should be applied"),
});

/**
 * JsonLogic validation configuration
 * Array of named precondition checks with embedded error messages for explicit mapping
 */
export const PreconditionCheckSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable identifier for this check (e.g., 'wrongPhase', 'invalidChoice')"
    ),
  logic: z
    .any()
    .describe("JsonLogic expression - should evaluate to true if check passes"),
  errorMessage: z
    .string()
    .describe(
      "Error message to return if this check fails (logic evaluates to false)"
    ),
});

export const ValidationConfigSchema = z.object({
  checks: z
    .array(PreconditionCheckSchema)
    .describe(
      "Ordered array of precondition checks. First check that fails determines the error message returned."
    ),
});

/**
 * Player action instruction
 */
export const PlayerActionInstructionSchema = z.object({
  id: z.string().describe("Stable identifier matching hint id"),
  actionName: z.string().describe("Human-readable action name"),
  description: z.string().describe("Brief description"),

  // Optional validation
  validation: ValidationConfigSchema.nullable().optional().describe(
    "JsonLogic preconditions and error messages"
  ),

  // Optional mechanics guidance
  mechanicsGuidance: MechanicsGuidanceSchema.nullable().optional().describe(
    "Game rules/mechanics for LLM to apply (only if action involves game logic)"
  ),

  // State changes (may contain {{templates}})
  stateDelta: z
    .array(StateDeltaOpSchema)
    .describe(
      "Array of stateDelta operations, may contain {{template}} variables"
    ),

  // Messages (may contain {{templates}})
  messages: z
    .object({
      private: z.array(MessageTemplateSchema).nullable().optional(),
      public: MessageTemplateSchema.nullable().optional(),
    })
    .nullable()
    .optional(),

  // Documentation fields (not used at runtime for slicing)
  requiredStateFields: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      "Documentation of state fields needed (full state always provided)"
    ),
});

/**
 * Automatic transition instruction
 */
export const AutomaticTransitionInstructionSchema = z.object({
  id: z.string().describe("Stable identifier matching hint id"),
  transitionName: z.string().describe("Human-readable transition name"),
  description: z.string().describe("Brief description"),
  priority: z
    .number()
    .describe("Order to check transitions (lower = checked first)"),

  // Optional mechanics guidance (for computing winners, outcomes, etc.)
  mechanicsGuidance: MechanicsGuidanceSchema.nullable().optional().describe(
    "Game rules/mechanics for LLM to apply"
  ),

  // Optional RNG configuration
  rngConfig: RngConfigSchema.nullable().optional().describe(
    "Random number generation requirements"
  ),

  // State changes (may contain {{templates}})
  stateDelta: z
    .array(StateDeltaOpSchema)
    .describe(
      "Array of stateDelta operations, may contain {{template}} variables"
    ),

  // Messages (may contain {{templates}})
  messages: z
    .object({
      private: z.array(MessageTemplateSchema).nullable().optional(),
      public: MessageTemplateSchema.nullable().optional(),
    })
    .nullable()
    .optional(),

  // Documentation fields
  requiredStateFields: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      "Documentation of state fields needed (full state always provided)"
    ),
});

/**
 * Instructions for a player input phase
 */
export const PlayerPhaseInstructionsSchema = z.object({
  phase: z.string().describe("Phase identifier (must require player input)"),

  playerActions: z
    .array(PlayerActionInstructionSchema)
    .describe("Available player actions in this phase"),
});

/**
 * Complete instructions artifact with flat structure
 * Instructions are separated by type and keyed appropriately:
 * - playerPhases: Map of phase name -> instructions (only for phases requiring player input)
 * - transitions: Map of transition ID -> instructions (for all automatic transitions)
 */
export const InstructionsArtifactSchema = z.object({
  version: z.string().describe("Artifact version (e.g., '1.0.0')"),
  generatedAt: z.string().describe("ISO timestamp of generation"),

  playerPhases: z
    .record(PlayerPhaseInstructionsSchema)
    .describe(
      "Map of phase name to instructions for phases that require player input"
    ),

  transitions: z
    .record(AutomaticTransitionInstructionSchema)
    .describe(
      "Map of transition ID to instructions for all automatic transitions"
    ),

  metadata: z.object({
    totalPlayerPhases: z
      .number()
      .describe("Number of phases with player input"),
    totalTransitions: z.number().describe("Number of automatic transitions"),
    deterministicInstructionCount: z
      .number()
      .describe("Instructions with no {{templates}}"),
    llmDrivenInstructionCount: z
      .number()
      .describe("Instructions requiring LLM resolution"),
  }),
});

// Export instruction types
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;
export type MechanicsGuidance = z.infer<typeof MechanicsGuidanceSchema>;
export type RngConfig = z.infer<typeof RngConfigSchema>;
export type PreconditionCheck = z.infer<typeof PreconditionCheckSchema>;
export type ValidationConfig = z.infer<typeof ValidationConfigSchema>;
export type PlayerActionInstruction = z.infer<
  typeof PlayerActionInstructionSchema
>;
export type AutomaticTransitionInstruction = z.infer<
  typeof AutomaticTransitionInstructionSchema
>;
export type PlayerPhaseInstructions = z.infer<
  typeof PlayerPhaseInstructionsSchema
>;
export type InstructionsArtifact = z.infer<typeof InstructionsArtifactSchema>;

// Instruction JSON schemas for prompt injection
export const PlayerActionInstructionSchemaJson = zodToJsonSchema(
  PlayerActionInstructionSchema,
  "PlayerActionInstruction"
);
export const AutomaticTransitionInstructionSchemaJson = zodToJsonSchema(
  AutomaticTransitionInstructionSchema,
  "AutomaticTransitionInstruction"
);
export const PlayerPhaseInstructionsSchemaJson = zodToJsonSchema(
  PlayerPhaseInstructionsSchema,
  "PlayerPhaseInstructions"
);
export const InstructionsArtifactSchemaJson = zodToJsonSchema(
  InstructionsArtifactSchema,
  "InstructionsArtifact"
);

/**
 * Serialize schema (JSON Schema or legacy format)
 */
export function serializeSchema(schema: JSONSchemaObject | SchemaField[]): string {
  return JSON.stringify(schema);
}

/**
 * Reconstruct complete schema from serialized form
 * Supports both JSON Schema and legacy custom format
 */
export function deserializeSchema(schemaJson: string): z.ZodObject<any> {
  const parsed = JSON.parse(schemaJson);
  
  // Detect format: JSON Schema has "type" property, legacy has array with "name" properties
  const schema = Array.isArray(parsed) 
    ? parsed as SchemaField[]
    : parsed as JSONSchemaObject;
  
  const baseSchema = buildStateSchema(schema);

  if (!(baseSchema instanceof z.ZodObject)) {
    throw new Error("Schema must be a ZodObject");
  }

  return baseSchema;
}

