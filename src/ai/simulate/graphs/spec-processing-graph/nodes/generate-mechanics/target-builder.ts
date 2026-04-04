/**
 * Target Builder — Extract MechanicTarget[] from instruction artifacts
 *
 * Parses transitionInstructions and playerPhaseInstructions to identify
 * entries with mechanicsGuidance that need generated code.
 *
 * Used by spec-processing wrapper node (first-time generation) and can
 * also be used by repair/edit callers that need to rebuild targets.
 */

import type { MechanicTarget } from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/generate-mechanics/schema.js";
import type {
  AutomaticTransitionInstruction,
  PlayerPhaseInstructions,
  MechanicsGuidance,
} from "#chaincraft/ai/simulate/schema.js";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format mechanicsGuidance (object or string) into a single instructions string.
 */
function formatInstructions(
  guidance: MechanicsGuidance,
): string {
  if (typeof guidance === "string") return guidance;
  const lines = guidance.rules.map((r, i) => `${i + 1}. ${r}`);
  if (guidance.computation) {
    lines.push(`\nComputation: ${guidance.computation}`);
  }
  return lines.join("\n");
}

/**
 * Format message guidance for the prompt.
 */
function formatMessageGuidance(
  messages: AutomaticTransitionInstruction["messages"],
): string | undefined {
  if (!messages) return undefined;
  const parts: string[] = [];
  if (messages.public?.template) {
    parts.push(`Public message: ${messages.public.template}`);
  }
  if (messages.private && messages.private.length > 0) {
    const privMsgs = messages.private
      .map((m) => m.template)
      .join("; ");
    parts.push(`Private messages: ${privMsgs}`);
  }
  return parts.length > 0 ? `## Message Guidance\n${parts.join("\n")}` : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build MechanicTarget[] from transition and player phase instructions.
 *
 * Extracts targets where mechanicsGuidance is non-null — these are the
 * transitions/actions that need generated code.
 */
export function buildMechanicTargets(
  transitionInstructions: Record<string, string>,
  playerPhaseInstructions: Record<string, string>,
): MechanicTarget[] {
  const targets: MechanicTarget[] = [];

  // 1. Automatic transitions with mechanicsGuidance
  for (const [transitionId, json] of Object.entries(transitionInstructions)) {
    try {
      const instruction: AutomaticTransitionInstruction = JSON.parse(json);
      if (!instruction.mechanicsGuidance) continue;

      targets.push({
        id: transitionId,
        type: "transition",
        functionName: transitionId,
        instructions: formatInstructions(instruction.mechanicsGuidance),
        messageGuidance: formatMessageGuidance(instruction.messages),
      });
    } catch {
      console.warn(
        `[target_builder] Failed to parse transitionInstruction: ${transitionId}`,
      );
    }
  }

  // 2. Player actions with mechanicsGuidance
  for (const [phaseName, json] of Object.entries(playerPhaseInstructions)) {
    try {
      const phase: PlayerPhaseInstructions = JSON.parse(json);
      for (const action of phase.playerActions) {
        if (!action.mechanicsGuidance) continue;

        targets.push({
          id: action.id,
          type: "action",
          functionName: action.id,
          instructions: formatInstructions(action.mechanicsGuidance),
          messageGuidance: formatMessageGuidance(action.messages),
        });
      }
    } catch {
      console.warn(
        `[target_builder] Failed to parse playerPhaseInstructions: ${phaseName}`,
      );
    }
  }

  return targets;
}
