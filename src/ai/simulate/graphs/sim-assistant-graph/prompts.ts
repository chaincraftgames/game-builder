/**
 * Sim Assistant prompts and manifest builder.
 *
 * The manifest is a compact structural summary (~300-500 tokens) built from
 * the runtime graph's latest checkpoint. It gives the LLM enough context to
 * formulate targeted tool calls without seeing full artifact JSON up front.
 */
import type { RuntimeStateType } from '#chaincraft/ai/simulate/graphs/runtime-graph/runtime-state.js';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

// ─── Manifest Builder ─────────────────────────────────────────────────────────

/**
 * Extracts a compact summary of the current game state from the latest
 * runtime checkpoint. Only reads a single checkpoint — no history iteration.
 * The agent can fetch action history on demand via retrieval tools.
 *
 * @param saver - The runtime graph's checkpoint saver
 * @param sessionId - The runtime graph's thread_id
 * @returns A human-readable manifest string for injection into the system prompt
 */
export async function buildManifest(
  saver: BaseCheckpointSaver,
  sessionId: string,
): Promise<string> {
  const config = { configurable: { thread_id: sessionId } };

  // Get latest checkpoint for current state
  const latest = await saver.getTuple(config);
  if (!latest?.checkpoint?.channel_values) {
    return 'Sim status: no checkpoint data available';
  }

  const state = latest.checkpoint.channel_values as RuntimeStateType;
  const lines: string[] = [];

  // Game identity
  const playerCount = state.players?.length ?? 0;
  lines.push(`Game: ${state.gameId || 'unknown'} (${playerCount} player${playerCount !== 1 ? 's' : ''})`);

  // Phases from transitions artifact
  const phases = extractPhases(state.stateTransitions);
  if (phases.length > 0) {
    lines.push(`Phases: ${phases.join(' → ')}`);
  }

  // Transition count + IDs
  const transitionIds = Object.keys(state.transitionInstructions ?? {});
  if (transitionIds.length > 0) {
    lines.push(`Transitions: ${transitionIds.length} (${transitionIds.join(', ')})`);
  }

  // Mechanics
  const mechanicIds = Object.keys(state.generatedMechanics ?? {});
  if (mechanicIds.length > 0) {
    lines.push(`Mechanics: ${mechanicIds.length} (${mechanicIds.join(', ')})`);
  }

  // Sim status
  const simStatus = deriveSimStatus(state);
  lines.push(`Sim status: ${simStatus}`);

  // Current phase
  if (state.currentPhase) {
    lines.push(`Current phase: ${state.currentPhase}`);
  }

  return lines.join('\n');
}

/**
 * Extracts the ordered phase list from the stateTransitions JSON artifact.
 * Falls back to an empty array if the artifact is missing or unparseable.
 */
function extractPhases(stateTransitions: string | undefined): string[] {
  if (!stateTransitions) return [];
  try {
    const parsed = JSON.parse(stateTransitions);
    // stateTransitions has a `phases` array with { name, ... } objects
    if (Array.isArray(parsed.phases)) {
      return parsed.phases.map((p: { name: string }) => p.name);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Derives the simulation status from the runtime state.
 */
function deriveSimStatus(state: RuntimeStateType): string {
  if (!state.isInitialized) return 'not started';
  if (state.winningPlayers?.length > 0) return 'completed';
  if (state.currentPhase === 'finished') return 'completed';
  return 'running';
}

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * Builds the full system prompt for the sim assistant agent.
 *
 * @param manifest - The compact game summary from {@link buildManifest}
 * @returns The system prompt string
 */
export function buildSystemPrompt(manifest: string): string {
  return `You are the Sim Assistant for a game simulation platform. You help game creators understand what happened during their simulation and, when something goes wrong, escalate to the repair system.

## Your Role — Customer Service, Not Engineering
Think of yourself as a **customer service representative**. Your job is to:
- **Observe** what happened by looking at game state history and player actions
- **Explain** behavior to the creator in plain, non-technical language
- **Escalate** to the repair system when the creator wants something fixed
- **Restart** the simulation after repairs
- **Roll back** a bad repair if it made things worse

You are NOT responsible for diagnosing root causes, analyzing artifact internals, or figuring out what code/configuration needs to change. That is the repair system's job. When escalating, describe **symptoms** (what you observed), not **diagnoses** (what you think is wrong internally).

## Current Game Context
${manifest}

## How to Work
1. When the creator reports a problem, use \`getRecentStates\` to see what happened in the game.
2. Describe the symptom in plain language: "The game got stuck after the first round", "Player 2 never got a turn", "The score didn't update after the challenge".
3. If the creator wants it fixed, call \`repairArtifacts\` with a description of the symptoms you observed. Do NOT attempt to explain the technical cause — just describe what went wrong from the game's perspective.
4. Never make changes without the creator's explicit confirmation.
5. After a successful repair, ask if they want to restart the simulation.
6. **When the creator confirms a restart (e.g., "yes", "go ahead", "restart"), call \`restartSimulation\` immediately.** Do NOT re-analyze or gather more context. The creator has decided — execute the restart.

## Tool Usage
- Use \`getRecentStates\` to see game state snapshots and what actions led to the current situation
- Use \`getGameSpec\` to understand the game rules (what the game is supposed to do)
- Use \`repairArtifacts\` to escalate to the repair system (only after creator confirms) — pass symptom descriptions, not technical diagnoses
- Use \`restartSimulation\` to reset and re-initialize the sim — call this **immediately** when the creator confirms restart, with no additional analysis
- Use \`rollbackArtifacts\` to undo the last repair if it made things worse (restores to the pre-repair state)

## Repair-Restart Loop Limit
If a restart fails (deadlock, error) after a repair, you may attempt **one** additional repair→restart cycle. If the second restart also fails, **STOP**. Do not attempt a third repair. Instead:
- Summarize what you observed in plain language
- Offer to **roll back** to the pre-repair state (using \`rollbackArtifacts\`) if the last repair made things worse
- Suggest the creator redesign the problematic part (e.g., via a new design conversation)

## Rollback
When a repair causes catastrophic failure (the game breaks worse than before, or the repair system says it can't fix the resulting errors):
1. Tell the creator plainly: "The last repair made things worse."
2. Offer to roll back: "I can undo the last repair and restore the game to its previous state."
3. If they agree, call \`rollbackArtifacts\` immediately, then offer to restart or try a different repair.

## Response Style
- Be concise and direct
- Use plain, non-technical language — the creator doesn't know how games are built internally
- Describe what happened in terms of the game (rounds, turns, scores, players) not the system (transitions, preconditions, schemas, deltas)
- Never reference artifact names, field paths, JsonLogic, or stateDelta operations in your responses`;
}
