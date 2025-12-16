/**
 * Schemas for Instructions Extraction Node - Planner Only
 * 
 * Contains planner schemas (high-level hints about what instructions are needed).
 * 
 * The executor output schemas (actual instruction artifacts) are in:
 * src/ai/simulate/schema.ts (InstructionsArtifact and related types)
 * 
 * The planner identifies what instructions are needed for each phase.
 * The executor then generates the actual templated stateDelta operations and messages.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Planner's assessment of a player action instruction
 */
export const PlayerActionHintSchema = z.object({
  id: z.string().describe("Stable identifier for the action (e.g., 'submit-move', 'vote')"),
  
  actionName: z.string().describe("Human-readable action name (e.g., 'Submit Move')"),
  
  description: z.string().max(200).describe("Brief description of what this action does"),
  
  // What state changes this action requires
  stateChanges: z.array(z.string()).describe(
    "List of state changes needed (e.g., 'set player move', 'set submitted flag')"
  ),
  
  // What needs to be validated
  validationNeeded: z.object({
    hasJsonLogicPreconditions: z.boolean().describe("Can preconditions be expressed with JsonLogic?"),
    preconditionDescription: z.string().nullable().optional().describe("Description of what needs to be checked"),
    needsLLMValidation: z.boolean().describe("Does action payload need LLM validation (e.g., free text)?"),
    llmValidationDescription: z.string().nullable().optional().describe("What LLM should validate if needed")
  }),
  
  // Game mechanics that need to be applied (NL guidance for LLM)
  mechanicsDescription: z.string().nullable().optional().describe(
    "Natural language description of game rules/mechanics that apply to this action (null if no mechanics needed)"
  ),
  
  // Messaging requirements
  messaging: z.object({
    needsPrivateMessage: z.boolean().default(false).describe("Does player get a private confirmation?"),
    privateMessagePurpose: z.string().nullable().optional().describe("What the private message should convey"),
    needsPublicMessage: z.boolean().default(false).describe("Do all players see an announcement?"),
    publicMessagePurpose: z.string().nullable().optional().describe("What the public message should convey")
  }),
  
  // What dynamic values are involved
  templateVariables: z.array(z.string()).describe(
    "Variables that will be resolved at runtime (e.g., 'playerId', 'playerAction', 'moveValue')"
  ),
  
  // State fields that will be READ by this action
  requiredInputFields: z.array(z.string()).describe(
    "Dot-notation paths to state fields this action READS (e.g., 'game.currentPhase', 'players.*.score')"
  ),
  
  // State fields that will be WRITTEN by this action
  requiredOutputFields: z.array(z.string()).describe(
    "Dot-notation paths to state fields this action WRITES/MODIFIES (e.g., 'players.{{playerId}}.call', 'players.{{playerId}}.actionRequired')"
  ),
  
  // DEPRECATED: Use requiredInputFields and requiredOutputFields instead
  requiredStateFields: z.array(z.string()).optional().describe(
    "DEPRECATED: Combined input/output fields. Use requiredInputFields and requiredOutputFields for clarity."
  )
});

/**
 * Planner's assessment of an automatic transition instruction
 */
