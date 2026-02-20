/**
 * Artifact Editor Coordinator
 * 
 * Diagnostic agent that analyzes validation errors and produces
 * a structured ChangePlan identifying which artifacts need changes.
 * 
 * The coordinator reasons about WHAT to fix, not HOW — domain-specific
 * knowledge (stateDelta syntax, JsonLogic, etc.) stays in the editors.
 */

import { ChangePlanSchema, type ChangePlan, type CoordinatorInput } from './types.js';
import type { ModelWithOptions } from '#chaincraft/ai/model-config.js';

// ─── System Prompt ───

export const COORDINATOR_SYSTEM_PROMPT = `You are a game artifact diagnostic agent. Your job is to analyze validation errors from game artifact extraction and produce a change plan.

## Artifact Types

- **Schema**: Defines game state fields. Game-level fields (game.*) and player-level fields (players.*). Types: number, string, boolean, enum, array, object.

- **Transitions**: Defines game phases, transitions between phases, and preconditions (JsonLogic expressions) that determine when transitions fire. Preconditions must be deterministic — they cannot contain randomness or rely on values that don't exist yet. Key phases: "init" (entry) and "finished" (terminal).

- **Instructions**: Defines what happens during each transition and player action. Contains stateDelta operations (atomic state mutations), messages to players, and mechanics guidance. Two sub-types:
  - Transition instructions (transitionInstructions): keyed by transition ID, define automatic state changes
  - Player phase instructions (playerPhaseInstructions): keyed by phase name, contain player actions with validation and stateDelta

## Artifact Dependencies

  Schema ← Transitions (preconditions reference schema fields)
  Schema ← Instructions (stateDelta ops reference schema fields)
  Transitions ← Instructions (transition IDs, phase names must match)

Changes to Schema may require cascading changes to Transitions and/or Instructions. Changes to Transitions may require cascading changes to Instructions. Changes to Instructions are typically self-contained.

## Common Fix Patterns

### Pattern 1: Missing actionRequired setter
- Error: "Player action 'X' must include a stateDelta operation that sets 'players.{{playerId}}.actionRequired'"
- Fix: Patch the specific player action in instructions to add the missing op
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 2: Non-deterministic precondition / null logic
- Error: "precondition 'X': logic cannot be null" or "non-deterministic preconditions are not allowed"
- Root cause: The transition needs to check a condition that involves randomness or a value that doesn't exist at precondition-check time
- Fix: Add a schema field to store a pre-calculated value, add an instruction to populate it (usually via rng op in a prior transition), rewrite the precondition to check the stored value
- Artifacts affected: schema + instructions + transitions
- Confidence: MEDIUM

### Pattern 3: Missing game completion flags
- Error: "No transition sets game.gameEnded=true" or "No transition sets players.*.isGameWinner"
- Fix: Patch the game-ending transition instruction to include the missing ops
- IMPORTANT: Check the game specification first. If the game has no winners (cooperative, narrative, draw-only), the isGameWinner error may be a warning that doesn't need a fix — but game.gameEnded MUST always be set.
- If the game does have winners: add isGameWinner=true ops in the appropriate ending transition
- If the game has NO winners: the instructions should explicitly NOT set isGameWinner (all players remain false), which signals a draw/no-winner game. The error can be acknowledged in the diagnosis.
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 4: Unreachable phase / no path to finished
- Error: "Phase 'X' is unreachable from init" or "Terminal phase unreachable"
- Fix: Add a missing transition or fix a fromPhase/toPhase reference
- Artifacts affected: transitions (may cascade to instructions if new transition needs instructions)
- Confidence: MEDIUM

### Pattern 5: Deadlocked initial state
- Error: "Init transition creates immediate deadlock"
- Root cause: Init sets field values that block all outgoing transitions from the starting phase
- Fix: Either patch init transition instruction to set compatible values, or patch the blocking preconditions
- Artifacts affected: instructions or transitions
- Confidence: MEDIUM (may require examining precondition logic)

### Pattern 6: Field referenced but not in schema
- Error: "references unknown field: X"
- Fix: Add the missing field to schema
- Artifacts affected: schema only
- Confidence: HIGH

### Pattern 7: Indexed player access in preconditions
- Error: "forbidden array index access" or "explicit player ID reference"
- Fix: Rewrite precondition to use allPlayers/anyPlayer operators instead of indexed access
- Artifacts affected: transitions only
- Confidence: HIGH

### Pattern 8: Invalid stateDelta structure
- Error: "missing 'op' field", "missing 'path' field", "missing 'value' field", "probabilities length must match choices length"
- Fix: Patch the specific instruction's stateDelta to fix the structural issue
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 9: Mixed literal+template path segments
- Error: "Path segment mixes literal text with template variables"
- Fix: Patch the specific stateDelta op to use proper path structure
- Artifacts affected: instructions only
- Confidence: HIGH

### Pattern 10: Missing instructions for transitions/phases
- Error: Instructions artifact is empty or missing entries for defined transitions/phases
- Root cause: Instructions extraction failed or produced incomplete output
- Fix: Use 'reextract' to regenerate instructions from scratch with the transitions and schema as context. Include the validation errors as guidance.
- Artifacts affected: instructions only
- Confidence: MEDIUM (reextract is heavier but necessary when instructions are empty)

## Rules

1. Produce the MINIMUM set of changes to resolve all errors
2. Order changes respecting dependencies: schema → transitions → instructions
3. If multiple errors share a root cause, produce ONE change that fixes all
4. Prefer 'patch' over 'reextract' — surgical fixes are cheaper and safer
5. Use 'reextract' only when the artifact has fundamental structural problems (multiple unreachable phases, completely wrong phase model, or empty artifacts that need full generation)
6. For cross-artifact fixes (Pattern 2), list all affected artifacts as separate changes in dependency order
7. Each change description should say WHAT to change in natural language, not HOW (the editor knows the syntax)
8. When instructions are empty ({}) but transitions exist, use 'reextract' for instructions — there's nothing to patch
9. Read the game specification carefully — it defines the game's intent. Not all validation warnings require code changes (e.g., isGameWinner warnings for no-winner games).`;


