import z from "zod";

/**
 * Allowed primitive and container types for GameStateField.
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'record' | 'object';

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
  /** Sub-fields when type is 'object' (max 1 level of nesting) */
  fields?: GameStateField[];
  /** Default true if omitted */
  required?: boolean;
  /** Router-managed field — excluded from mechanic return types, filtered at runtime */
  systemControlled?: boolean;

  // Legacy fields (kept optional for backward-compat with stored schemas)
  /** @deprecated No longer produced; ignored by all consumers */
  source?: string;
  /** @deprecated No longer produced; ignored by all consumers */
  constraints?: string;
}

/**
 * Zod schema matching GameStateField — used to validate LLM structured output.
 */
export const fieldTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'array', 'record', 'object']);

/** Zod schema for sub-fields inside an object type (no further nesting allowed). */
const objectSubFieldSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'record']),
  path: z.enum(['game', 'player']),
  purpose: z.string(),
  enumValues: z.array(z.string()).optional(),
  valueType: z.enum(['string', 'number', 'boolean', 'enum', 'array', 'record']).optional(),
  required: z.boolean().optional(),
}).superRefine((field, ctx) => {
  if ((field.type === 'array' || field.type === 'record') && field.valueType == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valueType'],
      message: `"valueType" is required when "type" is "${field.type}" (sub-field "${field.name}").`,
    });
  }
});

export const gameStateFieldSchema = z.object({
  name: z.string(),
  type: fieldTypeSchema,
  path: z.enum(['game', 'player']),
  purpose: z.string(),
  enumValues: z.array(z.string()).optional(),
  valueType: fieldTypeSchema.optional(),
  fields: z.array(objectSubFieldSchema).optional(),
  required: z.boolean().optional(),
  systemControlled: z.boolean().optional(),
}).superRefine((field, ctx) => {
  // valueType is required when type is 'array' or 'record' — without it, the
  // interface generator produces 'unknown[]' / 'Record<string, unknown>' and
  // every mechanic that reads the field will fail tsc with TS2304.
  if ((field.type === 'array' || field.type === 'record') && field.valueType == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['valueType'],
      message: `"valueType" is required when "type" is "${field.type}". ` +
        `Specify the element/value type (e.g. "string", "number", "object").`,
    });
  }

  // fields is required when type is 'object' — without it the interface generator
  // produces 'Record<string, unknown>' instead of a typed interface.
  if (field.type === 'object' && (field.fields == null || field.fields.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fields'],
      message: `"fields" is required (and must be non-empty) when "type" is "object". ` +
        `Describe the known sub-fields of this structured object.`,
    });
  }

  // fields is required when valueType is 'object' — without it the interface
  // generator cannot produce a typed sub-interface and falls back to 'unknown[]',
  // causing compile errors in every mechanic that reads array elements.
  if (field.valueType === 'object' && (field.fields == null || field.fields.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fields'],
      message: `"fields" is required (and must be non-empty) when "valueType" is "object". ` +
        `Describe the sub-fields of each array element (e.g. id, name, value).`,
    });
  }
});

/** Field names that are always system-controlled (router-managed). */
export const SYSTEM_CONTROLLED_FIELDS: ReadonlySet<string> = new Set([
  'currentPhase',
  'gameEnded',
]);


