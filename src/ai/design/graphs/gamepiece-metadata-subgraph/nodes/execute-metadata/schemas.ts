/**
 * Zod schemas for gamepiece metadata structured output.
 * 
 * These schemas match schemas/gamepiece-metadata.schema.json and are used
 * with withStructuredOutput() for automatic LLM output validation.
 */

import { z } from "zod";

/**
 * Gamepiece instance schema - represents a specific gamepiece instance
 */
export const GamepieceInstanceSchema = z.object({
  id: z.string()
    .regex(/^[a-z][a-z0-9_]*$/, "Instance ID must be lowercase with underscores")
    .describe("Unique identifier for this instance (lowercase, underscores)"),
  name: z.string()
    .min(1)
    .describe("Human-readable name for this instance"),
  brief_description: z.string()
    .min(10)
    .describe("High-level description of this instance (1-2 sentences)"),
  needs_expansion: z.boolean()
    .describe("Flag indicating if this instance needs detailed content generation"),
  copy_count: z.number()
    .int()
    .positive()
    .default(1)
    .describe("Number of physical copies of this instance in the game (default: 1 for unique items)"),
});

export type GamepieceInstance = z.infer<typeof GamepieceInstanceSchema>;

/**
 * Gamepiece type schema - represents a type of gamepiece
 */
export const GamepieceTypeSchema = z.object({
  id: z.string()
    .regex(/^[a-z][a-z0-9_]*$/, "Type ID must be lowercase with underscores")
    .describe("Canonical identifier for this gamepiece type (lowercase, underscores)"),
  type: z.enum(["card", "token", "dice", "tile", "board", "space", "other"])
    .describe("Category of gamepiece"),
  quantity: z.number()
    .int()
    .positive()
    .describe("Total number of instances of this type"),
  description: z.string()
    .min(10)
    .describe("High-level description of this gamepiece type"),
  template: z.string()
    .optional()
    .describe("Optional reference to a standard template (e.g., 'standard_52_deck')"),
  instances: z.array(GamepieceInstanceSchema)
    .describe("Array of individual gamepiece instances"),
});

export type GamepieceType = z.infer<typeof GamepieceTypeSchema>;

/**
 * Complete gamepiece metadata schema
 */
export const GamepieceMetadataOutputSchema = z.object({
  gamepiece_types: z.array(GamepieceTypeSchema)
    .describe("Array of gamepiece types in the game (can be empty for games with no physical components)"),
});

export type GamepieceMetadataOutput = z.infer<typeof GamepieceMetadataOutputSchema>;

/**
 * Validation helper to check if metadata is complete
 */
export function validateMetadataCompleteness(metadata: GamepieceMetadataOutput): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  for (const type of metadata.gamepiece_types) {
    // Skip validation if using a standard template
    if (type.template) {
      continue;
    }
    
    // Calculate total copies from all instances
    const totalCopies = type.instances.reduce(
      (sum, inst) => sum + (inst.copy_count || 1),
      0
    );
    
    // Check that sum of copy_counts matches quantity
    if (totalCopies !== type.quantity) {
      errors.push(
        `Type "${type.id}" quantity is ${type.quantity} but sum of instance copy_counts is ${totalCopies}. ` +
        `These must match (each instance's copy_count represents how many physical copies exist).`
      );
    }
    
    // Check for duplicate instance IDs
    const instanceIds = new Set<string>();
    for (const instance of type.instances) {
      if (instanceIds.has(instance.id)) {
        errors.push(`Duplicate instance ID "${instance.id}" in type "${type.id}"`);
      }
      instanceIds.add(instance.id);
    }
  }
  
  // Check for duplicate type IDs
  const typeIds = new Set<string>();
  for (const type of metadata.gamepiece_types) {
    if (typeIds.has(type.id)) {
      errors.push(`Duplicate type ID "${type.id}"`);
    }
    typeIds.add(type.id);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
}