// ─── User Prompt Builder ───

function buildCoordinatorUserPrompt(input: CoordinatorInput): string {
  // Build instruction coverage summary
  let instructionCoverage: string;
  const transInstr = input.transitionInstructions;
  const playerInstr = input.playerPhaseInstructions;

  if (transInstr === '{}' && playerInstr === '{}') {
    instructionCoverage = 'EMPTY — no transition instructions and no player phase instructions generated';
  } else {
    const parts: string[] = [];
    if (transInstr && transInstr !== '{}') {
      try {
        const parsed = JSON.parse(transInstr);
        parts.push(`Transition instructions: ${Object.keys(parsed).join(', ')}`);
      } catch {
        parts.push(`Transition instructions: present (unparseable)`);
      }
    } else {
      parts.push('Transition instructions: EMPTY');
    }
    if (playerInstr && playerInstr !== '{}') {
      try {
        const parsed = JSON.parse(playerInstr);
        parts.push(`Player phase instructions: ${Object.keys(parsed).join(', ')}`);
      } catch {
        parts.push(`Player phase instructions: present (unparseable)`);
      }
    } else {
      parts.push('Player phase instructions: EMPTY');
    }
    instructionCoverage = parts.join('\n');
  }

  // Build transitions summary
  let transitionsSummary: string;
  try {
    const transitions = JSON.parse(input.stateTransitions);
    const phases = transitions.phases?.join(', ') || 'unknown';
    const transIds = transitions.transitions?.map((t: any) => 
      `${t.id} (${t.fromPhase} → ${t.toPhase})`
    ).join('\n  ') || 'unknown';
    transitionsSummary = `Phases: ${phases}\nTransitions:\n  ${transIds}`;
  } catch {
    transitionsSummary = input.stateTransitions || 'unknown';
  }

  return `GAME SPECIFICATION:
${input.gameSpecification}

VALIDATION ERRORS:
${input.validationErrors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

CURRENT ARTIFACTS:
Schema fields: ${input.schemaFields}

${transitionsSummary}

Instruction coverage: ${instructionCoverage}

Produce a ChangePlan to resolve all validation errors.`;
}


// ─── Coordinator Invocation ───

export async function invokeCoordinator(
  model: ModelWithOptions,
  input: CoordinatorInput,
): Promise<ChangePlan> {
  const userPrompt = buildCoordinatorUserPrompt(input);

  const result = await model.invokeWithSystemPrompt(
    COORDINATOR_SYSTEM_PROMPT,
    userPrompt,
    { agent: 'artifact-editor-coordinator' },
    ChangePlanSchema,
  );

  // invokeWithSystemPrompt with schema returns parsed object
  return result as ChangePlan;
}

// Export for testing
export { buildCoordinatorUserPrompt };
