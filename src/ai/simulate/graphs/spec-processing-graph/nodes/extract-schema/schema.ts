import z from "zod";

/**
 * Planner field definition
 */
export interface PlannerField {
  name: string;
  type: string;
  path: 'game' | 'player';
  source: string;
  purpose: string;
  constraints?: string;
}

/**
 * JSON Schema validation for LLM structured output
 * 
 * PURPOSE: This is a DELIBERATE CONSTRAINT, not a bug.
 * 
 * This validator enforces a specific subset of JSON Schema Draft 7 that:
 * 1. The extract-schema LLM is instructed to generate (via prompts)
 * 2. Our buildFromJsonSchema() converter can handle (in schemaBuilder.ts)
 * 
 * WHY CONSTRAIN JSON SCHEMA?
 * - Game state schemas need simple, deterministic structures
 * - Limiting constructs improves LLM reliability and output consistency
 * - Reduces conversion complexity and potential runtime errors
 * - Makes debugging easier (fewer edge cases)
 * 
 * SUPPORTED CONSTRUCTS:
 * - type: object, array, string, number, boolean, integer, null
 * - properties: Fixed object properties
 * - additionalProperties: Dynamic key/value maps (records)
 * - items: Array element schemas
 * - required: Required field arrays
 * - enum: Enumerated string/number/null values
 * - description: Field documentation
 * 
 * EXPLICITLY NOT SUPPORTED (by design):
 * - $ref and definitions (prefer inlining)
 * - allOf, anyOf, oneOf (prefer explicit properties)
 * - patternProperties (use additionalProperties)
 * - Complex validation keywords (minLength, pattern, format, etc.)
 * 
 * MAINTENANCE:
 * If you add support for new constructs to buildFromJsonSchema(),
 * update this validator AND add test coverage in extract-schema.test.ts
 */
const jsonSchemaObjectSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    // Type can be single type or array of types (for nullable: ["string", "null"])
    type: z.union([
      z.enum(['object', 'array', 'string', 'number', 'boolean', 'integer', 'null']),
      z.array(z.enum(['object', 'array', 'string', 'number', 'boolean', 'integer', 'null']))
    ]).optional(),
    properties: z.record(jsonSchemaObjectSchema).optional(),
    additionalProperties: z.union([jsonSchemaObjectSchema, z.boolean()]).optional(),
    items: jsonSchemaObjectSchema.optional(),
    required: z.array(z.string()).optional(),
    // Enum can contain strings, numbers, or null
    enum: z.array(z.union([z.string(), z.number(), z.null()])).optional(),
    description: z.string().optional(),
  })
);

export const extractSchemaResponseSchema = z.object({
  gameRules: z.string().describe("A description of the game rules"),
  state: z
    .object({
      game: z
        .record(z.any())
        .describe(
          `Game-level state containing all shared game progress fields`
        ),
      players: z
        .record(z.any())
        .describe(`Map of player IDs to player state objects`),
    })
    .describe("Example of the initial game state structure"),
  stateSchema: jsonSchemaObjectSchema
    .describe(
      "JSON Schema definition for the game state (base schema extended with game-specific fields)"
    ),
});
