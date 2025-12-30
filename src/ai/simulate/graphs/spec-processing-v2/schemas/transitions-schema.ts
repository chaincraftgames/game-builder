/**
 * Transitions Planning/Execution Schemas
 * 
 * Defines the structure for transitions planning and execution outputs.
 */

import { z } from "zod";

/**
 * Schema for wishlist items (fields/transitions needed)
 */
export const TransitionsWishlistItemSchema = z.object({
  type: z.enum(["field", "transition"]).describe("What is being requested"),
  name: z.string().describe("Field name or transition ID"),
  description: z.string().describe("What it does"),
  reason: z.string().describe("Why it's needed"),
});

/**
 * Condensed transitions plan output
 */
export const TransitionsPlanSchema = z.object({
  phaseFlow: z.string().describe("High-level phase sequence (e.g., 'init → round_active → finished')"),
  phases: z.array(z.string()).describe("List of phase names"),
  branchPoints: z.array(z.string()).describe("Key decision points where phases branch"),
  keyTransitions: z.array(z.object({
    id: z.string(),
    fromPhase: z.string(),
    toPhase: z.string(),
    summary: z.string(),
  })).describe("Essential transitions"),
  wishlist: z.array(TransitionsWishlistItemSchema).describe("Additional needs"),
});

/**
 * Full detailed transitions output (from execute phase)
 * TODO: Define complete transitions structure
 */
export const StateTransitionsSchema = z.any(); // Placeholder

export type TransitionsWishlistItem = z.infer<typeof TransitionsWishlistItemSchema>;
export type TransitionsPlan = z.infer<typeof TransitionsPlanSchema>;
