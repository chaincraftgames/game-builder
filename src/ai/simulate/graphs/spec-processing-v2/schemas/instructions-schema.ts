/**
 * Instructions Planning/Execution Schemas
 * 
 * Defines the structure for instructions planning and execution outputs.
 */

import { z } from "zod";

/**
 * Schema for wishlist items (clarifications/additions needed)
 */
export const InstructionsWishlistItemSchema = z.object({
  type: z.enum(["field", "transition", "clarification"]).describe("What is being requested"),
  description: z.string().describe("What is needed"),
  reason: z.string().describe("Why it's needed"),
  affectsPhase: z.string().optional().describe("Which phase this impacts"),
});

/**
 * Condensed instructions plan output
 */
export const InstructionsPlanSchema = z.object({
  phaseInstructions: z.record(z.string()).describe("Map of phase name to high-level instruction summary"),
  transitionInstructions: z.record(z.string()).describe("Map of transition ID to high-level instruction summary"),
  wishlist: z.array(InstructionsWishlistItemSchema).describe("Additional needs"),
});

/**
 * Full detailed instructions output (from execute phase)
 * TODO: Define complete instructions structure
 */
export const GameInstructionsSchema = z.any(); // Placeholder

export type InstructionsWishlistItem = z.infer<typeof InstructionsWishlistItemSchema>;
export type InstructionsPlan = z.infer<typeof InstructionsPlanSchema>;
