/**
 * Central Zod Schemas for Game Design
 * 
 * This file serves as the single source of truth for all game design data structures.
 * All types are derived from these Zod schemas to ensure runtime validation matches
 * compile-time types. This eliminates drift between validation logic and type definitions.
 * 
 * Pattern:
 * 1. Define schema with .describe() for LLM-friendly documentation
 * 2. Add .refine() for complex validation rules
 * 3. Export schema for use in StructuredOutputParser
 * 4. Export derived type via z.infer<typeof Schema>
 */

import { z } from "zod";

/**
 * Player count range schema with validation.
 * Ensures max >= min and both are positive integers.
 */
export const PlayerCountSchema = z.object({
  min: z.number()
    .int()
    .positive()
    .describe("Minimum number of players"),
  max: z.number()
    .int()
    .positive()
    .describe("Maximum number of players"),
}).refine(
  data => data.max >= data.min,
  { message: "Maximum player count must be greater than or equal to minimum" }
);

export type PlayerCount = z.infer<typeof PlayerCountSchema>;

/**
 * Spec Plan schema - structured output from spec-plan agent.
 * Contains metadata and change plan for specification updates.
 */
export const SpecPlanSchema = z.object({
  summary: z.string()
    .describe("A concise 1-2 sentence description of the game concept"),
  playerCount: PlayerCountSchema
    .describe("The valid player count range for the game"),
  changes: z.string()
    .describe("Natural language plan describing what needs to change in the specification"),
});

export type SpecPlan = z.infer<typeof SpecPlanSchema>;

/**
 * Metadata Execution Chunk schema - defines a chunk for chunked execution.
 * Used when estimated gamepieces exceed token limits.
 */
export const MetadataExecutionChunkSchema = z.object({
  id: z.string()
    .describe("Unique identifier for this chunk (e.g., 'chunk_legendary', 'chunk_1_fire_spells')"),
  description: z.string()
    .describe("Natural language description of what this chunk should generate (e.g., '10 legendary creatures with 1 copy each')"),
  boundary: z.string()
    .describe("The semantic boundary for this chunk (e.g., 'legendary_rarity', 'fire_theme', 'creature_type')"),
  estimatedInstances: z.number()
    .int()
    .positive()
    .describe("Estimated number of unique gamepiece instances this chunk will generate"),
});

export type MetadataExecutionChunk = z.infer<typeof MetadataExecutionChunkSchema>;

/**
 * Metadata Execution Strategy schema - defines chunking strategy if needed.
 * Optional - only present when estimated gamepieces > 35.
 */
export const MetadataExecutionStrategySchema = z.object({
  chunks: z.array(MetadataExecutionChunkSchema)
    .describe("Array of chunks to process sequentially, each generating a subset of gamepieces"),
});

export type MetadataExecutionStrategy = z.infer<typeof MetadataExecutionStrategySchema>;

/**
 * Metadata Plan schema - structured output from plan-metadata agent.
 * Contains natural language plan and optional chunking strategy.
 */
export const MetadataPlanSchema = z.object({
  metadataChangePlan: z.string()
    .describe("Natural language plan describing what gamepiece metadata needs to be extracted or updated"),
  estimatedUniqueGamepieces: z.number()
    .int()
    .nonnegative()
    .describe("Estimated number of unique gamepiece instances that will be generated"),
  executionStrategy: MetadataExecutionStrategySchema
    .optional()
    .describe("Optional chunking strategy - only present when estimatedUniqueGamepieces > 35"),
});

export type MetadataPlan = z.infer<typeof MetadataPlanSchema>;

/**
 * Game Design Specification schema - complete game spec with metadata.
 * Combines summary, player count, version, and full markdown specification.
 */
export const GameDesignSpecificationSchema = z.object({
  summary: z.string()
    .describe("Brief summary of the game concept"),
  playerCount: PlayerCountSchema
    .describe("Valid player count range"),
  designSpecification: z.string()
    .describe("Complete game design specification in markdown format"),
  version: z.number()
    .int()
    .positive()
    .describe("Specification version number, incremented with each update"),
});

export type GameDesignSpecification = z.infer<typeof GameDesignSpecificationSchema>;

/**
 * Gamepiece Metadata schema - JSON Schema conformant gamepiece definitions.
 * Contains types, instances, and inventories for game entities.
 */
export const GamepieceMetadataSchema = z.object({
  gamepieceTypes: z.array(z.any())
    .optional()
    .describe("Array of gamepiece type definitions"),
  gamepieceInstances: z.array(z.any())
    .optional()
    .describe("Array of gamepiece instance definitions"),
  gamepieceInventories: z.array(z.any())
    .optional()
    .describe("Array of gamepiece inventory definitions"),
});

export type GamepieceMetadata = z.infer<typeof GamepieceMetadataSchema>;

/**
 * Validation Error schema - structured error information.
 * Used for reporting validation issues with severity levels.
 */
export const ValidationErrorSchema = z.object({
  field: z.string()
    .describe("Field name that failed validation"),
  message: z.string()
    .describe("Human-readable error message"),
  severity: z.enum(["error", "warning"])
    .describe("Severity level of the validation issue"),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;
