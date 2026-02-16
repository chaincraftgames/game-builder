/**
 * Planner Schemas for Instructions Extraction
 * 
 * Simplified version that outputs only semantic information the executor cannot derive.
 * Key differences from full planner:
 * - No stateChanges arrays (executor derives from schema structure)
 * - No templateVariables arrays (executor derives from stateDelta operations)
 * - No validation/computation structure metadata (executor decides based on mechanics complexity)
 * - Simplified messaging to purpose strings only (no structure flags)
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const PlayerActionHintSchema = z.object({
  id: z.string().describe("Stable identifier for the action (e.g., 'submit-move', 'vote')"),
  actionName: z.string().describe("Human-readable action name (e.g., 'Submit Move')"),
  mechanicsDescription: z.string().nullable().optional().describe(
    "Natural language description of game rules/mechanics. Include costs, constraints, effects. Null if purely administrative."
  ),
  requiresLLMValidation: z.boolean().default(false).describe(
    "True if action payload needs LLM semantic validation (free text, strategy). False if only structural checks needed."
  ),
  privateMessagePurpose: z.string().nullable().optional().describe("What private confirmation the player should receive (if any)."),
  publicMessagePurpose: z.string().nullable().optional().describe("What public announcement all players should see (if any)."),
});

export const AutomaticTransitionHintSchema = z.object({
  id: z.string().describe("Stable identifier (e.g., 'score-round', 'advance-round')"),
  transitionName: z.string().describe("Human-readable name (e.g., 'Score Round')"),
  mechanicsDescription: z.string().nullable().optional().describe(
    "Natural language description of game rules/mechanics. Include win conditions, scoring, trump rules. Null if purely state management."
  ),
  requiresLLMReasoning: z.boolean().default(false).describe(
    "True if LLM must apply game rules to determine outcomes. False if state changes are deterministic."
  ),
  usesRandomness: z.boolean().default(false).describe("True if involves random/probabilistic outcomes."),
  randomnessDescription: z.string().nullable().optional().describe(
    "What randomness is needed and how it's used. Include probability distributions, ranges."
  ),
  publicMessagePurpose: z.string().nullable().optional().describe("What public announcement all players should see (if any)."),
  privateMessagesPurpose: z.string().nullable().optional().describe("What individual private messages players should receive (if any)."),
});

export const PhaseInstructionsHintSchema = z.object({
  phase: z.string().describe("Phase identifier (must require player input)"),
  playerActions: z.array(PlayerActionHintSchema).describe("Player actions available in this phase"),
  phaseSummary: z.string().max(300).describe("Brief summary of what player input is needed"),
});

export const InstructionsPlanningResponseSchema = z.object({
  naturalLanguageSummary: z.string().describe("1-2 sentence summary of instruction structure"),
  playerPhases: z.array(PhaseInstructionsHintSchema).describe("Hints ONLY for phases requiring player input"),
  transitions: z.array(AutomaticTransitionHintSchema).describe("Hints for EACH automatic transition"),
  globalNotes: z.array(z.string()).optional().describe("Cross-cutting game rules (optional)"),
});

// Export types
export type PlayerActionHint = z.infer<typeof PlayerActionHintSchema>;
export type AutomaticTransitionHint = z.infer<typeof AutomaticTransitionHintSchema>;
export type PhaseInstructionsHint = z.infer<typeof PhaseInstructionsHintSchema>;
export type InstructionsPlanningResponse = z.infer<typeof InstructionsPlanningResponseSchema>;

// JSON schema exports for prompts
export const InstructionsPlanningResponseSchemaJson = zodToJsonSchema(
  InstructionsPlanningResponseSchema, 
  "InstructionsPlanningResponse"
);