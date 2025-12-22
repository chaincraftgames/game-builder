import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Hint schema for planner (no JsonLogic here) -------------------------------------------------
export const PreconditionHintSchema = z.object({
  id: z.string().describe("Stable id for this precondition hint, e.g. 'all_submitted'"),
  explain: z
    .string()
    .max(500)
    .describe(
      "One-line explanation of the condition that will be synthesized into JsonLogic. Reference exact state paths using dot notation (e.g., 'game.currentRound', 'players[*].hasSubmitted'). Must be expressible as deterministic JsonLogic."
    ),
});

export const TransitionCandidateSchema = z.object({
  id: z.string().describe("Stable id for the candidate transition, e.g. 'both_submitted_candidate'"),
  fromPhase: z.string().describe("Phase name this candidate originates from"),
  toPhase: z.string().describe("Target phase name after transition"),
  priority: z
    .number()
    .int()
    .default(100)
    .describe("Numeric priority for ordering (lower executes first). Use 100 as default if unsure."),
  condition: z
    .string()
    .describe(
      "Short human-readable condition describing when this transition should fire. May reference state paths or computed context variables."
    ),
  checkedFields: z
    .array(z.string())
    .describe("Array of exact dot-paths into the state schema that the router should inspect; support simple '[*]' wildcard."),
  computedValues: z
    .record(z.string())
    .optional()
    .describe(
      "Small map of derived values the planner used (hints). Values are short expressions or descriptions the executor may compute, e.g., 'count(players[*].hasSubmitted)'."
    ),
  preconditionHints: z
    .array(PreconditionHintSchema)
    .describe("Array of human-level precondition hints. Executor will synthesize JsonLogic for deterministic hints."),
  humanSummary: z.string().optional().describe("One-line human-friendly summary of the candidate transition."),
});

export const PhaseMetadataHintSchema = z.object({
  phase: z.string().describe("Phase name/identifier"),
  requiresPlayerInput: z.boolean().describe("Whether this phase requires player input/actions to proceed"),
});

export const PlanningResponseSchema = z.object({
  phases: z
    .array(z.string())
    .describe("Array of phase ids detected in the game; use exact strings as used in `game.phase`."),
  phaseMetadataHints: z
    .array(PhaseMetadataHintSchema)
    .describe("Metadata hints for each phase indicating whether it requires player input"),
  transitionCandidates: z
    .array(TransitionCandidateSchema)
    .describe("Array of high-level transition candidates produced by the planner. These are planning hints only; executor will synthesize final transitions.")
});

export type PreconditionHint = z.infer<typeof PreconditionHintSchema>;
export type TransitionCandidate = z.infer<typeof TransitionCandidateSchema>;
export type PlanningArtifact = z.infer<typeof PlanningResponseSchema>;

export const PlanningResponseSchemaJson = JSON.stringify(zodToJsonSchema(PlanningResponseSchema, "PlanningArtifact"));

export default PlanningResponseSchema;
