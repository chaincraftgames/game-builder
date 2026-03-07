import { z } from "zod";
import { StateDeltaOpSchema } from "#chaincraft/ai/simulate/logic/statedelta.js";

/**
 * Schema for execute-changes LLM response
 * 
 * The LLM should return:
 * 1. stateDelta: Array of resolved stateDelta operations (all templates resolved)
 * 2. rationale: Brief explanation of what was computed (for debugging/auditing)
 * 3. publicMessage: Optional public message if instructions specify one
 * 4. privateMessages: Optional map of playerId -> private message
 */
export const executeChangesResponseSchema = z.object({
  rationale: z.string().describe(
    "Brief explanation of what was computed (mechanics applied, templates resolved, etc.)"
  ),
  
  stateDelta: z.array(StateDeltaOpSchema).describe(
    "Array of state delta operations with ALL template variables resolved to literal values"
  ),
  
  publicMessage: z.string().optional().describe(
    "Public message to all players (only if instructions specify a public message)"
  ),
  
  privateMessages: z.record(z.string()).optional().describe(
    "Map of player IDs to private messages (only if instructions specify private messages)"
  ),

  imagePrompt: z.string().optional().describe(
    "Image generation prompt derived from imageContentSpec in transition instructions. " +
    "Only include when the instructions contain a non-null imageContentSpec. " +
    "Should be a detailed, visual description incorporating resolved template values (names, outcomes, etc.) " +
    "suitable for an AI image generator. Omit entirely if instructions have no imageContentSpec."
  ),
});

export type ExecuteChangesResponse = z.infer<typeof executeChangesResponseSchema>;