export const AutomaticTransitionHintSchema = z.object({
  id: z.string().describe("Stable identifier (e.g., 'score-round', 'advance-round', 'end-game')"),
  
  transitionName: z.string().describe("Human-readable name (e.g., 'Score Round', 'End Game')"),
  
  description: z.string().max(200).describe("Brief description of what triggers this and what it does"),
  
  // When this should trigger
  trigger: z.object({
    isDeterministic: z.boolean().describe("Can trigger be expressed with JsonLogic preconditions?"),
    triggerDescription: z.string().describe("Description of when this triggers"),
    basedOnTransition: z.string().nullable().optional().describe("ID of transition from transitions artifact this relates to")
  }),
  
  // What computation/logic is needed
  computationNeeded: z.object({
    isDeterministic: z.boolean().describe("Can all state changes be hardcoded (no LLM needed)?"),
    computationDescription: z.string().describe("What needs to be computed or decided"),
    requiresLLMReasoning: z.boolean().default(false).describe("Does this need LLM to evaluate/decide?"),
    llmReasoningDescription: z.string().nullable().optional().describe("What LLM should compute/decide")
  }),
  
  // Game mechanics that need to be applied (NL guidance for LLM)
  mechanicsDescription: z.string().nullable().optional().describe(
    "Natural language description of game rules/mechanics that apply (null if no game mechanics needed)"
  ),
  
  // Randomness requirements
  usesRandomness: z.boolean().default(false).describe("Does this transition involve random/probabilistic outcomes?"),
  randomnessDescription: z.string().nullable().optional().describe(
    "What randomness is needed and how it's used (null if no randomness)"
  ),
  
  // What state changes are needed
  stateChanges: z.array(z.string()).describe(
    "List of state changes (e.g., 'increment winner score', 'append to history', 'reset player flags')"
  ),
  
  // Messaging requirements
  messaging: z.object({
    needsPublicMessage: z.boolean().default(false).describe("Do all players get an announcement?"),
    publicMessagePurpose: z.string().nullable().optional().describe("What the message should convey"),
    needsPrivateMessages: z.boolean().default(false).describe("Do individual players get private messages?"),
    privateMessagePurpose: z.string().nullable().optional().describe("What private messages should convey")
  }),
  
  // Template variables (for non-deterministic instructions)
  templateVariables: z.array(z.string()).describe(
    "Variables LLM must resolve (e.g., 'winnerId', 'winningMove', 'finalScore')"
  ),
  
  // State fields that will be READ by this transition
  requiredInputFields: z.array(z.string()).describe(
    "Dot-notation paths to state fields this transition READS to make decisions (e.g., 'game.currentPhase', 'players.*.call')"
  ),
  
  // State fields that will be WRITTEN by this transition
  requiredOutputFields: z.array(z.string()).describe(
    "Dot-notation paths to state fields this transition WRITES/CREATES (e.g., 'game.coinFlipResult', 'game.currentPhase', 'players.*.score')"
  ),
  
  // DEPRECATED: Use requiredInputFields and requiredOutputFields instead
  requiredStateFields: z.array(z.string()).optional().describe(
    "DEPRECATED: Combined input/output fields. Use requiredInputFields and requiredOutputFields for clarity."
  )
});

/**
 * Planner's assessment of instructions needed for a PLAYER INPUT phase
 * (Phases without player input should NOT have phase instructions)
 */
export const PhaseInstructionsHintSchema = z.object({
  phase: z.string().describe("Phase identifier (must require player input)"),
  
  playerActions: z.array(PlayerActionHintSchema).describe(
    "Player actions available in this phase"
  ),
  
  phaseSummary: z.string().max(500).describe(
    "Summary of what player input is needed and what it affects"
  )
});

/**
 * Complete planner response schema
 * Instructions are separated by type:
 * - playerPhases: Instructions for phases that accept player input
 * - transitions: Instructions for automatic transitions
 */
export const InstructionsPlanningResponseSchema = z.object({
  naturalLanguageSummary: z.string().max(500).describe(
    "1-3 sentence summary of the instruction structure and game flow"
  ),
  
  playerPhases: z.array(PhaseInstructionsHintSchema).describe(
    "Instruction hints ONLY for phases that require player input (other phases have no instructions)"
  ),
  
  transitions: z.array(AutomaticTransitionHintSchema).describe(
    "Instruction hints for EACH automatic transition (keyed by transition ID)"
  ),
  
  globalNotes: z.array(z.string()).optional().describe(
    "Any cross-cutting concerns or patterns the executor should be aware of"
  )
});

// Export planner types
export type PlayerActionHint = z.infer<typeof PlayerActionHintSchema>;
export type AutomaticTransitionHint = z.infer<typeof AutomaticTransitionHintSchema>;
export type PhaseInstructionsHint = z.infer<typeof PhaseInstructionsHintSchema>;
export type InstructionsPlanningResponse = z.infer<typeof InstructionsPlanningResponseSchema>;

// Planner JSON schema exports for prompt injection
export const PlayerActionHintSchemaJson = zodToJsonSchema(PlayerActionHintSchema, "PlayerActionHint");
export const AutomaticTransitionHintSchemaJson = zodToJsonSchema(AutomaticTransitionHintSchema, "AutomaticTransitionHint");
export const PhaseInstructionsHintSchemaJson = zodToJsonSchema(PhaseInstructionsHintSchema, "PhaseInstructionsHint");
export const InstructionsPlanningResponseSchemaJson = zodToJsonSchema(
  InstructionsPlanningResponseSchema, 
  "InstructionsPlanningResponse"
);

// ============================================================================
// NOTE: Executor schemas (actual instruction artifacts) are in:
// src/ai/simulate/schema.ts
// 
// Import them like this:
// import { 
//   InstructionsArtifact, 
//   PlayerActionInstruction,
//   AutomaticTransitionInstruction,
//   PhaseInstructions,
//   InstructionsArtifactSchemaJson
// } from "#chaincraft/ai/simulate/schema.js";
// ============================================================================
