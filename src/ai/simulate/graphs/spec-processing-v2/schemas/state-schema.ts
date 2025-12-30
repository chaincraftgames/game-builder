/**
 * State Schema Planning/Execution Schemas
 * 
 * Defines the structure for schema planning and execution outputs.
 */

import { z } from "zod";

/**
 * Schema for wishlist items (fields needed but not yet in schema)
 */
export const SchemaWishlistItemSchema = z.object({
  name: z.string().describe("Field name (e.g., 'currentRoundDeadlyIndex')"),
  type: z.string().describe("Field type (e.g., 'number', 'string', 'boolean')"),
  parent: z.string().describe("Parent entity (e.g., 'game', 'players')"),
  description: z.string().describe("What this field stores"),
  reason: z.string().describe("Why this field is needed"),
});

/**
 * Condensed schema plan output
 */
export const SchemaPlanSchema = z.object({
  coreEntities: z.array(z.string()).describe("Main entities (game, players, etc.)"),
  keyFields: z.record(z.string()).describe("Map of essential field paths to types"),
  wishlist: z.array(SchemaWishlistItemSchema).describe("Additional fields needed"),
});

/**
 * Full detailed schema output (from execute phase)
 * TODO: Define complete schema structure
 */
export const StateSchemaSchema = z.any(); // Placeholder

export type SchemaWishlistItem = z.infer<typeof SchemaWishlistItemSchema>;
export type SchemaPlan = z.infer<typeof SchemaPlanSchema>;
