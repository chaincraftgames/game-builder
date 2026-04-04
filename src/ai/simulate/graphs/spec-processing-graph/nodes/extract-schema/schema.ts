import z from "zod";

/**
 * Allowed primitive and container types for GameStateField.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'record';

/**
 * Game state field definition.
 * Describes a single field in the game state schema (game-level or player-level).
 */
export interface GameStateField {
  name: string;
  type: FieldType;
  path: 'game' | 'player';
  purpose: string;
  /** When type or valueType is 'enum' */
  enumValues?: string[];
  /** Inner type when type is 'array' or 'record' */
  valueType?: FieldType;
  /** Default true if omitted */
  required?: boolean;

  // Legacy fields (kept optional for backward-compat with stored schemas)
  /** @deprecated No longer produced; ignored by all consumers */
  source?: string;
  /** @deprecated No longer produced; ignored by all consumers */
  constraints?: string;
}

/**
 * Zod schema matching GameStateField — used to validate LLM structured output.
 */
export const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'array', 'record']);

export const gameStateFieldSchema = z.object({
  name: z.string(),
  type: fieldTypeSchema,
  path: z.enum(['game', 'player']),
  purpose: z.string(),
  enumValues: z.array(z.string()).optional(),
  valueType: fieldTypeSchema.optional(),
  required: z.boolean().optional(),
});


