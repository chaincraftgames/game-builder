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
import type {
  AutomaticTransitionHint,
  PhaseInstructionsHint,
} from "#chaincraft/ai/simulate/graphs/spec-processing-graph/nodes/extract-instructions/schema.js";

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

// ---------------------------------------------------------------------------
// Planner-hint direct path
// ---------------------------------------------------------------------------

/**
 * Format message purpose strings from planner hints into message guidance.
 */
function formatHintMessageGuidance(
  publicPurpose?: string | null,
  privatePurpose?: string | null,
): string | undefined {
  const parts: string[] = [];
  if (publicPurpose) parts.push(`Public message: ${publicPurpose}`);
  if (privatePurpose) parts.push(`Private messages: ${privatePurpose}`);
  return parts.length > 0 ? `## Message Guidance\n${parts.join("\n")}` : undefined;
}

/**
 * Build MechanicTarget[] directly from planner hints — bypasses the extractor.
 *
 * Only selects transitions/actions where `mechanicsDescription` is non-null.
 * Appends randomness guidance to instructions when `usesRandomness` is true.
 *
 * This is the "planner → codegen direct path" — one fewer LLM call for
 * mechanic-targeted transitions because the extractor is skipped entirely.
 */
export function buildTargetsFromHints(
  transitions: AutomaticTransitionHint[],
  playerPhases: PhaseInstructionsHint[],
): MechanicTarget[] {
  const targets: MechanicTarget[] = [];

  // 1. Automatic transitions with mechanicsDescription
  for (const hint of transitions) {
    if (!hint.mechanicsDescription) continue;

    let instructions = hint.mechanicsDescription;
    if (hint.usesRandomness && hint.randomnessDescription) {
      instructions += `\n\nRandomness: ${hint.randomnessDescription}`;
    }

    targets.push({
      id: hint.id,
      type: "transition",
      functionName: hint.id,
      instructions,
      messageGuidance: formatHintMessageGuidance(
        hint.publicMessagePurpose,
        hint.privateMessagesPurpose,
      ),
    });
  }

  // 2. Player actions with mechanicsDescription
  for (const phase of playerPhases) {
    for (const action of phase.playerActions) {
      if (!action.mechanicsDescription) continue;

      targets.push({
        id: action.id,
        type: "action",
        functionName: action.id,
        instructions: action.mechanicsDescription,
        messageGuidance: formatHintMessageGuidance(
          action.publicMessagePurpose,
          action.privateMessagePurpose,
        ),
      });
    }
  }

  return targets;
}
